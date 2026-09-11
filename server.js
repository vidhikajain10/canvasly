```js
import { WebSocketServer } from "ws";

const port = process.env.PORT || 3001;

const server = new WebSocketServer({ port });

server.on("connection", (socket) => {
  socket.on("message", (message) => {
    server.clients.forEach((client) => {
      if (client.readyState === 1) {
        client.send(message.toString());
      }
    });
  });
});

console.log(`Canvasly server running on port ${port}`);
```
