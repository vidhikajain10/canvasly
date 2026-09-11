# Canvasly 🎨

**Canvasly** is a real-time collaborative whiteboard where multiple people can draw, edit, and collaborate together in shared rooms.

## ✨ Features

- Real-time collaborative drawing with WebSockets
- Shareable, room-specific URLs
- Room isolation and persistent board state
- Room-specific online user count
- Live remote cursors with user names
- Select, move, resize, and delete objects
- Pen, eraser, line, arrow, rectangle, and circle tools
- Custom colors and brush sizes
- Undo / redo
- Clear the room for everyone
- Zoom controls
- Download the canvas as PNG
- Automatic WebSocket reconnection
- Supabase persistence across refreshes and reconnects
- Responsive desktop/mobile interface

## 🧱 Tech Stack

**Frontend:** React + TypeScript + Vite + CSS  
**Realtime:** Node.js + WebSocket (`ws`)  
**Database:** Supabase PostgreSQL  
**Frontend hosting:** Vercel  
**Backend hosting:** Render

## 🏗️ Architecture

```text
Browser A ──┐
Browser B ──┼── WebSocket ──> Node.js server ──> Supabase
Browser C ──┘                    │
                                 └── broadcasts room events
```

Each room has its own board state. When a user joins a room, the server loads that room's saved board and synchronizes it to the client. Drawing and object-editing changes are broadcast to other users and persisted to Supabase.

## 🔗 Room Sharing

Rooms use the URL format:

`https://your-canvasly-domain/?room=team-project`

Type a room name and choose **Join Room**, then use **Share** to copy a link for that room. Different room names maintain separate boards.

## 🎯 Object Editing

Select **↖ Select** to interact with existing objects:

- Click an object to select it
- Drag it to move it
- Drag a corner handle to resize it
- Press **Delete** or **Backspace** to remove it
- Use the **Delete** toolbar action as an alternative

Edits use the same WebSocket event stream as drawing, so other users receive the updated object state in real time.

## 🚀 Deployment

### Frontend — Vercel

Connect the GitHub repository to Vercel. Every push to `main` automatically creates a new frontend deployment.

### Backend — Render

Deploy `server.js` as a Node web service with WebSockets enabled.

Required environment variables:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Keep the Supabase secret key only on the backend. Never expose it in frontend code or commit it to GitHub.

## 🗄️ Supabase Table

```sql
create table if not exists public.boards (
  room_id text primary key,
  elements jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.boards enable row level security;
```

## 🧪 Final QA Checklist

- Open two browser tabs in the same room and draw in both directions
- Verify the online user count changes when a tab closes
- Switch to a different room and verify its board is isolated
- Refresh a room and verify its board persists
- Select, move, resize, and delete objects
- Verify edits appear for collaborators
- Test undo / redo and clear
- Test shareable room links
- Test zoom and PNG download
- Confirm reconnect behavior after a temporary connection loss

## 📌 Project Status

Canvasly is deployed as a working real-time collaborative whiteboard with room-based collaboration, persistent storage, object editing, and responsive UI.

## 👩‍💻 Project

Built as an R&D project exploring real-time collaboration, WebSockets, browser Canvas rendering, shared state synchronization, persistence, and frontend interaction design.
