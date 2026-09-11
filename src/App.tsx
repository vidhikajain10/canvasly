```tsx
import { useRef } from "react";
import "./App.css";

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const draw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");

    if (!canvas || !ctx) return;

    ctx.lineTo(e.nativeEvent.offsetX, e.nativeEvent.offsetY);
    ctx.stroke();
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");

    if (!canvas || !ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  return (
    <div className="app">
      <header>
        <h1>Canvasly</h1>
        <button onClick={clearCanvas}>Clear</button>
      </header>

      <main>
        <canvas
          ref={canvasRef}
          onMouseDown={(e) => {
            canvasRef.current?.getContext("2d")?.beginPath();
            draw(e);
          }}
          onMouseMove={draw}
        />
      </main>
    </div>
  );
}

export default App;
```
