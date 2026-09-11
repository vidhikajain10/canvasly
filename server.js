```js
import { WebSocketServer } from "ws";

const server = new WebSocketServer({ port: 3001 });

server.on("connection", (socket) => {
  socket.on("message", (message) => {
    server.clients.forEach((client) => {
      if (client.readyState === 1) {
        client.send(message.toString());
      }
    });
  });
});

console.log("Canvasly server running on port 3001");
```
