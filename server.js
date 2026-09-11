import http from "http";
import { WebSocketServer } from "ws";

const port = process.env.PORT || 3001;

const server = http.createServer((req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/plain",
  });

  res.end("Canvasly server is running");
});

const wss = new WebSocketServer({
  server,
});

const rooms = new Map();

function sendToRoom(room, message, except = null) {
  wss.clients.forEach((client) => {
    if (
      client !== except &&
      client.readyState === 1 &&
      rooms.get(client) === room
    ) {
      client.send(JSON.stringify(message));
    }
  });
}

function sendUsers(room) {
  let count = 0;

  wss.clients.forEach((client) => {
    if (
      client.readyState === 1 &&
      rooms.get(client) === room
    ) {
      count++;
    }
  });

  sendToRoom(
    room,
    {
      type: "users",
      count,
    }
  );

  wss.clients.forEach((client) => {
    if (
      client.readyState === 1 &&
      rooms.get(client) === room
    ) {
      client.send(
        JSON.stringify({
          type: "users",
          count,
        })
      );
    }
  });
}

wss.on("connection", (socket) => {
  console.log("User connected");

  socket.on("message", (message) => {
    try {
      const data = JSON.parse(
        message.toString()
      );

      /* JOIN ROOM */

      if (data.type === "join") {
        const room =
          data.room?.trim() || "main";

        rooms.set(socket, room);

        sendUsers(room);

        console.log(
          `User joined room: ${room}`
        );

        return;
      }

      const room = rooms.get(socket);

      if (!room) return;

      /* DRAW */

      if (data.type === "draw") {
        sendToRoom(
          room,
          {
            type: "draw",
            element: data.element,
          },
          socket
        );

        return;
      }

      /* REMOVE / UNDO */

      if (data.type === "remove") {
        sendToRoom(
          room,
          {
            type: "remove",
            id: data.id,
          },
          socket
        );

        return;
      }

      /* CLEAR */

      if (data.type === "clear") {
        sendToRoom(
          room,
          {
            type: "clear",
          },
          socket
        );

        return;
      }
    } catch (error) {
      console.error(
        "Invalid WebSocket message",
        error
      );
    }
  });

  socket.on("close", () => {
    const room = rooms.get(socket);

    rooms.delete(socket);

    if (room) {
      sendUsers(room);
    }

    console.log("User disconnected");
  });
});

server.listen(
  port,
  "0.0.0.0",
  () => {
    console.log(
      `Canvasly running on port ${port}`
    );
  }
);
