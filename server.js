import http from "http";
import { WebSocketServer } from "ws";
import crypto from "crypto";

const port = process.env.PORT || 3001;
const supabaseUrl = (process.env.SUPABASE_URL || "").replace(/\/$/, "").replace(/\/rest\/v1$/, "");
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const USER_COLORS = ["#2563eb", "#16a34a", "#9333ea", "#ea580c", "#0891b2", "#db2777", "#65a30d", "#7c3aed"];
const MAX_MESSAGE_BYTES = 120000;
const RATE_WINDOW_MS = 10000;
const RATE_LIMIT = 80;

const apiHeaders = () => ({ apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, "Content-Type": "application/json" });
const safeRoom = (v) => String(v || "main").trim().replace(/\s+/g, "-").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || "main";
const safeName = (v) => String(v || "Guest").trim().slice(0, 30) || "Guest";

async function loadBoard(room) {
  if (!supabaseUrl || !supabaseKey) { console.error("Missing Supabase environment variables"); return []; }
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/boards?room_id=eq.${encodeURIComponent(room)}&select=elements`, { headers: apiHeaders() });
    if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
    const rows = await response.json();
    return Array.isArray(rows[0]?.elements) ? rows[0].elements : [];
  } catch (error) { console.error("Supabase load failed:", error); return []; }
}

async function saveBoard(room, elements) {
  if (!supabaseUrl || !supabaseKey) return false;
  const payload = JSON.stringify({ room_id: room, elements, updated_at: new Date().toISOString() });
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(`${supabaseUrl}/rest/v1/boards`, { method: "POST", headers: { ...apiHeaders(), Prefer: "resolution=merge-duplicates,return=minimal" }, body: payload });
      if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
      return true;
    } catch (error) { console.error(`Supabase save failed (attempt ${attempt}/3):`, error); if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 500)); }
  }
  return false;
}

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain", "Cache-Control": "no-store" });
  res.end("Canvasly server is running");
});
const wss = new WebSocketServer({ server, maxPayload: MAX_MESSAGE_BYTES });
const users = new Map(), boards = new Map(), saveTimers = new Map(), saveQueues = new Map(), roomQueues = new Map(), roomRevisions = new Map();

function send(socket, message) { if (socket.readyState === 1) socket.send(JSON.stringify(message)); }
function broadcast(room, message) { for (const [socket, info] of users) if (info.room === room && socket.readyState === 1) send(socket, message); }
function roomPresence(room) { return [...users.values()].filter(x => x.room === room).map(x => ({ id:x.id, name:x.name, color:x.color, drawing:Boolean(x.drawing) })); }
function announcePresence(room) { const list = roomPresence(room); broadcast(room, { type:"presence", users:list }); broadcast(room, { type:"users", count:list.length }); }
async function getBoard(room) { if (!boards.has(room)) boards.set(room, await loadBoard(room)); return boards.get(room); }
function queueSave(room, elements) { const previous=saveQueues.get(room)||Promise.resolve(); const next=previous.catch(()=>{}).then(()=>saveBoard(room,elements)).catch(e=>console.error("Persistence queue failed:",e)); saveQueues.set(room,next); return next; }
function scheduleSave(room) { if(saveTimers.has(room)) clearTimeout(saveTimers.get(room)); const t=setTimeout(()=>{saveTimers.delete(room);queueSave(room,[...(boards.get(room)||[])]);},500);saveTimers.set(room,t); }
function nextRevision(room) { const r=(roomRevisions.get(room)||0)+1;roomRevisions.set(room,r);return r; }
function enqueue(room,operation) { const previous=roomQueues.get(room)||Promise.resolve();const next=previous.catch(()=>{}).then(operation).catch(e=>console.error("Room operation failed:",e));roomQueues.set(room,next);return next; }

wss.on("connection", socket => {
  const id=crypto.randomUUID(), color=USER_COLORS[users.size%USER_COLORS.length];
  users.set(socket,{id,room:null,name:"Guest",color,drawing:false,windowStart:Date.now(),messages:0});
  send(socket,{type:"welcome",id,color});
  socket.on("message",async raw=>{
    const info=users.get(socket); if(!info)return;
    if(Buffer.byteLength(raw)>MAX_MESSAGE_BYTES){socket.close(1009,"Message too large");return;}
    const now=Date.now(); if(now-info.windowStart>RATE_WINDOW_MS){info.windowStart=now;info.messages=0;} if(++info.messages>RATE_LIMIT){send(socket,{type:"error",message:"Rate limit exceeded. Please slow down."});return;}
    try{
      const data=JSON.parse(raw.toString());
      if(!data||typeof data.type!=="string")return;
      if(data.type==="join"){
        const room=safeRoom(data.room),old=info.room;
        if(old&&old!==room){info.drawing=false;broadcast(old,{type:"user_left",id});announcePresence(old);}
        info.room=room;info.name=safeName(data.name);const elements=await getBoard(room);send(socket,{type:"sync",elements,revision:roomRevisions.get(room)||0});announcePresence(room);return;
      }
      if(!info.room)return;const room=info.room,opId=typeof data.opId==="string"&&data.opId.slice(0,100);
      if(data.type==="activity"){info.drawing=Boolean(data.drawing);announcePresence(room);return;}
      if(data.type==="draw"&&data.element?.id){
        const el=data.element;if(typeof el.id!=="string"||el.id.length>100||!Array.isArray(el.points)||el.points.length>20000)return;
        enqueue(room,async()=>{const board=await getBoard(room),index=board.findIndex(x=>x.id===el.id);if(index===-1)board.push(el);else board[index]=el;boards.set(room,board);const revision=nextRevision(room);broadcast(room,{type:"draw",element:el,revision,...(opId?{opId}: {})});scheduleSave(room);});return;
      }
      if(data.type==="remove"&&typeof data.id==="string"){enqueue(room,async()=>{const board=await getBoard(room);boards.set(room,board.filter(x=>x.id!==data.id));const revision=nextRevision(room);broadcast(room,{type:"remove",id:data.id,revision,...(opId?{opId}: {})});scheduleSave(room);});return;}
      if(data.type==="clear"){enqueue(room,async()=>{boards.set(room,[]);const revision=nextRevision(room);broadcast(room,{type:"clear",revision,...(opId?{opId}: {})});scheduleSave(room);});return;}
      if(data.type==="cursor"){broadcast(room,{type:"cursor",id,x:Number(data.x)||0,y:Number(data.y)||0,name:info.name,color:info.color});}
    }catch(error){console.error("Invalid message:",error);}
  });
  socket.on("error",()=>{});
  socket.on("close",()=>{const info=users.get(socket);if(!info)return;users.delete(socket);if(info.room){broadcast(info.room,{type:"user_left",id:info.id});announcePresence(info.room);}});
});
server.listen(port,"0.0.0.0",()=>console.log(`Canvasly running on port ${port}`));
