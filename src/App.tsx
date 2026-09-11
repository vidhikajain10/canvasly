import { useEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";
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

type Cursor = {
  x: number;
  y: number;
  name: string;
};

type ServerMessage =
  | { type: "draw"; element: Element }
  | { type: "remove"; id: string }
  | { type: "clear" }
  | { type: "sync"; elements: Element[] }
  | { type: "users"; count: number }
  | {
      type: "cursor";
      id: string;
      x: number;
      y: number;
      name: string;
    }
  | { type: "user_left"; id: string }
  | { type: "welcome"; id: string };

const WIDTH = 1200;
const HEIGHT = 700;

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<number | null>(null);
  const activeElementId = useRef<string | null>(null);
  const elementsRef = useRef<Element[]>([]);
  const myIdRef = useRef("");

  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState("#111111");
  const [size, setSize] = useState(4);

  const [name, setName] = useState("Guest");
  const nameRef = useRef("Guest");

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

  const [cursors, setCursors] = useState<
    Record<string, Cursor>
  >({});

  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    elementsRef.current = elements;
  }, [elements]);

  useEffect(() => {
    nameRef.current = name;
  }, [name]);

  const send = (message: object) => {
    if (
      socketRef.current &&
      socketRef.current.readyState === WebSocket.OPEN
    ) {
      socketRef.current.send(JSON.stringify(message));
    }
  };

  const drawArrow = (
    ctx: CanvasRenderingContext2D,
    from: Point,
    to: Point,
    lineWidth: number
  ) => {
    const headLength = Math.max(12, lineWidth * 4);

    const angle = Math.atan2(
      to.y - from.y,
      to.x - from.x
    );

    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);

    ctx.moveTo(to.x, to.y);

    ctx.lineTo(
      to.x - headLength * Math.cos(angle - Math.PI / 6),
      to.y - headLength * Math.sin(angle - Math.PI / 6)
    );

    ctx.moveTo(to.x, to.y);

    ctx.lineTo(
      to.x - headLength * Math.cos(angle + Math.PI / 6),
      to.y - headLength * Math.sin(angle + Math.PI / 6)
    );

    ctx.stroke();
  };

  const drawElement = (
    ctx: CanvasRenderingContext2D,
    element: Element
  ) => {
    if (!element.points.length) return;

    ctx.strokeStyle =
      element.type === "eraser"
        ? "#ffffff"
        : element.color;

    ctx.lineWidth = element.size;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    const first = element.points[0];

    ctx.beginPath();

    if (
      element.type === "pen" ||
      element.type === "eraser"
    ) {
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
      ctx.strokeRect(
        first.x,
        first.y,
        last.x - first.x,
        last.y - first.y
      );
      return;
    }

    if (element.type === "circle") {
      const dx = last.x - first.x;
      const dy = last.y - first.y;

      const radius = Math.sqrt(
        dx * dx + dy * dy
      );

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

  const redrawCanvas = () => {
    const canvas = canvasRef.current;

    if (!canvas) return;

    const ctx = canvas.getContext("2d");

    if (!ctx) return;

    ctx.clearRect(0, 0, WIDTH, HEIGHT);

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    elementsRef.current.forEach((element) => {
      drawElement(ctx, element);
    });

    if (
      isDrawing &&
      startPoint &&
      currentPoint &&
      tool !== "pen" &&
      tool !== "eraser"
    ) {
      ctx.save();
      ctx.globalAlpha = 0.55;

      drawElement(ctx, {
        id: "preview",
        type: tool,
        points: [startPoint, currentPoint],
        color,
        size,
        user: nameRef.current,
      });

      ctx.restore();
    }
  };

  useEffect(() => {
    redrawCanvas();
  }, [
    elements,
    isDrawing,
    startPoint,
    currentPoint,
    tool,
    color,
    size,
  ]);

  /* WEBSOCKET + AUTOMATIC RECONNECT */

  useEffect(() => {
    let stopped = false;

    const connect = () => {
      if (stopped) return;

      setStatus("connecting");

      const socket = new WebSocket(WS_URL);

      socketRef.current = socket;

      socket.onopen = () => {
        if (stopped) return;

        setStatus("connected");

        socket.send(
          JSON.stringify({
            type: "join",
            room,
            name: nameRef.current,
          })
        );
      };

      socket.onmessage = (event) => {
        try {
          const data: ServerMessage =
            JSON.parse(event.data);

          if (data.type === "welcome") {
            myIdRef.current = data.id;
            return;
          }

          if (data.type === "sync") {
            elementsRef.current = data.elements;
            setElements(data.elements);
            setRedoStack([]);
            return;
          }

          if (data.type === "draw") {
            const incoming = data.element;

            setElements((previous) => {
              const index = previous.findIndex(
                (element) =>
                  element.id === incoming.id
              );

              let updated: Element[];

              if (index === -1) {
                updated = [
                  ...previous,
                  incoming,
                ];
              } else {
                updated = [...previous];
                updated[index] = incoming;
              }

              elementsRef.current = updated;

              return updated;
            });

            return;
          }

          if (data.type === "remove") {
            setElements((previous) => {
              const updated =
                previous.filter(
                  (element) =>
                    element.id !== data.id
                );

              elementsRef.current = updated;

              return updated;
            });

            return;
          }

          if (data.type === "clear") {
            elementsRef.current = [];
            setElements([]);
            setRedoStack([]);
            return;
          }

          if (data.type === "users") {
            setUsers(data.count);
            return;
          }

          if (data.type === "cursor") {
            if (data.id === myIdRef.current) {
              return;
            }

            setCursors((previous) => ({
              ...previous,
              [data.id]: {
                x: data.x,
                y: data.y,
                name: data.name,
              },
            }));

            return;
          }

          if (data.type === "user_left") {
            setCursors((previous) => {
              const updated = {
                ...previous,
              };

              delete updated[data.id];

              return updated;
            });
          }
        } catch {
          console.log(
            "Invalid server message"
          );
        }
      };

      socket.onclose = () => {
        socketRef.current = null;

        if (!stopped) {
          setStatus("disconnected");

          reconnectTimer.current =
            window.setTimeout(
              connect,
              2500
            );
        }
      };

      socket.onerror = () => {
        setStatus("disconnected");
      };
    };

    connect();

    return () => {
      stopped = true;

      if (reconnectTimer.current) {
        clearTimeout(
          reconnectTimer.current
        );
      }

      socketRef.current?.close();
      socketRef.current = null;

      setCursors({});
    };
  }, [room]);

  /* POINTER POSITION */

  const getPoint = (
    event: PointerEvent<HTMLCanvasElement>
  ): Point => {
    const canvas = canvasRef.current!;

    const rect =
      canvas.getBoundingClientRect();

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

  const sendCursor = (
    event: PointerEvent<HTMLCanvasElement>
  ) => {
    const point = getPoint(event);

    send({
      type: "cursor",
      room,
      x: point.x,
      y: point.y,
      name: nameRef.current,
    });
  };

  const startDrawing = (
    event: PointerEvent<HTMLCanvasElement>
  ) => {
    event.preventDefault();

    const point = getPoint(event);

    event.currentTarget.setPointerCapture(
      event.pointerId
    );

    setIsDrawing(true);
    setStartPoint(point);
    setCurrentPoint(point);

    if (
      tool === "pen" ||
      tool === "eraser"
    ) {
      const element: Element = {
        id: crypto.randomUUID(),
        type: tool,
        points: [point],
        color,
        size,
        user: nameRef.current,
      };

      activeElementId.current =
        element.id;

      const updated = [
        ...elementsRef.current,
        element,
      ];

      elementsRef.current = updated;
      setElements(updated);
      setRedoStack([]);

      send({
        type: "draw",
        room,
        element,
      });
    }
  };

  const draw = (
    event: PointerEvent<HTMLCanvasElement>
  ) => {
    if (!isDrawing) return;

    event.preventDefault();

    const point = getPoint(event);

    sendCursor(event);

    setCurrentPoint(point);

    if (
      tool === "pen" ||
      tool === "eraser"
    ) {
      const id =
        activeElementId.current;

      if (!id) return;

      const current =
        elementsRef.current.find(
          (element) =>
            element.id === id
        );

      if (!current) return;

      const updatedElement: Element = {
        ...current,
        points: [
          ...current.points,
          point,
        ],
      };

      const updated =
        elementsRef.current.map(
          (element) =>
            element.id === id
              ? updatedElement
              : element
        );

      elementsRef.current = updated;
      setElements(updated);

      send({
        type: "draw",
        room,
        element: updatedElement,
      });
    }
  };

  const stopDrawing = (
    event?: PointerEvent<HTMLCanvasElement>
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
        points: [
          startPoint,
          currentPoint,
        ],
        color,
        size,
        user: nameRef.current,
      };

      const updated = [
        ...elementsRef.current,
        element,
      ];

      elementsRef.current = updated;
      setElements(updated);
      setRedoStack([]);

      send({
        type: "draw",
        room,
        element,
      });
    }

    activeElementId.current = null;

    setIsDrawing(false);
    setStartPoint(null);
    setCurrentPoint(null);
  };

  /* UNDO */

  const undo = () => {
    const ownElements =
      elementsRef.current.filter(
        (element) =>
          element.user === nameRef.current
      );

    if (!ownElements.length) return;

    const last =
      ownElements[ownElements.length - 1];

    const updated =
      elementsRef.current.filter(
        (element) =>
          element.id !== last.id
      );

    elementsRef.current = updated;
    setElements(updated);

    setRedoStack((previous) => [
      ...previous,
      last,
    ]);

    send({
      type: "remove",
      room,
      id: last.id,
    });
  };

  /* REDO */

  const redo = () => {
    if (!redoStack.length) return;

    const element =
      redoStack[redoStack.length - 1];

    const updated = [
      ...elementsRef.current,
      element,
    ];

    elementsRef.current = updated;
    setElements(updated);

    setRedoStack((previous) =>
      previous.slice(0, -1)
    );

    send({
      type: "draw",
      room,
      element,
    });
  };

  /* CLEAR */

  const clear = () => {
    elementsRef.current = [];
    setElements([]);
    setRedoStack([]);

    send({
      type: "clear",
      room,
    });
  };

  /* DOWNLOAD */

  const downloadCanvas = () => {
    const canvas = canvasRef.current;

    if (!canvas) return;

    const link =
      document.createElement("a");

    link.download =
      `canvasly-${room}.png`;

    link.href =
      canvas.toDataURL("image/png");

    link.click();
  };

  /* COPY ROOM */

  const copyRoomLink = async () => {
    const url =
      `${window.location.origin}?room=${encodeURIComponent(
        room
      )}`;

    try {
      await navigator.clipboard.writeText(
        url
      );

      alert(
        "Room link copied!"
      );
    } catch {
      prompt(
        "Copy this room link:",
        url
      );
    }
  };

  /* KEYBOARD SHORTCUTS */

  useEffect(() => {
    const handleKeyDown = (
      event: KeyboardEvent
    ) => {
      const target =
        event.target as HTMLElement;

      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA"
      ) {
        return;
      }

      if (
        event.ctrlKey &&
        event.key.toLowerCase() === "z"
      ) {
        event.preventDefault();
        undo();
        return;
      }

      if (
        (event.ctrlKey &&
          event.key.toLowerCase() === "y") ||
        (event.ctrlKey &&
          event.shiftKey &&
          event.key.toLowerCase() === "z")
      ) {
        event.preventDefault();
        redo();
        return;
      }

      const key =
        event.key.toLowerCase();

      if (key === "p") setTool("pen");
      if (key === "e") setTool("eraser");
      if (key === "l") setTool("line");
      if (key === "a") setTool("arrow");
      if (key === "r") setTool("rectangle");
      if (key === "c") setTool("circle");
    };

    window.addEventListener(
      "keydown",
      handleKeyDown
    );

    return () => {
      window.removeEventListener(
        "keydown",
        handleKeyDown
      );
    };
  });

  /* ROOM FROM URL */

  useEffect(() => {
    const params =
      new URLSearchParams(
        window.location.search
      );

    const urlRoom =
      params.get("room");

    if (urlRoom) {
      setRoom(urlRoom);
    }
  }, []);

  const changeRoom = (
    value: string
  ) => {
    const newRoom =
      value.trim() || "main";

    setRoom(newRoom);

    window.history.replaceState(
      null,
      "",
      `?room=${encodeURIComponent(
        newRoom
      )}`
    );
  };

  const zoomIn = () => {
    setZoom((value) =>
      Math.min(1.5, value + 0.1)
    );
  };

  const zoomOut = () => {
    setZoom((value) =>
      Math.max(0.5, value - 0.1)
    );
  };

  const resetZoom = () => {
    setZoom(1);
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
          <div className="logo">
            C
          </div>

          <div>
            <h1>Canvasly</h1>

            <span>
              Real-time collaborative
              whiteboard
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
            : "Reconnecting..."}
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
          {toolButton(
            "pen",
            "✏️ Pen"
          )}

          {toolButton(
            "eraser",
            "🧹 Eraser"
          )}

          {toolButton(
            "line",
            "／ Line"
          )}

          {toolButton(
            "arrow",
            "➜ Arrow"
          )}

          {toolButton(
            "rectangle",
            "▭ Rectangle"
          )}

          {toolButton(
            "circle",
            "◯ Circle"
          )}
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
            disabled={
              tool === "eraser"
            }
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
              setSize(
                Number(e.target.value)
              )
            }
          />
        </label>

        <div className="divider" />

        <button
          className="action"
          onClick={undo}
        >
          ↶ Undo
        </button>

        <button
          className="action"
          onClick={redo}
          disabled={
            redoStack.length === 0
          }
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

        <div className="divider" />

        <div className="zoom">
          <button
            onClick={zoomOut}
          >
            −
          </button>

          <button
            onClick={resetZoom}
          >
            {Math.round(
              zoom * 100
            )}
            %
          </button>

          <button
            onClick={zoomIn}
          >
            +
          </button>
        </div>
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

          <div className="canvas-scroll">
            <div
              className="canvas-stage"
              style={{
                width: WIDTH * zoom,
                height: HEIGHT * zoom,
              }}
            >
              <canvas
                ref={canvasRef}
                width={WIDTH}
                height={HEIGHT}
                className="canvas"
                style={{
                  width:
                    WIDTH * zoom,
                  height:
                    HEIGHT * zoom,
                }}
                onPointerDown={
                  startDrawing
                }
                onPointerMove={
                  draw
                }
                onPointerUp={
                  stopDrawing
                }
                onPointerCancel={
                  stopDrawing
                }
                onPointerLeave={
                  sendCursor
                }
              />

              <div className="cursor-layer">
                {Object.entries(
                  cursors
                ).map(
                  ([id, cursor]) => (
                    <div
                      key={id}
                      className="remote-cursor"
                      style={{
                        left:
                          cursor.x *
                          zoom,
                        top:
                          cursor.y *
                          zoom,
                      }}
                    >
                      <div className="cursor-arrow">
                        ➤
                      </div>

                      <div className="cursor-name">
                        {cursor.name}
                      </div>
                    </div>
                  )
                )}
              </div>
            </div>
          </div>
        </div>
      </main>

      <footer>
        <span>
          ✨ Draw together in real time
        </span>

        <span>
          P Pen · E Eraser · L Line ·
          R Rectangle · C Circle ·
          Ctrl+Z Undo
        </span>
      </footer>
    </div>
  );
}

export default App;
