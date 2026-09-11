# Canvasly 🎨

**Canvasly** is a real-time collaborative whiteboard where multiple people can draw together in shared rooms.

## ✨ Features

- Real-time collaborative drawing
- Shareable room links
- Room-specific online user count
- Live remote cursors with user names
- Pen, eraser, line, arrow, rectangle and circle tools
- Custom colors and brush sizes
- Undo / redo
- Clear room for everyone
- Zoom controls
- Download the canvas as PNG
- Automatic WebSocket reconnect
- Persistent boards with Supabase
- Responsive interface for desktop and mobile

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

Each room has its own board state. When a user joins a room, the server loads the saved board and synchronizes it to that client. Drawing changes are broadcast to other users and persisted to Supabase.

## 🔗 Room Sharing

Rooms use the URL format:

`https://your-canvasly-domain/?room=team-project`

Use **Join Room** to switch rooms, then **Share** to copy the current room link.

## 🚀 Deployment

### Frontend — Vercel

Connect the GitHub repository to Vercel. Every push to `main` automatically creates a new frontend deployment.

### Backend — Render

Deploy `server.js` as a Node web service with WebSockets enabled.

Required environment variables:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Keep the service-role key only on the backend. Never expose it in frontend code or commit it to GitHub.

## 🗄️ Supabase Table

```sql
create table if not exists public.boards (
  room_id text primary key,
  elements jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.boards enable row level security;
```

## 📌 Current Status

Canvasly is deployed as a working real-time collaborative canvas with persistent room-based boards.

### Next roadmap

- User authentication and profiles
- Better object selection and movement
- True geometric eraser / object deletion
- Board version history
- Comments / team chat
- Permissions for room owners
- Performance improvements for high-frequency pen strokes

## 👩‍💻 Project

Built as an R&D project exploring real-time collaboration, WebSockets, browser canvas rendering and persistent shared state.
