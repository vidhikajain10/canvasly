import { useEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";
import "./App.css";

const WS_URL = "wss://canvasly-f0et.onrender.com";
const WIDTH = 1200;
const HEIGHT = 700;
const HANDLE = 9;

type Tool = "select" | "pen" | "eraser" | "line" | "arrow" | "rectangle" | "circle";
type Point = { x: number; y: number };
type Element = {
  id: string;
  type: Exclude<Tool, "select">;
  points: Point[];
  color: string;
  size: number;
  user: string;
};
type Cursor = { x: number; y: number; name: string };
type Handle = "nw" | "ne" | "sw" | "se" | null;
type PendingOperation = { opId: string; message: object };
type ServerMessage =
  | { type: "welcome"; id: string }
  | { type: "sync"; elements: Element[]; revision?: number }
  | { type: "draw"; element: Element; revision?: number; opId?: string }
  | { type: "remove"; id: string; revision?: number; opId?: string }
  | { type: "clear"; revision?: number; opId?: string }
  | { type: "users"; count: number }
  | { type: "cursor"; id: string; x: number; y: number; name: string }
  | { type: "user_left"; id: string };

const getRoomFromUrl = () =>
  new URLSearchParams(window.location.search).get("room")?.trim() || "main";

const cleanRoom = (value: string) =>
  value.trim().replace(/\s+/g, "-").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || "main";

const cacheKey = (room: string) => `canvasly:room:${room}`;
const pendingKey = (room: string) => `canvasly:pending:${room}`;

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<number | null>(null);
  const elementsRef = useRef<Element[]>([]);
  const nameRef = useRef("Guest");
  const activeElementId = useRef<string | null>(null);
  const myIdRef = useRef("");
  const selectedIdRef = useRef<string | null>(null);
  const dragRef = useRef<{
    start: Point;
    original: Element;
    mode: "move" | "resize";
    handle: Handle;
  } | null>(null);
  const pendingOpsRef = useRef<PendingOperation[]>([]);
  const syncReceivedRef = useRef(false);
  const cursorTimerRef = useRef<number | null>(null);
  const lastCursorRef = useRef<Point | null>(null);

  const [room, setRoom] = useState(getRoomFromUrl);
  const [roomInput, setRoomInput] = useState(getRoomFromUrl);
  const [name, setName] = useState("Guest");
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState("#111111");
  const [size, setSize] = useState(4);
  const [elements, setElements] = useState<Element[]>([]);
  const [redoStack, setRedoStack] = useState<Element[]>([]);
  const [users, setUsers] = useState(1);
  const [status, setStatus] = useState<"connecting" | "connected" | "disconnected">("connecting");
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPoint, setStartPoint] = useState<Point | null>(null);
  const [currentPoint, setCurrentPoint] = useState<Point | null>(null);
  const [cursors, setCursors] = useState<Record<string, Cursor>>({});
  const [zoom, setZoom] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    elementsRef.current = elements;
  }, [elements]);

  useEffect(() => {
    nameRef.current = name.trim() || "Guest";
  }, [name]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const saveLocalSnapshot = (next: Element[] = elementsRef.current) => {
    try {
      localStorage.setItem(cacheKey(room), JSON.stringify(next));
    } catch {
      // Local storage can be unavailable in private/restricted browser modes.
    }
  };

  const savePending = () => {
    try {
      localStorage.setItem(pendingKey(room), JSON.stringify(pendingOpsRef.current));
    } catch {
      // Ignore storage failures; realtime still works.
    }
  };

  const removePending = (opId: string) => {
    const next = pendingOpsRef.current.filter((operation) => operation.opId !== opId);
    if (next.length !== pendingOpsRef.current.length) {
      pendingOpsRef.current = next;
      savePending();
    }
  };

  const send = (message: object, opId?: string) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(opId ? { ...message, opId } : message));
    return true;
  };

  const queueOperation = (message: object) => {
    const opId = crypto.randomUUID();
    pendingOpsRef.current.push({ opId, message });
    savePending();
    send(message, opId);
    return opId;
  };

  const replayPending = () => {
    if (!syncReceivedRef.current || socketRef.current?.readyState !== WebSocket.OPEN) return;
    for (const operation of pendingOpsRef.current) {
      send(operation.message, operation.opId);
    }
  };

  const switchRoom = (value: string) => {
    const next = cleanRoom(value);
    setRoomInput(next);
    window.history.pushState({}, "", `${window.location.pathname}?room=${encodeURIComponent(next)}`);
    if (next === room) return;

    elementsRef.current = [];
    pendingOpsRef.current = [];
    syncReceivedRef.current = false;
    setElements([]);
    setRedoStack([]);
    setCursors({});
    setUsers(1);
    setSelectedId(null);
    setIsDrawing(false);
    setStartPoint(null);
    setCurrentPoint(null);
    setRoom(next);
  };

  const joinRoom = () => {
    const entered = window.prompt("Enter the room name:", roomInput || room);
    if (entered !== null) switchRoom(entered);
  };

  const copyRoomLink = async () => {
    const url = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(room)}`;
    try {
      await navigator.clipboard.writeText(url);
      window.alert(`Room link copied for: ${room}`);
    } catch {
      window.prompt("Copy this room link:", url);
    }
  };

  const drawArrow = (ctx: CanvasRenderingContext2D, from: Point, to: Point, width: number) => {
    const head = Math.max(12, width * 4);
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(to.x - head * Math.cos(angle - Math.PI / 6), to.y - head * Math.sin(angle - Math.PI / 6));
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(to.x - head * Math.cos(angle + Math.PI / 6), to.y - head * Math.sin(angle + Math.PI / 6));
    ctx.stroke();
  };

  const drawElement = (ctx: CanvasRenderingContext2D, element: Element) => {
    if (!element.points.length) return;
    const first = element.points[0];
    const last = element.points[element.points.length - 1];

    ctx.strokeStyle = element.type === "eraser" ? "#ffffff" : element.color;
    ctx.lineWidth = element.size;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();

    if (element.type === "pen" || element.type === "eraser") {
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < element.points.length; i += 1) {
        ctx.lineTo(element.points[i].x, element.points[i].y);
      }
      ctx.stroke();
      return;
    }

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
      ctx.strokeRect(first.x, first.y, last.x - first.x, last.y - first.y);
      return;
    }

    const radius = Math.max(1, Math.hypot(last.x - first.x, last.y - first.y));
    ctx.arc(first.x, first.y, radius, 0, Math.PI * 2);
    ctx.stroke();
  };

  const getBounds = (element: Element) => {
    if (element.type === "circle") {
      const p = element.points[0];
      const q = element.points[element.points.length - 1] || p;
      const radius = Math.max(1, Math.hypot(q.x - p.x, q.y - p.y));
      return {
        minX: p.x - radius,
        minY: p.y - radius,
        maxX: p.x + radius,
        maxY: p.y + radius,
      };
    }

    const xs = element.points.map((point) => point.x);
    const ys = element.points.map((point) => point.y);
    return {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
    };
  };

  const hitElement = (point: Point) => {
    const padding = 12;
    for (let i = elementsRef.current.length - 1; i >= 0; i -= 1) {
      const element = elementsRef.current[i];
      const bounds = getBounds(element);
      if (
        point.x >= bounds.minX - padding &&
        point.x <= bounds.maxX + padding &&
        point.y >= bounds.minY - padding &&
        point.y <= bounds.maxY + padding
      ) {
        return element;
      }
    }
    return null;
  };

  const hitHandle = (point: Point, element: Element): Handle => {
    const bounds = getBounds(element);
    const handles: { key: Handle; x: number; y: number }[] = [
      { key: "nw", x: bounds.minX, y: bounds.minY },
      { key: "ne", x: bounds.maxX, y: bounds.minY },
      { key: "sw", x: bounds.minX, y: bounds.maxY },
      { key: "se", x: bounds.maxX, y: bounds.maxY },
    ];
    return handles.find(
      (handle) => Math.abs(point.x - handle.x) <= HANDLE + 3 && Math.abs(point.y - handle.y) <= HANDLE + 3,
    )?.key || null;
  };

  const drawSelection = (ctx: CanvasRenderingContext2D, element: Element) => {
    const bounds = getBounds(element);
    ctx.save();
    ctx.strokeStyle = "#2563eb";
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 5]);
    ctx.strokeRect(
      bounds.minX - 4,
      bounds.minY - 4,
      Math.max(8, bounds.maxX - bounds.minX + 8),
      Math.max(8, bounds.maxY - bounds.minY + 8),
    );
    ctx.setLineDash([]);
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#2563eb";
    for (const [x, y] of [
      [bounds.minX, bounds.minY],
      [bounds.maxX, bounds.minY],
      [bounds.minX, bounds.maxY],
      [bounds.maxX, bounds.maxY],
    ]) {
      ctx.fillRect(x - HANDLE / 2, y - HANDLE / 2, HANDLE, HANDLE);
      ctx.strokeRect(x - HANDLE / 2, y - HANDLE / 2, HANDLE, HANDLE);
    }
    ctx.restore();
  };

  const redrawCanvas = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    elementsRef.current.forEach((element) => drawElement(ctx, element));

    if (isDrawing && startPoint && currentPoint && tool !== "select" && tool !== "pen" && tool !== "eraser") {
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

    if (selectedId) {
      const selected = elementsRef.current.find((item) => item.id === selectedId);
      if (selected) drawSelection(ctx, selected);
    }
  };

  useEffect(() => {
    redrawCanvas();
  }, [elements, isDrawing, startPoint, currentPoint, tool, color, size, selectedId]);

  useEffect(() => {
    let stopped = false;

    try {
      const cached = JSON.parse(localStorage.getItem(cacheKey(room)) || "null");
      if (Array.isArray(cached)) {
        elementsRef.current = cached;
        setElements(cached);
      }

      const pending = JSON.parse(localStorage.getItem(pendingKey(room)) || "[]");
      if (Array.isArray(pending)) {
        pendingOpsRef.current = pending.filter((item) => item?.opId && item?.message);
      }
    } catch {
      // Ignore malformed local cache.
    }

    const connect = () => {
      if (stopped) return;
      setStatus("connecting");
      const socket = new WebSocket(WS_URL);
      socketRef.current = socket;

      socket.onopen = () => {
        if (stopped) return;
        setStatus("connected");
        syncReceivedRef.current = false;
        socket.send(JSON.stringify({ type: "join", room, name: nameRef.current }));
      };

      socket.onmessage = (event) => {
        try {
          const data: ServerMessage = JSON.parse(event.data);

          if (data.type === "welcome") {
            myIdRef.current = data.id;
            return;
          }

          if (data.type === "sync") {
            syncReceivedRef.current = true;
            elementsRef.current = data.elements;
            setElements(data.elements);
            setRedoStack([]);
            setSelectedId(null);
            saveLocalSnapshot(data.elements);
            replayPending();
            return;
          }

          if (data.type === "draw") {
            if (data.opId) removePending(data.opId);
            setElements((previous) => {
              const index = previous.findIndex((item) => item.id === data.element.id);
              const updated = [...previous];
              if (index === -1) updated.push(data.element);
              else updated[index] = data.element;
              elementsRef.current = updated;
              saveLocalSnapshot(updated);
              return updated;
            });
            return;
          }

          if (data.type === "remove") {
            if (data.opId) removePending(data.opId);
            setElements((previous) => {
              const updated = previous.filter((item) => item.id !== data.id);
              elementsRef.current = updated;
              saveLocalSnapshot(updated);
              if (selectedIdRef.current === data.id) setSelectedId(null);
              return updated;
            });
            return;
          }

          if (data.type === "clear") {
            if (data.opId) removePending(data.opId);
            elementsRef.current = [];
            setElements([]);
            setRedoStack([]);
            setSelectedId(null);
            saveLocalSnapshot([]);
            return;
          }

          if (data.type === "users") {
            setUsers(data.count);
            return;
          }

          if (data.type === "cursor" && data.id !== myIdRef.current) {
            setCursors((previous) => ({
              ...previous,
              [data.id]: { x: data.x, y: data.y, name: data.name },
            }));
            return;
          }

          if (data.type === "user_left") {
            setCursors((previous) => {
              const updated = { ...previous };
              delete updated[data.id];
              return updated;
            });
          }
        } catch {
          console.log("Invalid server message");
        }
      };

      socket.onclose = () => {
        socketRef.current = null;
        syncReceivedRef.current = false;
        if (!stopped) {
          setStatus("disconnected");
          reconnectTimer.current = window.setTimeout(connect, 2500);
        }
      };

      socket.onerror = () => setStatus("disconnected");
    };

    connect();

    return () => {
      stopped = true;
      if (reconnectTimer.current) window.clearTimeout(reconnectTimer.current);
      socketRef.current?.close();
      socketRef.current = null;
      if (cursorTimerRef.current) window.clearTimeout(cursorTimerRef.current);
      setCursors({});
    };
  }, [room]);

  const getPoint = (event: PointerEvent<HTMLCanvasElement>): Point => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * WIDTH,
      y: ((event.clientY - rect.top) / rect.height) * HEIGHT,
    };
  };

  const sendCursor = (point: Point) => {
    lastCursorRef.current = point;
    if (cursorTimerRef.current) return;

    const sendLatest = () => {
      cursorTimerRef.current = null;
      const latest = lastCursorRef.current;
      if (latest) {
        send({ type: "cursor", room, x: latest.x, y: latest.y, name: nameRef.current });
      }
    };

    sendLatest();
    cursorTimerRef.current = window.setTimeout(sendLatest, 30);
  };

  const deleteSelected = () => {
    const id = selectedIdRef.current;
    if (!id) return;
    const updated = elementsRef.current.filter((item) => item.id !== id);
    elementsRef.current = updated;
    setElements(updated);
    saveLocalSnapshot(updated);
    setRedoStack([]);
    setSelectedId(null);
    queueOperation({ type: "remove", room, id });
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.key === "Delete" || event.key === "Backspace") && selectedIdRef.current) {
        event.preventDefault();
        deleteSelected();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const startDrawing = (event: PointerEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const point = getPoint(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    sendCursor(point);

    if (tool === "select") {
      const selected = selectedIdRef.current
        ? elementsRef.current.find((item) => item.id === selectedIdRef.current)
        : null;
      const handle = selected ? hitHandle(point, selected) : null;

      if (selected && handle) {
        dragRef.current = {
          start: point,
          original: { ...selected, points: selected.points.map((p) => ({ ...p })) },
          mode: "resize",
          handle,
        };
      } else {
        const hit = hitElement(point);
        setSelectedId(hit?.id || null);
        if (hit) {
          dragRef.current = {
            start: point,
            original: { ...hit, points: hit.points.map((p) => ({ ...p })) },
            mode: "move",
            handle: null,
          };
        } else {
          dragRef.current = null;
        }
      }
      return;
    }

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
        user: nameRef.current,
      };
      activeElementId.current = element.id;
      const updated = [...elementsRef.current, element];
      elementsRef.current = updated;
      setElements(updated);
      setRedoStack([]);
      saveLocalSnapshot(updated);
    }
  };

  const draw = (event: PointerEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const point = getPoint(event);
    sendCursor(point);

    if (tool === "select") {
      const drag = dragRef.current;
      if (!drag) return;
      const current = elementsRef.current.find((item) => item.id === drag.original.id);
      if (!current) return;

      let updatedElement: Element;

      if (drag.mode === "move") {
        const dx = point.x - drag.start.x;
        const dy = point.y - drag.start.y;
        updatedElement = {
          ...drag.original,
          points: drag.original.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
        };
      } else {
        const bounds = getBounds(drag.original);
        const handle = drag.handle!;
        const anchorX = handle.includes("e") ? bounds.minX : bounds.maxX;
        const anchorY = handle.includes("s") ? bounds.minY : bounds.maxY;
        const newX = handle.includes("e")
          ? Math.max(anchorX + 4, point.x)
          : Math.min(anchorX - 4, point.x);
        const newY = handle.includes("s")
          ? Math.max(anchorY + 4, point.y)
          : Math.min(anchorY - 4, point.y);
        const oldW = Math.max(1, bounds.maxX - bounds.minX);
        const oldH = Math.max(1, bounds.maxY - bounds.minY);
        const newW = Math.max(4, Math.abs(newX - anchorX));
        const newH = Math.max(4, Math.abs(newY - anchorY));
        const sx = newW / oldW;
        const sy = newH / oldH;

        updatedElement = {
          ...drag.original,
          points: drag.original.points.map((p) => ({
            x: anchorX + (p.x - anchorX) * sx,
            y: anchorY + (p.y - anchorY) * sy,
          })),
        };
      }

      const updated = elementsRef.current.map((item) =>
        item.id === updatedElement.id ? updatedElement : item,
      );
      elementsRef.current = updated;
      setElements(updated);
      setRedoStack([]);
      saveLocalSnapshot(updated);
      send({ type: "draw", room, element: updatedElement });
      return;
    }

    if (!isDrawing) return;
    setCurrentPoint(point);

    if (tool === "pen" || tool === "eraser") {
      const id = activeElementId.current;
      const current = elementsRef.current.find((item) => item.id === id);
      if (!id || !current) return;

      const updatedElement = {
        ...current,
        points: [...current.points, point],
      };
      const updated = elementsRef.current.map((item) =>
        item.id === id ? updatedElement : item,
      );
      elementsRef.current = updated;
      setElements(updated);
      saveLocalSnapshot(updated);
      send({ type: "draw", room, element: updatedElement });
    }
  };

  const stopDrawing = (event?: PointerEvent<HTMLCanvasElement>) => {
    if (event?.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (tool === "select") {
      const drag = dragRef.current;
      if (drag) {
        const finalElement = elementsRef.current.find((item) => item.id === drag.original.id);
        if (finalElement) queueOperation({ type: "draw", room, element: finalElement });
      }
      dragRef.current = null;
      return;
    }

    if (!isDrawing) return;

    if (startPoint && currentPoint && tool !== "pen" && tool !== "eraser") {
      const element: Element = {
        id: crypto.randomUUID(),
        type: tool,
        points: [startPoint, currentPoint],
        color,
        size,
        user: nameRef.current,
      };
      const updated = [...elementsRef.current, element];
      elementsRef.current = updated;
      setElements(updated);
      setRedoStack([]);
      saveLocalSnapshot(updated);
      queueOperation({ type: "draw", room, element });
    } else if (activeElementId.current) {
      const finalElement = elementsRef.current.find((item) => item.id === activeElementId.current);
      if (finalElement) queueOperation({ type: "draw", room, element: finalElement });
    }

    activeElementId.current = null;
    setIsDrawing(false);
    setStartPoint(null);
    setCurrentPoint(null);
  };

  const undo = () => {
    const own = elementsRef.current.filter((item) => item.user === nameRef.current);
    const last = own[own.length - 1];
    if (!last) return;

    const updated = elementsRef.current.filter((item) => item.id !== last.id);
    elementsRef.current = updated;
    setElements(updated);
    saveLocalSnapshot(updated);
    setRedoStack((previous) => [...previous, last]);
    if (selectedIdRef.current === last.id) setSelectedId(null);
    queueOperation({ type: "remove", room, id: last.id });
  };

  const redo = () => {
    const last = redoStack[redoStack.length - 1];
    if (!last) return;

    const updated = [...elementsRef.current, last];
    elementsRef.current = updated;
    setElements(updated);
    saveLocalSnapshot(updated);
    setRedoStack((previous) => previous.slice(0, -1));
    queueOperation({ type: "draw", room, element: last });
  };

  const clearBoard = () => {
    if (!window.confirm(`Clear the entire '${room}' room for everyone?`)) return;
    elementsRef.current = [];
    setElements([]);
    saveLocalSnapshot([]);
    setRedoStack([]);
    setSelectedId(null);
    queueOperation({ type: "clear", room });
  };

  const download = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `canvasly-${room}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  const changeZoom = (amount: number) =>
    setZoom((previous) => Math.min(1.5, Math.max(0.5, previous + amount)));

  const tools: { id: Tool; label: string }[] = [
    { id: "select", label: "↖ Select" },
    { id: "pen", label: "✏️ Pen" },
    { id: "eraser", label: "🧽 Eraser" },
    { id: "line", label: "╱ Line" },
    { id: "arrow", label: "➜ Arrow" },
    { id: "rectangle", label: "▢ Rectangle" },
    { id: "circle", label: "◯ Circle" },
  ];

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="logo">C</div>
          <div>
            <h1>Canvasly</h1>
            <span>Real-time collaborative canvas</span>
          </div>
        </div>

        <div className="connection">
          <span className={`status-dot ${status}`} />
          {status === "connected"
            ? "Connected"
            : status === "connecting"
              ? "Connecting…"
              : "Reconnecting…"}
        </div>

        <div className="top-actions">
          <input
            value={name}
            onChange={(event) => setName(event.target.value.slice(0, 30))}
            placeholder="Your name"
            aria-label="Your name"
          />
          <input
            className="room-input"
            value={roomInput}
            onChange={(event) => setRoomInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") switchRoom(roomInput);
            }}
            placeholder="Room name"
            aria-label="Room name"
            autoComplete="off"
          />
          <button className="secondary" onClick={() => switchRoom(roomInput)}>
            Join Room
          </button>
          <button className="secondary" onClick={joinRoom}>
            Room…
          </button>
          <button className="secondary" onClick={copyRoomLink}>
            🔗 Share
          </button>
          <div className="users">👥 {users}</div>
        </div>
      </header>

      <div className="toolbar">
        <div className="tool-group">
          {tools.map((item) => (
            <button
              key={item.id}
              className={`tool ${tool === item.id ? "active" : ""}`}
              onClick={() => setTool(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="divider" />
        <label className="control">
          Color
          <input
            className="color-picker"
            type="color"
            value={color}
            onChange={(event) => setColor(event.target.value)}
          />
        </label>
        <label className="size-control">
          <span>
            <span>Size</span>
            <span>{size}px</span>
          </span>
          <input
            type="range"
            min="1"
            max="24"
            value={size}
            onChange={(event) => setSize(Number(event.target.value))}
          />
        </label>
        <div className="divider" />
        <button
          className="action"
          onClick={undo}
          disabled={!elements.some((item) => item.user === nameRef.current)}
        >
          ↶ Undo
        </button>
        <button className="action" onClick={redo} disabled={!redoStack.length}>
          ↷ Redo
        </button>
        <button className="action" onClick={deleteSelected} disabled={!selectedId}>
          Delete
        </button>
        <button className="action danger" onClick={clearBoard} disabled={!elements.length}>
          Clear
        </button>
        <button className="action download" onClick={download}>
          Download
        </button>
        <div className="divider" />
        <div className="zoom">
          <button onClick={() => changeZoom(-0.1)}>−</button>
          <button onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
          <button onClick={() => changeZoom(0.1)}>+</button>
        </div>
      </div>

      <main className="workspace">
        <section className="canvas-wrapper">
          <div className="canvas-header">
            <span>
              Room: <strong>{room}</strong>
            </span>
            <span>
              {elements.length} objects · {selectedId ? "1 selected · " : ""}
              {Math.round(zoom * 100)}% zoom
            </span>
          </div>

          <div className="canvas-scroll">
            <div
              className="canvas-stage"
              style={{ width: WIDTH * zoom, height: HEIGHT * zoom }}
            >
              <canvas
                ref={canvasRef}
                className="canvas"
                width={WIDTH}
                height={HEIGHT}
                style={{
                  width: WIDTH,
                  height: HEIGHT,
                  transform: `scale(${zoom})`,
                  cursor: tool === "select" ? "default" : "crosshair",
                }}
                onPointerDown={startDrawing}
                onPointerMove={draw}
                onPointerUp={stopDrawing}
                onPointerCancel={stopDrawing}
                onPointerLeave={(event) => {
                  if (!isDrawing && tool !== "select") sendCursor(getPoint(event));
                }}
              />
              <div className="cursor-layer">
                {Object.entries(cursors).map(([id, cursor]) => (
                  <div
                    key={id}
                    className="remote-cursor"
                    style={{ left: cursor.x * zoom, top: cursor.y * zoom }}
                  >
                    <div className="cursor-arrow">↖</div>
                    <span className="cursor-name">{cursor.name}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer>
        <span>
          Canvasly • Room <strong>{room}</strong>
        </span>
        <span>
          {status === "connected"
            ? "Changes sync automatically and persist in the database."
            : "Offline changes are saved locally and will sync when reconnected."}
        </span>
      </footer>
    </div>
  );
}

export default App;
