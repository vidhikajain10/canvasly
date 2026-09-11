import { useEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";
import "./App.css";

const WS_URL = "wss://canvasly-f0et.onrender.com";
const WIDTH = 1200;
const HEIGHT = 700;

type Tool = "pen" | "eraser" | "line" | "arrow" | "rectangle" | "circle";
type Point = { x: number; y: number };
type Element = { id: string; type: Tool; points: Point[]; color: string; size: number; user: string };
type Cursor = { x: number; y: number; name: string };
type ServerMessage =
  | { type: "welcome"; id: string }
  | { type: "sync"; elements: Element[] }
  | { type: "draw"; element: Element }
  | { type: "remove"; id: string }
  | { type: "clear" }
  | { type: "users"; count: number }
  | { type: "cursor"; id: string; x: number; y: number; name: string }
  | { type: "user_left"; id: string };

const getInitialRoom = () => new URLSearchParams(window.location.search).get("room")?.trim() || "main";

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<number | null>(null);
  const elementsRef = useRef<Element[]>([]);
  const nameRef = useRef("Guest");
  const activeElementId = useRef<string | null>(null);
  const myIdRef = useRef("");

  const [room, setRoom] = useState(getInitialRoom);
  const [roomInput, setRoomInput] = useState(getInitialRoom);
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

  useEffect(() => { elementsRef.current = elements; }, [elements]);
  useEffect(() => { nameRef.current = name.trim() || "Guest"; }, [name]);

  const send = (message: object) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) socketRef.current.send(JSON.stringify(message));
  };

  const joinRoom = () => {
    const next = roomInput.trim().replace(/\s+/g, "-").slice(0, 80) || "main";
    setRoomInput(next);
    window.history.replaceState({}, "", `?room=${encodeURIComponent(next)}`);
    if (next !== room) setRoom(next);
  };

  const copyRoomLink = async () => {
    const url = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(room)}`;
    try { await navigator.clipboard.writeText(url); window.alert("Room link copied!"); }
    catch { window.prompt("Copy this room link:", url); }
  };

  const drawArrow = (ctx: CanvasRenderingContext2D, from: Point, to: Point, width: number) => {
    const head = Math.max(12, width * 4);
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y);
    ctx.moveTo(to.x, to.y); ctx.lineTo(to.x - head * Math.cos(angle - Math.PI / 6), to.y - head * Math.sin(angle - Math.PI / 6));
    ctx.moveTo(to.x, to.y); ctx.lineTo(to.x - head * Math.cos(angle + Math.PI / 6), to.y - head * Math.sin(angle + Math.PI / 6));
    ctx.stroke();
  };

  const drawElement = (ctx: CanvasRenderingContext2D, element: Element) => {
    if (!element.points.length) return;
    const first = element.points[0];
    const last = element.points[element.points.length - 1];
    ctx.strokeStyle = element.type === "eraser" ? "#ffffff" : element.color;
    ctx.lineWidth = element.size; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.beginPath();
    if (element.type === "pen" || element.type === "eraser") {
      ctx.moveTo(first.x, first.y); for (let i = 1; i < element.points.length; i++) ctx.lineTo(element.points[i].x, element.points[i].y); ctx.stroke(); return;
    }
    if (element.type === "line") { ctx.moveTo(first.x, first.y); ctx.lineTo(last.x, last.y); ctx.stroke(); return; }
    if (element.type === "arrow") { drawArrow(ctx, first, last, element.size); return; }
    if (element.type === "rectangle") { ctx.strokeRect(first.x, first.y, last.x - first.x, last.y - first.y); return; }
    const dx = last.x - first.x, dy = last.y - first.y;
    ctx.arc(first.x, first.y, Math.sqrt(dx * dx + dy * dy), 0, Math.PI * 2); ctx.stroke();
  };

  const redrawCanvas = () => {
    const canvas = canvasRef.current, ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, WIDTH, HEIGHT); ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, WIDTH, HEIGHT);
    elementsRef.current.forEach((element) => drawElement(ctx, element));
    if (isDrawing && startPoint && currentPoint && tool !== "pen" && tool !== "eraser") {
      ctx.save(); ctx.globalAlpha = 0.55;
      drawElement(ctx, { id: "preview", type: tool, points: [startPoint, currentPoint], color, size, user: nameRef.current });
      ctx.restore();
    }
  };

  useEffect(() => { redrawCanvas(); }, [elements, isDrawing, startPoint, currentPoint, tool, color, size]);

  useEffect(() => {
    let stopped = false;
    const connect = () => {
      if (stopped) return;
      setStatus("connecting");
      const socket = new WebSocket(WS_URL); socketRef.current = socket;
      socket.onopen = () => { if (!stopped) { setStatus("connected"); socket.send(JSON.stringify({ type: "join", room, name: nameRef.current })); } };
      socket.onmessage = (event) => {
        try {
          const data: ServerMessage = JSON.parse(event.data);
          if (data.type === "welcome") myIdRef.current = data.id;
          else if (data.type === "sync") { elementsRef.current = data.elements; setElements(data.elements); setRedoStack([]); }
          else if (data.type === "draw") setElements((previous) => { const index = previous.findIndex((item) => item.id === data.element.id); const updated = [...previous]; if (index === -1) updated.push(data.element); else updated[index] = data.element; elementsRef.current = updated; return updated; });
          else if (data.type === "remove") setElements((previous) => { const updated = previous.filter((item) => item.id !== data.id); elementsRef.current = updated; return updated; });
          else if (data.type === "clear") { elementsRef.current = []; setElements([]); setRedoStack([]); }
          else if (data.type === "users") setUsers(data.count);
          else if (data.type === "cursor" && data.id !== myIdRef.current) setCursors((previous) => ({ ...previous, [data.id]: { x: data.x, y: data.y, name: data.name } }));
          else if (data.type === "user_left") setCursors((previous) => { const updated = { ...previous }; delete updated[data.id]; return updated; });
        } catch { console.log("Invalid server message"); }
      };
      socket.onclose = () => { socketRef.current = null; if (!stopped) { setStatus("disconnected"); reconnectTimer.current = window.setTimeout(connect, 2500); } };
      socket.onerror = () => setStatus("disconnected");
    };
    connect();
    return () => { stopped = true; if (reconnectTimer.current) clearTimeout(reconnectTimer.current); socketRef.current?.close(); socketRef.current = null; setCursors({}); };
  }, [room]);

  const getPoint = (event: PointerEvent<HTMLCanvasElement>): Point => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: ((event.clientX - rect.left) / rect.width) * WIDTH, y: ((event.clientY - rect.top) / rect.height) * HEIGHT };
  };
  const sendCursor = (event: PointerEvent<HTMLCanvasElement>) => { const point = getPoint(event); send({ type: "cursor", room, x: point.x, y: point.y, name: nameRef.current }); };
  const startDrawing = (event: PointerEvent<HTMLCanvasElement>) => {
    event.preventDefault(); const point = getPoint(event); event.currentTarget.setPointerCapture(event.pointerId); setIsDrawing(true); setStartPoint(point); setCurrentPoint(point);
    if (tool === "pen" || tool === "eraser") {
      const element: Element = { id: crypto.randomUUID(), type: tool, points: [point], color, size, user: nameRef.current }; activeElementId.current = element.id;
      const updated = [...elementsRef.current, element]; elementsRef.current = updated; setElements(updated); setRedoStack([]); send({ type: "draw", room, element });
    }
  };
  const draw = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return; event.preventDefault(); const point = getPoint(event); sendCursor(event); setCurrentPoint(point);
    if (tool === "pen" || tool === "eraser") {
      const id = activeElementId.current, current = elementsRef.current.find((item) => item.id === id); if (!id || !current) return;
      const updatedElement = { ...current, points: [...current.points, point] }; const updated = elementsRef.current.map((item) => item.id === id ? updatedElement : item);
      elementsRef.current = updated; setElements(updated); send({ type: "draw", room, element: updatedElement });
    }
  };
  const stopDrawing = (event?: PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    if (event?.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (startPoint && currentPoint && tool !== "pen" && tool !== "eraser") {
      const element: Element = { id: crypto.randomUUID(), type: tool, points: [startPoint, currentPoint], color, size, user: nameRef.current }; const updated = [...elementsRef.current, element];
      elementsRef.current = updated; setElements(updated); setRedoStack([]); send({ type: "draw", room, element });
    }
    activeElementId.current = null; setIsDrawing(false); setStartPoint(null); setCurrentPoint(null);
  };
  const undo = () => {
    const own = elementsRef.current.filter((item) => item.user === nameRef.current), last = own[own.length - 1]; if (!last) return;
    const updated = elementsRef.current.filter((item) => item.id !== last.id); elementsRef.current = updated; setElements(updated); setRedoStack((previous) => [...previous, last]); send({ type: "remove", room, id: last.id });
  };
  const redo = () => {
    const last = redoStack[redoStack.length - 1]; if (!last) return; const updated = [...elementsRef.current, last]; elementsRef.current = updated; setElements(updated); setRedoStack((previous) => previous.slice(0, -1)); send({ type: "draw", room, element: last });
  };
  const clearBoard = () => { if (!window.confirm("Clear this entire room for everyone?")) return; elementsRef.current = []; setElements([]); setRedoStack([]); send({ type: "clear", room }); };
  const download = () => { const canvas = canvasRef.current; if (!canvas) return; const link = document.createElement("a"); link.download = `canvasly-${room}.png`; link.href = canvas.toDataURL("image/png"); link.click(); };
  const changeZoom = (amount: number) => setZoom((previous) => Math.min(1.5, Math.max(0.5, previous + amount)));
  const tools: { id: Tool; label: string }[] = [
    { id: "pen", label: "✏️ Pen" }, { id: "eraser", label: "🧽 Eraser" }, { id: "line", label: "╱ Line" }, { id: "arrow", label: "➜ Arrow" }, { id: "rectangle", label: "▢ Rectangle" }, { id: "circle", label: "◯ Circle" }
  ];

  return <div className="app">
    <header className="topbar">
      <div className="brand"><div className="logo">C</div><div><h1>Canvasly</h1><span>Real-time collaborative canvas</span></div></div>
      <div className="connection"><span className={`status-dot ${status}`} />{status === "connected" ? "Connected" : status === "connecting" ? "Connecting…" : "Reconnecting…"}</div>
      <div className="top-actions">
        <input value={name} onChange={(event) => setName(event.target.value.slice(0, 30))} placeholder="Your name" aria-label="Your name" />
        <input value={roomInput} onChange={(event) => setRoomInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") joinRoom(); }} placeholder="Room name" aria-label="Room name" />
        <button className="secondary" onClick={joinRoom}>Join Room</button>
        <button className="secondary" onClick={copyRoomLink}>🔗 Share</button>
        <div className="users">👥 {users}</div>
      </div>
    </header>
    <div className="toolbar">
      <div className="tool-group">{tools.map((item) => <button key={item.id} className={`tool ${tool === item.id ? "active" : ""}`} onClick={() => setTool(item.id)}>{item.label}</button>)}</div>
      <div className="divider" />
      <label className="control">Color <input className="color-picker" type="color" value={color} onChange={(event) => setColor(event.target.value)} /></label>
      <label className="size-control"><span><span>Size</span><span>{size}px</span></span><input type="range" min="1" max="24" value={size} onChange={(event) => setSize(Number(event.target.value))} /></label>
      <div className="divider" />
      <button className="action" onClick={undo} disabled={!elements.some((item) => item.user === nameRef.current)}>↶ Undo</button>
      <button className="action" onClick={redo} disabled={!redoStack.length}>↷ Redo</button>
      <button className="action danger" onClick={clearBoard} disabled={!elements.length}>Clear</button>
      <button className="action download" onClick={download}>Download</button>
      <div className="divider" />
      <div className="zoom"><button onClick={() => changeZoom(-0.1)}>−</button><button onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button><button onClick={() => changeZoom(0.1)}>+</button></div>
    </div>
    <main className="workspace"><section className="canvas-wrapper">
      <div className="canvas-header"><span>Room: <strong>{room}</strong></span><span>{elements.length} objects · {Math.round(zoom * 100)}% zoom</span></div>
      <div className="canvas-scroll"><div className="canvas-stage" style={{ width: WIDTH * zoom, height: HEIGHT * zoom }}>
        <canvas ref={canvasRef} className="canvas" width={WIDTH} height={HEIGHT} style={{ width: WIDTH, height: HEIGHT, transform: `scale(${zoom})` }} onPointerDown={startDrawing} onPointerMove={draw} onPointerUp={stopDrawing} onPointerCancel={stopDrawing} />
        <div className="cursor-layer">{Object.entries(cursors).map(([id, cursor]) => <div key={id} className="remote-cursor" style={{ left: cursor.x * zoom, top: cursor.y * zoom }}><div className="cursor-arrow">↖</div><span className="cursor-name">{cursor.name}</span></div>)}</div>
      </div></div>
    </section></main>
    <footer><span>Canvasly • Room <strong>{room}</strong></span><span>Changes sync automatically and persist in the database.</span></footer>
  </div>;
}

export default App;
