import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer } from "ws";
import crypto from "crypto";

const port = process.env.PORT || 3001;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataFile = path.join(__dirname, "canvasly-boards.json");

let boards = {};
try {
  if (fs.existsSync(dataFile)) boards = JSON.parse(fs.readFileSync(dataFile, "utf8"));
} catch (error) {
  console.error("Could not load saved boards", error);
}

function saveBoards() {
  try {
    fs.writeFileSync(dataFile, JSON.stringify(boards));
  } catch (error) {
    console.error("Could not save boards", error);
  }
}

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Canvasly server is running");
});

const wss = new WebSocketServer({ server });
const users = new Map();

function roomUsers(room) {
  let count = 0;
  for (const value of users.values()) if (value.room === room) count++;
  return count;
}

function send(socket, message) {
  if (socket.readyState === 1) socket.send(JSON.stringify(message));
}

function broadcast(room, message, except = null) {
  for (const [socket, info] of users) {
    if (info.room === room && socket !== except && socket.readyState === 1) send(socket, message);
  }
}

function announceUsers(room) {
  broadcast(room, { type: "users", count: roomUsers(room) });
  for (const [socket, info] of users) {
    if (info.room === room) send(socket, { type: "users", count: roomUsers(room) });
  }
}

wss.on("connection", (socket) => {
  const id = crypto.randomUUID();
  users.set(socket, { id, room: null, name: "Guest" });
  send(socket, { type: "welcome", id });

  socket.on("message", (raw) => {
    try {
      const data = JSON.parse(raw.toString());
      const info = users.get(socket);
      if (!info) return;

      if (data.type === "join") {
        const room = String(data.room || "main").trim() || "main";
        const oldRoom = info.room;
        if (oldRoom && oldRoom !== room) announceUsers(oldRoom);
        info.room = room;
        info.name = String(data.name || "Guest").slice(0, 30);
        if (!boards[room]) boards[room] = [];
        send(socket, { type: "sync", elements: boards[room] });
        send(socket, { type: "users", count: roomUsers(room) });
        announceUsers(room);
        return;
      }

      if (!info.room) return;
      const room = info.room;

      if (data.type === "draw" && data.element?.id) {
        const element = data.element;
        const board = boards[room] || [];
        const index = board.findIndex((item) => item.id === element.id);
        if (index === -1) board.push(element);
        else board[index] = element;
        boards[room] = board;
        saveBoards();
        broadcast(room, { type: "draw", element }, socket);
        return;
      }

      if (data.type === "remove" && data.id) {
        boards[room] = (boards[room] || []).filter((item) => item.id !== data.id);
        saveBoards();
        broadcast(room, { type: "remove", id: data.id }, socket);
        return;
      }

      if (data.type === "clear") {
        boards[room] = [];
        saveBoards();
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
      console.error("Invalid message", error);
    }
  });

  socket.on("close", () => {
    const info = users.get(socket);
    if (!info) return;
    const room = info.room;
    users.delete(socket);
    if (room) {
      broadcast(room, { type: "user_left", id: info.id });
      announceUsers(room);
    }
  });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Canvasly running on port ${port}`);
});
