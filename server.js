import http from "http";
import { WebSocketServer } from "ws";
import crypto from "crypto";

const port = process.env.PORT || 3001;
const supabaseUrl = (process.env.SUPABASE_URL || "").replace(/\/$/, "").replace(/\/rest\/v1$/, "");
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function loadBoard(room) {
  if (!supabaseUrl || !supabaseKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    return [];
  }

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/boards?room_id=eq.${encodeURIComponent(room)}&select=elements`, {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`
      }
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
  if (!supabaseUrl || !supabaseKey) return;

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/boards`, {
      method: "POST",
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal"
      },
      body: JSON.stringify({
        room_id: room,
        elements,
        updated_at: new Date().toISOString()
      })
    });

    if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  } catch (error) {
    console.error("Supabase save failed:", error);
  }
}

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Canvasly server is running");
});

const wss = new WebSocketServer({ server });
const users = new Map();
const boards = new Map();

function send(socket, message) {
  if (socket.readyState === 1) socket.send(JSON.stringify(message));
}

function broadcast(room, message, except = null) {
  for (const [socket, info] of users) {
    if (info.room === room && socket !== except && socket.readyState === 1) send(socket, message);
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
        send(socket, { type: "sync", elements });
        announceUsers(room);
        return;
      }

      if (!info.room) return;
      const room = info.room;

      if (data.type === "draw" && data.element?.id) {
        const board = await getBoard(room);
        const index = board.findIndex((item) => item.id === data.element.id);
        if (index === -1) board.push(data.element);
        else board[index] = data.element;
        boards.set(room, board);
        await saveBoard(room, board);
        broadcast(room, { type: "draw", element: data.element }, socket);
        return;
      }

      if (data.type === "remove" && data.id) {
        const board = await getBoard(room);
        const next = board.filter((item) => item.id !== data.id);
        boards.set(room, next);
        await saveBoard(room, next);
        broadcast(room, { type: "remove", id: data.id }, socket);
        return;
      }

      if (data.type === "clear") {
        boards.set(room, []);
        await saveBoard(room, []);
        broadcast(room, { type: "clear" }, socket);
        return;
      }

      if (data.type === "cursor") {
        broadcast(room, {
          type: "cursor",
          id,
          x: Number(data.x) || 0,
          y: Number(data.y) || 0,
          name: String(data.name || info.name || "Guest").slice(0, 30)
        }, socket);
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
