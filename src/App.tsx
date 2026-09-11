```tsx
import { useEffect, useRef, useState } from "react";
import "./App.css";

const WS_URL = "ws://localhost:3001";

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const socketRef = useRef<WebSocket | null>(null);

  const [drawing, setDrawing] = useState(false);
  const [color, setColor] = useState("#000000");
  const [size, setSize] = useState(3);
  const [name, setName] = useState("Guest");
  const [room, setRoom] = useState("main");

  useEffect(() => {
    const socket = new WebSocket(WS_URL);
    socketRef.current = socket;

    socket.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === "draw") {
        drawLine(data);
      }

      if (data.type === "clear") {
        clearCanvas();
      }
    };

    return () => socket.close();
  }, []);

  const drawLine = ({
    x,
    y,
    lastX,
    lastY,
    color,
    size,
  }: {
    x: number;
    y: number;
    lastX: number;
    lastY: number;
    color: string;
    size: number;
  }) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");

    if (!canvas || !ctx) return;

    ctx.strokeStyle = color;
    ctx.lineWidth = size;
    ctx.lineCap = "round";

    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement>) => {
    setDrawing(true);

    const ctx = canvasRef.current?.getContext("2d");
    ctx?.beginPath();
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!drawing) return;

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");

    if (!canvas || !ctx) return;

    const x = e.nativeEvent.offsetX;
    const y = e.nativeEvent.offsetY;

    const lastX = ctx.currentTransform.e || x;
    const lastY = ctx.currentTransform.f || y;

    drawLine({
      x,
      y,
      lastX,
      lastY,
      color,
      size,
    });

    ctx.setTransform(1, 0, 0, 1, x, y);

    socketRef.current?.send(
      JSON.stringify({
        type: "draw",
        x,
        y,
        lastX,
        lastY,
        color,
        size,
        room,
        name,
      })
    );
  };

  const stopDrawing = () => {
    setDrawing(false);
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");

    if (!canvas || !ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    socketRef.current?.send(
      JSON.stringify({
        type: "clear",
        room,
      })
    );
  };

  return (
    <div className="app">
      <header>
        <h1>Canvasly</h1>

        <div className="info">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
          />

          <input
            value={room}
            onChange={(e) => setRoom(e.target.value)}
            placeholder="Room"
          />
        </div>
      </header>

      <div className="toolbar">
        <label>
          Color
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
          />
        </label>

        <label>
          Size
          <input
            type="range"
            min="1"
            max="20"
            value={size}
            onChange={(e) => setSize(Number(e.target.value))}
          />
        </label>

        <button onClick={clearCanvas}>Clear</button>
      </div>

      <main>
        <canvas
          ref={canvasRef}
          width={1200}
          height={700}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
        />
      </main>
    </div>
  );
}

export default App;
```
