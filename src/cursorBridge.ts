const NativeWebSocket = window.WebSocket;
let activeSocket: WebSocket | null = null;
let lastSent = 0;
const THROTTLE_MS = 45;

window.WebSocket = new Proxy(NativeWebSocket, {
  construct(target, args) {
    const socket = new target(...args) as WebSocket;
    activeSocket = socket;
    socket.addEventListener("close", () => {
      if (activeSocket === socket) activeSocket = null;
    });
    return socket;
  }
}) as typeof WebSocket;

(globalThis as typeof globalThis & {
  sendCursor?: (event: PointerEvent) => void;
}).sendCursor = (event: PointerEvent) => {
  const now = performance.now();
  if (now - lastSent < THROTTLE_MS) return;
  lastSent = now;

  const canvas = event.currentTarget as HTMLCanvasElement | null;
  if (!canvas || !activeSocket || activeSocket.readyState !== NativeWebSocket.OPEN) return;

  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  const nameInput = document.querySelector<HTMLInputElement>('input[aria-label="Your name"]');
  const name = nameInput?.value.trim() || "Guest";
  const x = ((event.clientX - rect.left) / rect.width) * canvas.width;
  const y = ((event.clientY - rect.top) / rect.height) * canvas.height;

  activeSocket.send(JSON.stringify({ type: "cursor", x, y, name }));
};
