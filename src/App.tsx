import { useEffect, useRef, useState } from "react";
import type { PointerEvent, CSSProperties } from "react";
import "./App.css";

const WS_URL = "wss://canvasly-f0et.onrender.com";
const WIDTH = 1200;
const HEIGHT = 700;
const HANDLE = 9;

type Tool = "select" | "pen" | "eraser" | "line" | "arrow" | "rectangle" | "circle" | "text" | "sticky";
type Point = { x: number; y: number };
type Element = { id: string; type: Exclude<Tool, "select">; points: Point[]; color: string; size: number; user: string; text?: string; fill?: boolean };
type Cursor = { x: number; y: number; name: string; color: string };
type PresenceUser = { id: string; name: string; color: string; drawing: boolean };
type PendingOperation = { opId: string; message: object };
type ServerMessage =
  | { type: "welcome"; id: string; color?: string }
  | { type: "sync"; elements: Element[]; revision?: number }
  | { type: "draw"; element: Element; revision?: number; opId?: string }
  | { type: "remove"; id: string; revision?: number; opId?: string }
  | { type: "clear"; revision?: number; opId?: string }
  | { type: "users"; count: number }
  | { type: "presence"; users: PresenceUser[] }
  | { type: "cursor"; id: string; x: number; y: number; name: string; color?: string }
  | { type: "user_left"; id: string };
type Handle = "nw" | "ne" | "sw" | "se" | null;

