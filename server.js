import http from "http";
import { WebSocketServer } from "ws";
import crypto from "crypto";

const port = process.env.PORT || 3001;
const supabaseUrl = (process.env.SUPABASE_URL || "").replace(/\/$/, "").replace(/\/rest\/v1$/, "");
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const apiHeaders = () => ({
  apikey: supabaseKey,
  Authorization: `Bearer ${supabaseKey}`,
  "Content-Type": "application/json"
});

async function loadBoard(room) {
  if (!supabaseUrl || !supabaseKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    return [];
  }

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/boards?room_id=eq.${encodeURIComponent(room)}&select=elements`, {
      headers: apiHeaders()
    });

    if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
    const rows = await response.json();
    return Array.isArray(rows[0]?.elements) ? rows[0].elements : [];
  } catch (error) {
    console.error("Supabase load failed:", error);
    return [];
  }
}

async function saveBoard(room, elements) {
  if (!supabaseUrl || !supabaseKey) return false;

  const payload = JSON.stringify({
    room_id: room,
    elements,
    updated_at: new Date().toISOString()
  });

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(`${supabaseUrl}/rest/v1/boards`, {
        method: "POST",
        headers: {
          ...apiHeaders(),
          Prefer: "resolution=merge-duplicates,return=minimal"
        },
        body: payload
      });

      if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
      return true;
    } catch (error) {
      console.error(`Supabase save failed (attempt ${attempt}/3):`, error);
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }

  return false;
}

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain", "Cache-Control": "no-store" });
  res.end("Canvasly server is running");
});

const wss = new WebSocketServer({ server });
const users = new Map();
const boards = new Map();
const saveTimers = new Map();
const saveQueues = new Map();
const roomQueues = new Map();
const roomRevisions = new Map();

function send(socket, message) {
  if (socket.readyState === 1) socket.send(JSON.stringify(message));
}

function broadcast(room, message) {
  for (const [socket, info] of users) {
    if (info.room === room && socket.readyState === 1) send(socket, message);
  }
}

function announceUsers(room) {
  let count = 0;
  for (const info of users.values()) if (info.room === room) count++;
  for (const [socket, info] of users) if (info.room === room) send(socket, { type: "users", count });
}

async function getBoard(room) {
  if (!boards.has(room)) boards.set(room, await loadBoard(room));
  return boards.get(room);
}

function queueSave(room, elements) {
  const previous = saveQueues.get(room) || Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(() => saveBoard(room, elements))
    .catch((error) => console.error("Board persistence queue failed:", error));
  saveQueues.set(room, next);
  return next;
}

function scheduleSave(room) {
  if (saveTimers.has(room)) clearTimeout(saveTimers.get(room));
  const timer = setTimeout(() => {
    saveTimers.delete(room);
    const snapshot = [...(boards.get(room) || [])];
    queueSave(room, snapshot);
  }, 500);
  saveTimers.set(room, timer);
}

function nextRevision(room) {
  const revision = (roomRevisions.get(room) || 0) + 1;
  roomRevisions.set(room, revision);
  return revision;
}

function enqueueRoomOperation(room, operation) {
  const previous = roomQueues.get(room) || Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(operation)
    .catch((error) => console.error("Room operation failed:", error));
  roomQueues.set(room, next);
  return next;
}

wss.on("connection", (socket) => {
  const id = crypto.randomUUID();
  users.set(socket, { id, room: null, name: "Guest" });
  send(socket, { type: "welcome", id });

  socket.on("message", async (raw) => {
    try {
      const data = JSON.parse(raw.toString());
      const info = users.get(socket);
      if (!info) return;

      if (data.type === "join") {
        const room = String(data.room || "main").trim() || "main";
        const oldRoom = info.room;

        if (oldRoom && oldRoom !== room) {
          broadcast(oldRoom, { type: "user_left", id });
          announceUsers(oldRoom);
        }

        info.room = room;
        info.name = String(data.name || "Guest").slice(0, 30);

        const elements = await getBoard(room);
        send(socket, {
          type: "sync",
          elements,
          revision: roomRevisions.get(room) || 0
        });
        announceUsers(room);
        return;
      }

      if (!info.room) return;
      const room = info.room;

      if (data.type === "draw" && data.element?.id) {
        enqueueRoomOperation(room, async () => {
          const board = await getBoard(room);
          const index = board.findIndex((item) => item.id === data.element.id);
          if (index === -1) board.push(data.element);
          else board[index] = data.element;
          boards.set(room, board);

          const revision = nextRevision(room);
          broadcast(room, {
            type: "draw",
            element: data.element,
            revision,
            operation: "upsert"
          });
          scheduleSave(room);
        });
        return;
      }

      if (data.type === "remove" && data.id) {
        enqueueRoomOperation(room, async () => {
          const board = await getBoard(room);
          const next = board.filter((item) => item.id !== data.id);
          boards.set(room, next);

          const revision = nextRevision(room);
          broadcast(room, {
            type: "remove",
            id: data.id,
            revision
          });
          scheduleSave(room);
        });
        return;
      }

      if (data.type === "clear") {
        enqueueRoomOperation(room, async () => {
          boards.set(room, []);

          const revision = nextRevision(room);
          broadcast(room, {
            type: "clear",
            revision
          });
          scheduleSave(room);
        });
        return;
      }

      if (data.type === "cursor") {
        broadcast(room, {
          type: "cursor",
          id,
          x: Number(data.x) || 0,
          y: Number(data.y) || 0,
          name: String(data.name || info.name || "Guest").slice(0, 30)
        });
      }
    } catch (error) {
      console.error("Invalid message:", error);
    }
  });

  socket.on("close", () => {
    const info = users.get(socket);
    if (!info) return;
    users.delete(socket);
    if (info.room) {
      broadcast(info.room, { type: "user_left", id: info.id });
      announceUsers(info.room);
    }
  });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Canvasly running on port ${port}`);
});
