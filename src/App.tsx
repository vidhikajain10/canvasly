import { useEffect, useRef, useState } from "react";
import "./App.css";

const WS_URL = "wss://canvasly-f0et.onrender.com";

type Tool =
  | "pen"
  | "eraser"
  | "line"
  | "arrow"
  | "rectangle"
  | "circle";

type Point = {
  x: number;
  y: number;
};

type Element = {
  id: string;
  type: Tool;
  points: Point[];
  color: string;
  size: number;
  user: string;
};

type ServerMessage =
  | {
      type: "draw";
      element: Element;
    }
  | {
      type: "remove";
      id: string;
    }
  | {
      type: "clear";
    }
  | {
      type: "sync";
      elements: Element[];
    }
  | {
      type: "users";
      count: number;
    };

const WIDTH = 1200;
const HEIGHT = 700;

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const socketRef = useRef<WebSocket | null>(null);

  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState("#111111");
  const [size, setSize] = useState(4);
  const [name, setName] = useState("Guest");
  const [room, setRoom] = useState("main");

  const [elements, setElements] = useState<Element[]>([]);
  const [redoStack, setRedoStack] = useState<Element[]>([]);

  const [users, setUsers] = useState(1);
  const [status, setStatus] = useState<
    "connecting" | "connected" | "disconnected"
  >("connecting");

  const [isDrawing, setIsDrawing] = useState(false);
  const [startPoint, setStartPoint] = useState<Point | null>(null);
  const [currentPoint, setCurrentPoint] = useState<Point | null>(null);

  const elementsRef = useRef<Element[]>([]);

  useEffect(() => {
    elementsRef.current = elements;
  }, [elements]);

  const send = (message: object) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(message));
    }
  };

  const drawElement = (
    ctx: CanvasRenderingContext2D,
    element: Element
  ) => {
    if (!element.points.length) return;

    ctx.strokeStyle =
      element.type === "eraser" ? "#ffffff" : element.color;

    ctx.lineWidth = element.size;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    const first = element.points[0];

    ctx.beginPath();

    if (element.type === "pen" || element.type === "eraser") {
      ctx.moveTo(first.x, first.y);

      for (let i = 1; i < element.points.length; i++) {
        ctx.lineTo(
          element.points[i].x,
          element.points[i].y
        );
      }

      ctx.stroke();
      return;
    }

    const last =
      element.points[element.points.length - 1];

    if (element.type === "line") {
      ctx.moveTo(first.x, first.y);
      ctx.lineTo(last.x, last.y);
      ctx.stroke();
      return;
    }

    if (element.type === "arrow") {
      drawArrow(ctx, first, last, element.size);
      return;
    }

    if (element.type === "rectangle") {
      const width = last.x - first.x;
      const height = last.y - first.y;

      ctx.strokeRect(
        first.x,
        first.y,
        width,
        height
      );

      return;
    }

    if (element.type === "circle") {
      const dx = last.x - first.x;
      const dy = last.y - first.y;
      const radius = Math.sqrt(dx * dx + dy * dy);

      ctx.arc(
        first.x,
        first.y,
        radius,
        0,
        Math.PI * 2
      );

      ctx.stroke();
    }
  };

  const drawArrow = (
    ctx: CanvasRenderingContext2D,
    from: Point,
    to: Point,
    lineWidth: number
  ) => {
    const headLength = Math.max(10, lineWidth * 4);

    const angle = Math.atan2(
      to.y - from.y,
      to.x - from.x
    );

    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);

    ctx.moveTo(to.x, to.y);

    ctx.lineTo(
      to.x -
        headLength *
          Math.cos(angle - Math.PI / 6),
      to.y -
        headLength *
          Math.sin(angle - Math.PI / 6)
    );

    ctx.moveTo(to.x, to.y);

    ctx.lineTo(
      to.x -
        headLength *
          Math.cos(angle + Math.PI / 6),
      to.y -
        headLength *
          Math.sin(angle + Math.PI / 6)
    );

    ctx.stroke();
  };

  const redrawCanvas = (
    items: Element[] = elements
  ) => {
    const canvas = canvasRef.current;

    if (!canvas) return;

    const ctx = canvas.getContext("2d");

    if (!ctx) return;

    ctx.clearRect(0, 0, WIDTH, HEIGHT);

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    items.forEach((element) => {
      drawElement(ctx, element);
    });

    if (
      isDrawing &&
      startPoint &&
      currentPoint &&
      tool !== "pen" &&
      tool !== "eraser"
    ) {
      const preview: Element = {
        id: "preview",
        type: tool,
        points: [startPoint, currentPoint],
        color,
        size,
        user: name,
      };

      ctx.save();
      ctx.globalAlpha = 0.65;
      drawElement(ctx, preview);
      ctx.restore();
    }
  };

  useEffect(() => {
    redrawCanvas(elements);
  }, [
    elements,
    isDrawing,
    startPoint,
    currentPoint,
    tool,
    color,
    size,
  ]);

  useEffect(() => {
    const socket = new WebSocket(WS_URL);

    socketRef.current = socket;
    setStatus("connecting");

    socket.onopen = () => {
      setStatus("connected");

      socket.send(
        JSON.stringify({
          type: "join",
          room,
          name,
        })
      );
    };

    socket.onmessage = (event) => {
      try {
        const data: ServerMessage = JSON.parse(
          event.data
        );

        if (data.type === "draw") {
          setElements((previous) => [
            ...previous,
            data.element,
          ]);
          return;
        }

        if (data.type === "remove") {
          setElements((previous) =>
            previous.filter(
              (element) => element.id !== data.id
            )
          );
          return;
        }

        if (data.type === "clear") {
          setElements([]);
          setRedoStack([]);
          return;
        }

        if (data.type === "sync") {
          setElements(data.elements);
          return;
        }

        if (data.type === "users") {
          setUsers(data.count);
        }
      } catch {
        console.log("Invalid server message");
      }
    };

    socket.onclose = () => {
      setStatus("disconnected");
    };

    socket.onerror = () => {
      setStatus("disconnected");
    };

    return () => {
      socket.close();
    };
  }, [room]);

  const getPoint = (
    event: React.PointerEvent<HTMLCanvasElement>
  ): Point => {
    const canvas = canvasRef.current!;

    const rect = canvas.getBoundingClientRect();

    return {
      x:
        ((event.clientX - rect.left) /
          rect.width) *
        WIDTH,

      y:
        ((event.clientY - rect.top) /
          rect.height) *
        HEIGHT,
    };
  };

  const startDrawing = (
    event: React.PointerEvent<HTMLCanvasElement>
  ) => {
    event.preventDefault();

    const point = getPoint(event);

    event.currentTarget.setPointerCapture(
      event.pointerId
    );

    setIsDrawing(true);
    setStartPoint(point);
    setCurrentPoint(point);

    if (tool === "pen" || tool === "eraser") {
      const element: Element = {
        id: crypto.randomUUID(),
        type: tool,
        points: [point],
        color,
        size,
        user: name,
      };

      setElements((previous) => [
        ...previous,
        element,
      ]);

      setRedoStack([]);

      send({
        type: "draw",
        element,
        room,
      });
    }
  };

  const draw = (
    event: React.PointerEvent<HTMLCanvasElement>
  ) => {
    if (!isDrawing) return;

    event.preventDefault();

    const point = getPoint(event);

    setCurrentPoint(point);

    if (tool === "pen" || tool === "eraser") {
      setElements((previous) => {
        if (!previous.length) return previous;

        const updated = [...previous];

        const last =
          updated[updated.length - 1];

        if (
          last.user !== name &&
          last.type !== tool
        ) {
          return previous;
        }

        const updatedLast: Element = {
          ...last,
          points: [...last.points, point],
        };

        updated[updated.length - 1] =
          updatedLast;

        return updated;
      });

      const current =
        elementsRef.current[
          elementsRef.current.length - 1
        ];

      if (current) {
        const updatedElement: Element = {
          ...current,
          points: [...current.points, point],
        };

        elementsRef.current = [
          ...elementsRef.current.slice(0, -1),
          updatedElement,
        ];

        send({
          type: "draw",
          element: {
            ...updatedElement,
            id: `${updatedElement.id}-${Date.now()}`,
            points: [
              updatedElement.points[
                updatedElement.points.length - 2
              ],
              point,
            ],
          },
          room,
        });
      }
    }
  };

  const stopDrawing = (
    event?: React.PointerEvent<HTMLCanvasElement>
  ) => {
    if (!isDrawing) return;

    if (
      event &&
      event.currentTarget.hasPointerCapture(
        event.pointerId
      )
    ) {
      event.currentTarget.releasePointerCapture(
        event.pointerId
      );
    }

    if (
      startPoint &&
      currentPoint &&
      tool !== "pen" &&
      tool !== "eraser"
    ) {
      const element: Element = {
        id: crypto.randomUUID(),
        type: tool,
        points: [startPoint, currentPoint],
        color,
        size,
        user: name,
      };

      setElements((previous) => [
        ...previous,
        element,
      ]);

      setRedoStack([]);

      send({
        type: "draw",
        element,
        room,
      });
    }

    setIsDrawing(false);
    setStartPoint(null);
    setCurrentPoint(null);
  };

  const undo = () => {
    if (!elements.length) return;

    const last =
      elements[elements.length - 1];

    setElements((previous) =>
      previous.slice(0, -1)
    );

    setRedoStack((previous) => [
      ...previous,
      last,
    ]);

    send({
      type: "remove",
      id: last.id,
      room,
    });
  };

  const redo = () => {
    if (!redoStack.length) return;

    const element =
      redoStack[redoStack.length - 1];

    setRedoStack((previous) =>
      previous.slice(0, -1)
    );

    setElements((previous) => [
      ...previous,
      element,
    ]);

    send({
      type: "draw",
      element,
      room,
    });
  };

  const clear = () => {
    setElements([]);
    setRedoStack([]);

    send({
      type: "clear",
      room,
    });
  };

  const downloadCanvas = () => {
    const canvas = canvasRef.current;

    if (!canvas) return;

    const link =
      document.createElement("a");

    link.download = `canvasly-${room}.png`;

    link.href = canvas.toDataURL("image/png");

    link.click();
  };

  const copyRoomLink = async () => {
    const url =
      `${window.location.origin}?room=${encodeURIComponent(
        room
      )}`;

    try {
      await navigator.clipboard.writeText(url);

      alert("Room link copied!");
    } catch {
      prompt(
        "Copy this room link:",
        url
      );
    }
  };

  const changeRoom = (
    value: string
  ) => {
    const newRoom =
      value.trim() || "main";

    setRoom(newRoom);
  };

  const toolButton = (
    value: Tool,
    label: string
  ) => (
    <button
      className={
        tool === value
          ? "tool active"
          : "tool"
      }
      onClick={() => setTool(value)}
      title={label}
    >
      {label}
    </button>
  );

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="logo">C</div>

          <div>
            <h1>Canvasly</h1>
            <span>
              Real-time collaborative whiteboard
            </span>
          </div>
        </div>

        <div className="connection">
          <span
            className={`status-dot ${status}`}
          />

          {status === "connected"
            ? "Connected"
            : status === "connecting"
            ? "Connecting..."
            : "Disconnected"}
        </div>

        <div className="top-actions">
          <input
            value={name}
            onChange={(e) =>
              setName(e.target.value)
            }
            placeholder="Your name"
            maxLength={20}
          />

          <input
            value={room}
            onChange={(e) =>
              changeRoom(e.target.value)
            }
            placeholder="Room"
            maxLength={30}
          />

          <button
            className="secondary"
            onClick={copyRoomLink}
          >
            🔗 Share
          </button>

          <div className="users">
            👥 {users}
          </div>
        </div>
      </header>

      <div className="toolbar">
        <div className="tool-group">
          {toolButton("pen", "✏️ Pen")}
          {toolButton("eraser", "🧹 Eraser")}
          {toolButton("line", "／ Line")}
          {toolButton("arrow", "➜ Arrow")}
          {toolButton(
            "rectangle",
            "▭ Rectangle"
          )}
          {toolButton("circle", "◯ Circle")}
        </div>

        <div className="divider" />

        <label className="control">
          <span>Color</span>

          <input
            className="color-picker"
            type="color"
            value={color}
            onChange={(e) =>
              setColor(e.target.value)
            }
            disabled={tool === "eraser"}
          />
        </label>

        <label className="size-control">
          <span>
            Size <b>{size}px</b>
          </span>

          <input
            type="range"
            min="1"
            max="30"
            value={size}
            onChange={(e) =>
              setSize(Number(e.target.value))
            }
          />
        </label>

        <div className="divider" />

        <button
          className="action"
          onClick={undo}
          disabled={!elements.length}
        >
          ↶ Undo
        </button>

        <button
          className="action"
          onClick={redo}
          disabled={!redoStack.length}
        >
          ↷ Redo
        </button>

        <button
          className="action danger"
          onClick={clear}
        >
          🗑 Clear
        </button>

        <button
          className="action download"
          onClick={downloadCanvas}
        >
          ⬇️ Download
        </button>
      </div>

      <main className="workspace">
        <div className="canvas-wrapper">
          <div className="canvas-header">
            <span>
              Room: <b>{room}</b>
            </span>

            <span>
              {elements.length} objects
            </span>
          </div>

          <canvas
            ref={canvasRef}
            width={WIDTH}
            height={HEIGHT}
            className="canvas"
            onPointerDown={startDrawing}
            onPointerMove={draw}
            onPointerUp={stopDrawing}
            onPointerCancel={stopDrawing}
          />
        </div>
      </main>

      <footer>
        <span>
          ✨ Draw together in real time
        </span>

        <span>
          Room <b>{room}</b> · {users} online
        </span>
      </footer>
    </div>
  );
}

export default App;