const getRoom = () => new URLSearchParams(window.location.search).get("room")?.trim() || "main";
const cleanRoom = (v: string) => v.trim().replace(/\s+/g, "-").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || "main";
const cacheKey = (room: string) => `canvasly:room:${room}`;
const pendingKey = (room: string) => `canvasly:pending:${room}`;

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<number | null>(null);
  const cursorFrameRef = useRef<number | null>(null);
  const elementsRef = useRef<Element[]>([]);
  const nameRef = useRef("Guest");
  const myIdRef = useRef("");
  const pendingRef = useRef<PendingOperation[]>([]);
  const syncRef = useRef(false);
  const activeIdRef = useRef<string | null>(null);
  const dragRef = useRef<{ start: Point; originals: Element[]; mode: "move" | "resize"; handle: Handle } | null>(null);
  const clipboardRef = useRef<Element[]>([]);
  const panRef = useRef<{ active: boolean; x: number; y: number; sx: number; sy: number }>({ active: false, x: 0, y: 0, sx: 0, sy: 0 });

  const [room, setRoom] = useState(getRoom);
  const [roomInput, setRoomInput] = useState(getRoom);
  const [name, setName] = useState("Guest");
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState("#111111");
  const [size, setSize] = useState(4);
  const [fill, setFill] = useState(false);
  const [elements, setElements] = useState<Element[]>([]);
  const [redo, setRedo] = useState<Element[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [users, setUsers] = useState(1);
  const [presence, setPresence] = useState<PresenceUser[]>([]);
  const [showPresence, setShowPresence] = useState(false);
  const [status, setStatus] = useState<"connecting" | "connected" | "disconnected">("connecting");
  const [drawing, setDrawing] = useState(false);
  const [start, setStart] = useState<Point | null>(null);
  const [current, setCurrent] = useState<Point | null>(null);
  const [cursors, setCursors] = useState<Record<string, Cursor>>({});
  const [zoom, setZoom] = useState(1);
  const [space, setSpace] = useState(false);

  useEffect(() => { elementsRef.current = elements; }, [elements]);
  useEffect(() => { nameRef.current = name.trim() || "Guest"; }, [name]);

  const save = (next = elementsRef.current) => { try { localStorage.setItem(cacheKey(room), JSON.stringify(next)); } catch {} };
  const savePending = () => { try { localStorage.setItem(pendingKey(room), JSON.stringify(pendingRef.current)); } catch {} };
  const send = (message: object, opId?: string) => { const s = socketRef.current; if (!s || s.readyState !== WebSocket.OPEN) return false; s.send(JSON.stringify(opId ? { ...message, opId } : message)); return true; };
  const queue = (message: object) => { const opId = crypto.randomUUID(); pendingRef.current.push({ opId, message }); savePending(); send(message, opId); };
  const removePending = (opId: string) => { pendingRef.current = pendingRef.current.filter((x) => x.opId !== opId); savePending(); };

  const setBoard = (next: Element[]) => { elementsRef.current = next; setElements(next); save(next); };
  const bounds = (e: Element) => {
    if (e.type === "circle") { const p = e.points[0], q = e.points[e.points.length - 1] || p, r = Math.max(1, Math.hypot(q.x - p.x, q.y - p.y)); return { minX: p.x - r, minY: p.y - r, maxX: p.x + r, maxY: p.y + r }; }
    if (e.type === "text") { const p = e.points[0]; const w = Math.max(30, (e.text || "").length * Math.max(8, e.size * 2.2)); return { minX: p.x, minY: p.y - e.size * 4, maxX: p.x + w, maxY: p.y + e.size * 2 }; }
    const xs = e.points.map((p) => p.x), ys = e.points.map((p) => p.y);
    return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
  };
  const drawArrow = (ctx: CanvasRenderingContext2D, a: Point, b: Point, w: number) => { const head = Math.max(12, w * 4), angle = Math.atan2(b.y - a.y, b.x - a.x); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - head * Math.cos(angle - Math.PI / 6), b.y - head * Math.sin(angle - Math.PI / 6)); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - head * Math.cos(angle + Math.PI / 6), b.y - head * Math.sin(angle + Math.PI / 6)); ctx.stroke(); };
  const drawElement = (ctx: CanvasRenderingContext2D, e: Element) => {
    if (!e.points.length) return;
    const a = e.points[0], b = e.points[e.points.length - 1];
    ctx.lineWidth = e.size; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = e.type === "eraser" ? "#ffffff" : e.color;
    if (e.type === "text") { ctx.fillStyle = e.color; ctx.font = `600 ${Math.max(12, e.size * 4)}px Inter, Arial, sans-serif`; ctx.textBaseline = "alphabetic"; (e.text || "").split("\n").forEach((line, i) => ctx.fillText(line, a.x, a.y + i * Math.max(16, e.size * 5))); return; }
    if (e.type === "sticky") { const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.max(80, Math.abs(b.x - a.x)), h = Math.max(70, Math.abs(b.y - a.y)); ctx.fillStyle = e.color; ctx.fillRect(x, y, w, h); ctx.strokeStyle = "rgba(0,0,0,.18)"; ctx.strokeRect(x, y, w, h); ctx.fillStyle = "#111827"; ctx.font = `600 ${Math.max(12, e.size * 3)}px Inter, Arial, sans-serif`; (e.text || "Note").split("\n").forEach((line, i) => ctx.fillText(line, x + 12, y + 24 + i * Math.max(15, e.size * 4))); return; }
    ctx.beginPath();
    if (e.type === "pen" || e.type === "eraser") { ctx.moveTo(a.x, a.y); e.points.slice(1).forEach((p) => ctx.lineTo(p.x, p.y)); ctx.stroke(); return; }
    if (e.type === "line") { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); return; }
    if (e.type === "arrow") { drawArrow(ctx, a, b, e.size); return; }
    if (e.type === "rectangle") { const x = Math.min(a.x,b.x), y = Math.min(a.y,b.y), w = Math.abs(b.x-a.x), h = Math.abs(b.y-a.y); if (e.fill) { ctx.fillStyle = e.color; ctx.globalAlpha = .22; ctx.fillRect(x,y,w,h); ctx.globalAlpha = 1; } ctx.strokeRect(x,y,w,h); return; }
    if (e.type === "circle") { const r = Math.max(1, Math.hypot(b.x-a.x,b.y-a.y)); if (e.fill) { ctx.fillStyle=e.color; ctx.globalAlpha=.22; ctx.beginPath(); ctx.arc(a.x,a.y,r,0,Math.PI*2); ctx.fill(); ctx.globalAlpha=1; } ctx.beginPath(); ctx.arc(a.x,a.y,r,0,Math.PI*2); ctx.stroke(); }
  };
  const hit = (p: Point) => { for (let i = elementsRef.current.length - 1; i >= 0; i--) { const b = bounds(elementsRef.current[i]); if (p.x >= b.minX-10 && p.x <= b.maxX+10 && p.y >= b.minY-10 && p.y <= b.maxY+10) return elementsRef.current[i]; } return null; };
  const handleAt = (p: Point, e: Element): Handle => { const b=bounds(e); const hs:[Handle,number,number][]=[["nw",b.minX,b.minY],["ne",b.maxX,b.minY],["sw",b.minX,b.maxY],["se",b.maxX,b.maxY]]; return hs.find((h)=>Math.abs(p.x-h[1])<HANDLE+4&&Math.abs(p.y-h[2])<HANDLE+4)?.[0]||null; };

  const redraw = () => { const c=canvasRef.current, ctx=c?.getContext("2d"); if(!c||!ctx)return; ctx.clearRect(0,0,WIDTH,HEIGHT); ctx.fillStyle="#fff"; ctx.fillRect(0,0,WIDTH,HEIGHT); elementsRef.current.forEach((e)=>drawElement(ctx,e)); if(drawing&&start&&current&&tool!=="select"&&tool!=="pen"&&tool!=="eraser"&&tool!=="text"&&tool!=="sticky") { ctx.save();ctx.globalAlpha=.5;drawElement(ctx,{id:"preview",type:tool,points:[start,current],color,size,user:nameRef.current,fill});ctx.restore(); } selectedIds.forEach((id)=>{const e=elementsRef.current.find(x=>x.id===id);if(!e)return;const b=bounds(e);ctx.save();ctx.strokeStyle="#2563eb";ctx.lineWidth=2;ctx.setLineDash([6,4]);ctx.strokeRect(b.minX-5,b.minY-5,Math.max(10,b.maxX-b.minX+10),Math.max(10,b.maxY-b.minY+10));ctx.setLineDash([]);[[b.minX,b.minY],[b.maxX,b.minY],[b.minX,b.maxY],[b.maxX,b.maxY]].forEach(([x,y])=>{ctx.fillStyle="#fff";ctx.fillRect(x-HANDLE/2,y-HANDLE/2,HANDLE,HANDLE);ctx.strokeRect(x-HANDLE/2,y-HANDLE/2,HANDLE,HANDLE)});ctx.restore();}); };
  useEffect(()=>{redraw();},[elements,drawing,start,current,tool,color,size,fill,selectedIds,zoom]);

  useEffect(() => {
    let stopped=false;
    try { const cached=JSON.parse(localStorage.getItem(cacheKey(room))||"null"); if(Array.isArray(cached)){elementsRef.current=cached;setElements(cached);} const p=JSON.parse(localStorage.getItem(pendingKey(room))||"[]"); if(Array.isArray(p))pendingRef.current=p; } catch {}
    const connect=()=>{if(stopped)return;setStatus("connecting");const s=new WebSocket(WS_URL);socketRef.current=s;s.onopen=()=>{setStatus("connected");syncRef.current=false;s.send(JSON.stringify({type:"join",room,name:nameRef.current}));};s.onmessage=(ev)=>{try{const d:ServerMessage=JSON.parse(ev.data);if(d.type==="welcome"){myIdRef.current=d.id;return;}if(d.type==="sync"){syncRef.current=true;setBoard(d.elements);setRedo([]);setSelectedIds([]);pendingRef.current.forEach((p)=>send(p.message,p.opId));return;}if(d.type==="presence"){setPresence(d.users);setUsers(d.users.length);return;}if(d.type==="draw"){if(d.opId)removePending(d.opId);setBoard([...elementsRef.current.filter(x=>x.id!==d.element.id),d.element]);return;}if(d.type==="remove"){if(d.opId)removePending(d.opId);setBoard(elementsRef.current.filter(x=>x.id!==d.id));setSelectedIds(x=>x.filter(id=>id!==d.id));return;}if(d.type==="clear"){if(d.opId)removePending(d.opId);setBoard([]);setRedo([]);setSelectedIds([]);return;}if(d.type==="users"){setUsers(d.count);return;}if(d.type==="cursor"&&d.id!==myIdRef.current){setCursors(x=>({...x,[d.id]:{x:d.x,y:d.y,name:d.name,color:d.color||"#2563eb"}}));return;}if(d.type==="user_left"){setCursors(x=>{const n={...x};delete n[d.id];return n;});setPresence(x=>x.filter(u=>u.id!==d.id));}}catch{}};s.onclose=()=>{socketRef.current=null;if(!stopped){setStatus("disconnected");reconnectRef.current=window.setTimeout(connect,2500);}};s.onerror=()=>setStatus("disconnected");};
    connect(); return()=>{stopped=true;if(reconnectRef.current)clearTimeout(reconnectRef.current);socketRef.current?.close();if(cursorFrameRef.current)cancelAnimationFrame(cursorFrameRef.current);};
  },[room]);

  const point=(e:PointerEvent<HTMLCanvasElement>):Point=>{const r=canvasRef.current!.getBoundingClientRect();return{x:((e.clientX-r.left)/r.width)*WIDTH,y:((e.clientY-r.top)/r.height)*HEIGHT};};
  const sendCursor=(p:Point)=>{if(cursorFrameRef.current)return;cursorFrameRef.current=requestAnimationFrame(()=>{cursorFrameRef.current=null;send({type:"cursor",room,x:p.x,y:p.y,name:nameRef.current});});};
  const createElement=(p:Point,q:Point,text?:string):Element=>({id:crypto.randomUUID(),type:tool,points:[p,q],color,size,user:nameRef.current,text,fill});
  const startPointer=(e:PointerEvent<HTMLCanvasElement>)=>{
    e.preventDefault(); const p=point(e); e.currentTarget.setPointerCapture(e.pointerId); sendCursor(p);
    if(space){panRef.current={active:true,x:scrollRef.current?.scrollLeft||0,y:scrollRef.current?.scrollTop||0,sx:e.clientX,sy:e.clientY};return;}
    if(tool==="select"){
      const first=selectedIds.length?elementsRef.current.find(x=>x.id===selectedIds[0]):null; const h=first?handleAt(p,first):null; const target=hit(p);
      if(first&&h){dragRef.current={start:p,originals:[{...first,points:first.points.map(x=>({...x}))}],mode:"resize",handle:h};}
      else if(target){let ids=selectedIds.includes(target.id)?selectedIds:[target.id];if(e.shiftKey)ids=selectedIds.includes(target.id)?selectedIds.filter(x=>x!==target.id):[...selectedIds,target.id];setSelectedIds(ids);dragRef.current={start:p,originals:elementsRef.current.filter(x=>ids.includes(x.id)).map(x=>({...x,points:x.points.map(y=>({...y}))})),mode:"move",handle:null};}
      else if(!e.shiftKey)setSelectedIds([]); return;
    }
    if(tool==="text"||tool==="sticky"){const text=window.prompt(tool==="text"?"Enter text":"Enter sticky note");if(!text)return;const q=tool==="text"?{x:p.x+Math.max(80,text.length*size*2.2),y:p.y+size*6}:{x:p.x+220,y:p.y+140};const el=createElement(p,q,text);setBoard([...elementsRef.current,el]);setRedo([]);queue({type:"draw",room,element:el});return;}
    setDrawing(true);setStart(p);setCurrent(p);send({type:"activity",room,drawing:true});
    if(tool==="pen"||tool==="eraser"){const el=createElement(p,p);activeIdRef.current=el.id;setBoard([...elementsRef.current,el]);setRedo([]);}
  };
  const movePointer=(e:PointerEvent<HTMLCanvasElement>)=>{
    e.preventDefault(); if(space&&panRef.current.active){const sc=scrollRef.current;if(sc){sc.scrollLeft=panRef.current.x-(e.clientX-panRef.current.sx);sc.scrollTop=panRef.current.y-(e.clientY-panRef.current.sy);}return;}
    const p=point(e);sendCursor(p);
    if(tool==="select"){const d=dragRef.current;if(!d)return;if(d.mode==="move"){const dx=p.x-d.start.x,dy=p.y-d.start.y;const ids=new Set(d.originals.map(x=>x.id));setBoard(elementsRef.current.map(x=>ids.has(x.id)?{...x,points:x.points.map(y=>({x:y.x+dx,y:y.y+dy}))}:x));}else{const o=d.originals[0],b=bounds(o),h=d.handle!;const ax=h.includes("e")?b.minX:b.maxX,ay=h.includes("s")?b.minY:b.maxY;const nx=h.includes("e")?Math.max(ax+4,p.x):Math.min(ax-4,p.x),ny=h.includes("s")?Math.max(ay+4,p.y):Math.min(ay-4,p.y);const sx=Math.max(4,Math.abs(nx-ax))/Math.max(1,b.maxX-b.minX),sy=Math.max(4,Math.abs(ny-ay))/Math.max(1,b.maxY-b.minY);setBoard(elementsRef.current.map(x=>x.id===o.id?{...x,points:x.points.map(y=>({x:ax+(y.x-ax)*sx,y:ay+(y.y-ay)*sy}))}:x));}return;}
    if(!drawing)return;setCurrent(p);if(tool==="pen"||tool==="eraser"){const id=activeIdRef.current;if(!id)return;setBoard(elementsRef.current.map(x=>x.id===id?{...x,points:[...x.points,p]}:x));}
  };
  const stopPointer=(e:PointerEvent<HTMLCanvasElement>)=>{
    if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);if(space){panRef.current.active=false;return;}
    if(tool==="select"){const d=dragRef.current;if(d){const ids=new Set(d.originals.map(x=>x.id));elementsRef.current.filter(x=>ids.has(x.id)).forEach(el=>queue({type:"draw",room,element:el}));}dragRef.current=null;return;}
    if(!drawing)return;if(start&&current&&tool!=="pen"&&tool!=="eraser"){const el=createElement(start,current);setBoard([...elementsRef.current,el]);queue({type:"draw",room,element:el});}else if(activeIdRef.current){const el=elementsRef.current.find(x=>x.id===activeIdRef.current);if(el)queue({type:"draw",room,element:el});}activeIdRef.current=null;setDrawing(false);setStart(null);setCurrent(null);send({type:"activity",room,drawing:false});
  };

  const removeIds=(ids:string[])=>{if(!ids.length)return;setBoard(elementsRef.current.filter(x=>!ids.includes(x.id)));setSelectedIds([]);ids.forEach(id=>queue({type:"remove",room,id}));};
  const copy=()=>{clipboardRef.current=elementsRef.current.filter(x=>selectedIds.includes(x.id)).map(x=>({...x,points:x.points.map(p=>({...p}))}));};
  const paste=()=>{if(!clipboardRef.current.length)return;const made=clipboardRef.current.map(x=>({...x,id:crypto.randomUUID(),points:x.points.map(p=>({x:p.x+30,y:p.y+30})),user:nameRef.current}));setBoard([...elementsRef.current,...made]);setSelectedIds(made.map(x=>x.id));made.forEach(x=>queue({type:"draw",room,element:x}));};
  const duplicate=()=>{copy();paste();};
  const undoAction=()=>{const own=elementsRef.current.filter(x=>x.user===nameRef.current);const last=own[own.length-1];if(!last)return;setBoard(elementsRef.current.filter(x=>x.id!==last.id));setRedo(x=>[...x,last]);queue({type:"remove",room,id:last.id});setSelectedIds([]);};
  const redoAction=()=>{const last=redo[redo.length-1];if(!last)return;setBoard([...elementsRef.current,last]);setRedo(x=>x.slice(0,-1));queue({type:"draw",room,element:last});};

  useEffect(()=>{const down=(e:KeyboardEvent)=>{if(e.code==="Space"&&!e.repeat){setSpace(true);e.preventDefault();}const mod=e.ctrlKey||e.metaKey;if(mod&&e.key.toLowerCase()==="z"){e.preventDefault();undoAction();}else if(mod&&e.key.toLowerCase()==="y"){e.preventDefault();redoAction();}else if(mod&&e.key.toLowerCase()==="c"){if(selectedIds.length){e.preventDefault();copy();}}else if(mod&&e.key.toLowerCase()==="v"){e.preventDefault();paste();}else if(mod&&e.key.toLowerCase()==="d"){e.preventDefault();duplicate();}else if((e.key==="Delete"||e.key==="Backspace")&&selectedIds.length){e.preventDefault();removeIds(selectedIds);}};const up=(e:KeyboardEvent)=>{if(e.code==="Space")setSpace(false);};window.addEventListener("keydown",down);window.addEventListener("keyup",up);return()=>{window.removeEventListener("keydown",down);window.removeEventListener("keyup",up);};},[selectedIds,redo,elements,space]);

  const fit=()=>{const sc=scrollRef.current;if(!sc)return;const z=Math.min((sc.clientWidth-30)/WIDTH,(sc.clientHeight-30)/HEIGHT,1.5);setZoom(Math.max(.5,z));setTimeout(()=>{sc.scrollLeft=0;sc.scrollTop=0;},0);};
  const switchRoom=(v:string)=>{const n=cleanRoom(v);setRoomInput(n);history.pushState({},"",`${location.pathname}?room=${encodeURIComponent(n)}`);if(n!==room){setBoard([]);pendingRef.current=[];setSelectedIds([]);setRedo([]);setRoom(n);}};
  const share=async()=>{const url=`${location.origin}${location.pathname}?room=${encodeURIComponent(room)}`;try{await navigator.clipboard.writeText(url);alert("Room link copied");}catch{prompt("Copy room link",url);}};
  const download=()=>{const c=canvasRef.current;if(!c)return;const a=document.createElement("a");a.download=`canvasly-${room}.png`;a.href=c.toDataURL();a.click();};
  const clear=()=>{if(!elements.length||!confirm(`Clear '${room}' for everyone?`))return;setBoard([]);setSelectedIds([]);setRedo([]);queue({type:"clear",room});};
  const tools:{id:Tool;label:string}[]=[{id:"select",label:"↖ Select"},{id:"pen",label:"✏️ Pen"},{id:"eraser",label:"🧽 Eraser"},{id:"line",label:"╱ Line"},{id:"arrow",label:"➜ Arrow"},{id:"rectangle",label:"▢ Rect"},{id:"circle",label:"◯ Circle"},{id:"text",label:"T Text"},{id:"sticky",label:"📝 Note"}];

  const stageStyle:CSSProperties={width:WIDTH*zoom,height:HEIGHT*zoom,position:"relative"};
  const canvasStyle:CSSProperties={width:WIDTH,height:HEIGHT,transform:`scale(${zoom})`,transformOrigin:"top left",cursor:space?"grab":"auto"};
  return <div className="app">
    <header className="topbar"><div className="brand"><div className="logo">C</div><div><h1>Canvasly</h1><span>Real-time collaborative canvas</span></div></div><div className="connection"><span className={`status-dot ${status}`}/>{status==="connected"?"Connected":status==="connecting"?"Connecting…":"Reconnecting…"}</div><div className="top-actions"><input value={name} onChange={e=>setName(e.target.value.slice(0,30))} placeholder="Your name"/><input className="room-input" value={roomInput} onChange={e=>setRoomInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&switchRoom(roomInput)} placeholder="Room name"/><button className="secondary" onClick={()=>switchRoom(roomInput)}>Join Room</button><button className="secondary" onClick={share}>🔗 Share</button><button className="presence-button" onClick={()=>setShowPresence(x=>!x)}>👥 {users}</button></div>{showPresence&&<div className="presence-panel"><div className="presence-title">People in this room</div>{presence.length?presence.map(p=><div className="presence-row" key={p.id}><span className="presence-avatar" style={{background:p.color}}>{p.name[0]?.toUpperCase()}</span><span className="presence-name">{p.name}{p.id===myIdRef.current?" (you)":""}</span>{p.drawing&&<span className="drawing-badge">drawing</span>}</div>):<div className="presence-empty">Waiting for collaborators…</div>}</div>}</header>
    <div className="toolbar"><div className="tool-group">{tools.map(t=><button key={t.id} className={`tool ${tool===t.id?"active":""}`} onClick={()=>setTool(t.id)}>{t.label}</button>)}</div><div className="divider"/><label className="control">Color <input className="color-picker" type="color" value={color} onChange={e=>setColor(e.target.value)}/></label><label className="size-control"><span><span>Size</span><span>{size}px</span></span><input type="range" min="1" max="24" value={size} onChange={e=>setSize(+e.target.value)}/></label><label style={{display:"flex",alignItems:"center",gap:5,fontSize:12}}><input type="checkbox" checked={fill} onChange={e=>setFill(e.target.checked)} disabled={!(tool==="rectangle"||tool==="circle")}/> Fill</label><div className="divider"/><button className="action" onClick={undoAction}>↶ Undo</button><button className="action" onClick={redoAction} disabled={!redo.length}>↷ Redo</button><button className="action" onClick={copy} disabled={!selectedIds.length}>Copy</button><button className="action" onClick={paste} disabled={!clipboardRef.current.length}>Paste</button><button className="action" onClick={duplicate} disabled={!selectedIds.length}>Duplicate</button><button className="action" onClick={()=>removeIds(selectedIds)} disabled={!selectedIds.length}>Delete</button><button className="action danger" onClick={clear} disabled={!elements.length}>Clear</button><button className="action download" onClick={download}>Download</button><div className="divider"/><div className="zoom"><button onClick={()=>setZoom(x=>Math.max(.5,x-.1))}>−</button><button onClick={fit}>Fit</button><button onClick={()=>setZoom(x=>Math.min(1.5,x+.1))}>+</button><button onClick={()=>setZoom(1)}>{Math.round(zoom*100)}%</button></div></div>
    <main className="workspace"><section className="canvas-wrapper"><div className="canvas-header"><span>Room: <strong>{room}</strong></span><span>{elements.length} objects · {selectedIds.length?`${selectedIds.length} selected · `:""}{Math.round(zoom*100)}% zoom · Space+drag to pan</span></div><div className="canvas-scroll" ref={scrollRef}><div className="canvas-stage" style={stageStyle}><canvas ref={canvasRef} className="canvas" width={WIDTH} height={HEIGHT} style={canvasStyle} onPointerDown={startPointer} onPointerMove={movePointer} onPointerUp={stopPointer} onPointerCancel={stopPointer} onPointerLeave={e=>sendCursor(point(e))}/><div className="cursor-layer">{Object.entries(cursors).map(([id,c])=><div key={id} className="remote-cursor" style={{left:c.x*zoom,top:c.y*zoom,"--cursor-color":c.color} as CSSProperties}><div className="cursor-arrow">↖</div><span className="cursor-name">{c.name}</span></div>)}</div></div></div></section></main>
    <footer><span>Canvasly • Room <strong>{room}</strong></span><span>{status==="connected"?"Changes sync automatically and persist in the database.":"Offline changes are saved locally and will sync when reconnected."}</span></footer>
  </div>;
}
export default App;
