import { useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import "./App.css";

const WS_URL = "wss://canvasly-f0et.onrender.com";

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const lastPoint = useRef({ x: 0, y: 0 });

  const [drawing, setDrawing] = useState(false);
  const [color, setColor] = useState("#000000");
  const [size, setSize] = useState(3);
  const [name, setName] = useState("Guest");
  const [room, setRoom] = useState("main");

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");

    if (canvas && ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  };

  const drawLine = (data: any) => {
    const ctx = canvasRef.current?.getContext("2d");

    if (!ctx) return;

    ctx.strokeStyle = data.color;
    ctx.lineWidth = data.size;
    ctx.lineCap = "round";

    ctx.beginPath();
    ctx.moveTo(data.lastX, data.lastY);
    ctx.lineTo(data.x, data.y);
    ctx.stroke();
  };

  useEffect(() => {
    const socket = new WebSocket(WS_URL);
    socketRef.current = socket;

    socket.onopen = () => {
      socket.send(JSON.stringify({
        type: "join",
        room
      }));
    };

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
  }, [room]);

  const startDrawing = (e: MouseEvent<HTMLCanvasElement>) => {
    setDrawing(true);

    lastPoint.current = {
      x: e.nativeEvent.offsetX,
      y: e.nativeEvent.offsetY
    };
  };

  const draw = (e: MouseEvent<HTMLCanvasElement>) => {
    if (!drawing) return;

    const data = {
      type: "draw",
      x: e.nativeEvent.offsetX,
      y: e.nativeEvent.offsetY,
      lastX: lastPoint.current.x,
      lastY: lastPoint.current.y,
      color,
      size,
      room,
      name
    };

    drawLine(data);

    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(data));
    }

    lastPoint.current = {
      x: data.x,
      y: data.y
    };
  };

  const clear = () => {
    clearCanvas();

    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(
        JSON.stringify({
          type: "clear",
          room
        })
      );
    }
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

        <button onClick={clear}>Clear</button>
      </div>

      <main>
        <canvas
          ref={canvasRef}
          width={1200}
          height={700}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={() => setDrawing(false)}
          onMouseLeave={() => setDrawing(false)}
        />
      </main>
    </div>
  );
}

export default App;
