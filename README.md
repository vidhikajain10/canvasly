# Canvasly

Canvasly is a real-time collaborative whiteboard built for teams, students, and individuals who want to visually develop ideas in a shared workspace.

Users can create and edit drawings, diagrams, text, and sticky notes on a shared canvas. Multiple users can work in the same room at the same time, with changes synchronized through WebSockets and board state persisted for later use.

## Overview

Canvasly combines an interactive browser canvas with real-time collaboration and persistent room-based workspaces. A user can create a room, share the room link, and collaborate with others without manually refreshing the page.

The application is designed as a practical demonstration of real-time web application development, collaborative state synchronization, browser-based graphics, persistence, and deployment.

## Features

### Collaborative Canvas

- Freehand drawing with pen and eraser tools
- Lines and arrows for diagrams and connections
- Rectangles and circles with optional fill
- Text placed directly on the canvas
- Sticky notes with customizable colors
- Object selection and movement
- Multi-selection using Shift
- Copy, paste, duplicate, and delete
- Undo and redo
- Zoom and fit-to-view controls
- Space + drag canvas panning
- Export the canvas as a PNG image

### Text and Sticky Note Editing

Canvasly provides direct editing for text-based objects. Select the Text or Sticky tool, click on the canvas, and start typing at that location.

Text and sticky notes support additional formatting options including:

- Multiple font families
- Font size control
- Bold and italic styles
- Text alignment
- Text color
- Sticky note background colors
- Multi-line text
- Enter to finish editing
- Shift + Enter for a new line
- Escape to cancel editing

### Real-Time Collaboration

- Shared rooms using unique room names
- WebSocket-based synchronization
- Live collaborator presence
- Remote collaborator cursors
- Drawing activity indicators
- Shared board updates without page refreshes
- Room links that can be copied and shared

### Persistence and Reliability

Board state is persisted so work can be restored after refreshing the page. The application also maintains local room state in the browser and reconnects to the WebSocket server when a connection is interrupted.

The server validates incoming collaboration messages and applies basic limits to protect the shared workspace from malformed or excessive requests.

### Authentication Interface

Canvasly includes a simple sign-in and account creation interface for the project demonstration. Account information is handled through the configured Supabase authentication flow.

### AI Workspace Assistant

The integrated AI workspace panel provides lightweight assistance for organizing a board. It can:

- Analyze the current board
- Suggest a workflow
- Recommend layout improvements

The assistant is designed to help users turn visual ideas into clearer plans and workflows.

## Quick Demo

A built-in **Demo** button is available in the top action bar. It opens a short guide explaining the main workflow:

1. **Create or join a room** — enter a room name and use the same room with teammates.
2. **Draw and add ideas** — use Pen, Shapes, Text, Sticky Notes, and Image tools.
3. **Collaborate live** — use Share to send the room link to other users.
4. **Save your work** — board data is persisted and Export creates a PNG snapshot.

The guide also highlights selection, multi-selection, and common keyboard shortcuts. Press `?` to open the guide quickly when you are not typing in a form field.

## Technology Stack

### Frontend

- React
- TypeScript
- Vite
- CSS
- HTML Canvas API

### Backend

- Node.js
- WebSocket using `ws`

### Database

- Supabase PostgreSQL

### Deployment

- Vercel for the frontend
- Render for the WebSocket backend

## Architecture

```text
Users
  |
  | Browser
  v
React + Canvas
  |
  | WebSocket
  v
Node.js WebSocket Server
  |
  | Persistence
  v
Supabase PostgreSQL
```

Each room has an independent board state. Clients connect to the WebSocket server, join a room, send canvas operations, and receive updates from other users in the same room. The server handles synchronization and persistence.

## Room Sharing

A Canvasly room is identified through the `room` URL parameter.

Example:

```text
https://your-canvasly-domain/?room=team-project
```

Users entering the same room name collaborate on the same board. The Share button copies or shares the current room link so it can be sent to other collaborators.

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| Ctrl/Cmd + Z | Undo |
| Ctrl/Cmd + Y | Redo |
| Ctrl/Cmd + C | Copy selected objects |
| Ctrl/Cmd + V | Paste objects |
| Delete / Backspace | Delete selected objects |
| Space + Drag | Pan the canvas |
| Enter | Finish text editing |
| Shift + Enter | Add a new line while editing |
| Escape | Cancel text editing |
| ? | Open the quick demo guide |

## Local Development

Install dependencies:

```bash
npm install
```

Start the frontend development server:

```bash
npm run dev
```

The WebSocket backend can be started with the Node server configuration included in the repository.

## Environment Variables

The frontend uses the configured Supabase URL and browser-safe publishable key. The backend uses:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

The Supabase service-role key must remain on the server and should never be exposed in frontend code.

## Deployment

### Frontend

The frontend is deployed through Vercel from the GitHub repository and `main` branch.

### Backend

The WebSocket server is deployed as a Node.js service on Render. The required Supabase environment variables are configured in the Render service settings.

## Project Structure

```text
canvasly/
├── public/
│   ├── feature-pack.js
│   └── password-toggle.js
├── src/
│   ├── App.tsx
│   ├── App.css
│   ├── sidebar.css
│   └── ui-fix.css
├── server.js
├── package.json
├── vite.config.ts
└── README.md
```

## Current Project Status

Canvasly is a working collaborative whiteboard prototype suitable for demonstration and R&D submission purposes.

The project currently demonstrates:

- Interactive browser canvas rendering
- Real-time multi-user collaboration
- WebSocket communication
- Room-based shared state
- Persistent board data
- Collaborative cursors and presence
- Text and sticky note editing
- Canvas export
- Authentication UX
- Server-side validation and reliability safeguards
- An integrated AI workspace assistant
- In-app quick demo instructions
- Vercel and Render deployment architecture

For production use, authentication, authorization, server-side security, and AI functionality should be reviewed and hardened further before handling sensitive production data.
