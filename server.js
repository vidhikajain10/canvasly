import http from "http";
import { WebSocketServer } from "ws";

const port = process.env.PORT || 3001;

const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end("Canvasly server is running");
});

const wss = new WebSocketServer({ server });

wss.on("connection", (socket) => {
  socket.on("message", (message) => {
    wss.clients.forEach((client) => {
      if (client !== socket && client.readyState === 1) {
        client.send(message.toString());
      }
    });
  });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Canvasly running on port ${port}`);
});
