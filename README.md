# Canvasly 🎨

**Canvasly** is a real-time collaborative whiteboard where multiple people can draw, edit, organize ideas, and collaborate together in shared rooms.

## ✨ Features

### Phase 8 — Advanced Canvas
- Text tool with clean editor modal
- Sticky notes
- Filled and outline rectangles/circles
- Multi-select with Shift
- Copy / paste / duplicate
- Delete, undo / redo
- Space + drag panning
- Zoom and fit-to-view
- PNG export

### Phase 9 — Authentication UX
- Sign in / Create account screens
- Account name derived from email
- Sign out
- Submission-friendly auth flow with a clear production-auth upgrade path

### Phase 10 — Reliability & Security
- Room/name input sanitization
- WebSocket maximum message size
- Per-connection rate limiting
- Object and point-count validation
- Safe server-side persistence queue
- Supabase secret remains server-side
- Automatic WebSocket reconnect
- Persistent room state

### Phase 11 — AI Workspace Assistant
- Board analysis
- Suggested workflow generation
- Layout improvement suggestions
- AI panel integrated into the canvas UI

### Phase 12 — Portfolio / Submission Polish
- Clean responsive interface
- Collaboration status
- Room sharing
- Live collaborator presence and cursors
- Keyboard shortcut help
- Clear feature hierarchy and export flow

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

Each room has its own board state. The server synchronizes room state, broadcasts edits, and persists boards to Supabase.

## 🔗 Room Sharing

Rooms use a URL such as:

`https://your-canvasly-domain/?room=team-project`

Join a room, then use **Share** to copy its link. Different room names maintain separate boards.

## 🚀 Deployment

### Frontend — Vercel

The GitHub repository is connected to Vercel so pushes to `main` can trigger frontend deployments automatically.

### Backend — Render

`server.js` runs as a Node WebSocket service. Required environment variables:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Keep the Supabase service-role key only on the backend.

## 🧪 Submission QA

- Sign in / create account
- Join a room and share the room link
- Draw with multiple tools
- Add text and sticky notes
- Select, move, resize, copy/paste and delete objects
- Test undo/redo
- Test zoom, pan and export
- Open two tabs and verify realtime collaboration
- Refresh and verify persistence
- Open the AI panel and run board analysis/workflow/layout suggestions

## 📌 Project Status

**Canvasly — Phases 1–12 implemented for the final R&D submission.**

The project demonstrates real-time collaboration, WebSockets, shared state synchronization, browser Canvas rendering, persistence, authentication UX, server safeguards, AI-assisted workflow ideas, and deployment architecture.
