import http from "http";
import { WebSocketServer } from "ws";

const port = process.env.PORT || 3001;

const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end("Canvasly server is running");
});

const wss = new WebSocketServer({ server });
const rooms = new Map();

wss.on("connection", (socket) => {
  socket.on("message", (message) => {
    const data = JSON.parse(message.toString());

    if (data.type === "join") {
      rooms.set(socket, data.room);
      return;
    }

    const room = rooms.get(socket);

    wss.clients.forEach((client) => {
      if (
        client !== socket &&
        client.readyState === 1 &&
        rooms.get(client) === room
      ) {
        client.send(JSON.stringify(data));
      }
    });
  });

  socket.on("close", () => {
    rooms.delete(socket);
  });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Canvasly running on port ${port}`);
});
