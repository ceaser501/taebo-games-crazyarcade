// Local stand-in for Cloudflare: serves dist/ and runs rooms over WebSockets with the same
// RoomCore the Durable Object uses. `npm run build && npm start`, then open
// http://localhost:8080/crazyarcade/ in two windows to play online against yourself.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { RoomCore } from '../js/shared/room.js';
import { HZ } from '../js/shared/const.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist');
const PORT = Number(process.env.PORT) || 8080;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.webmanifest': 'application/manifest+json' };

const rooms = new Map(); // code -> { core, sockets, loop }

function room(code) {
  if (rooms.has(code)) return rooms.get(code);
  const r = { sockets: new Map(), gone: new Map() };
  r.core = new RoomCore({
    code,
    send: (id, m) => { const ws = r.sockets.get(id); if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); },
    broadcast: (m) => { const s = JSON.stringify(m); for (const ws of r.sockets.values()) if (ws.readyState === 1) ws.send(s); },
  });
  r.loop = setInterval(() => { if (r.core.phase === 'game') r.core.tick(); }, 1000 / HZ);
  rooms.set(code, r);
  return r;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/rooms') {
    const list = [...rooms.values()].filter((r) => [...r.core.members.values()].some((m) => !m.bot)).map((r) => r.core.summary());
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ rooms: list })); return;
  }
  let p = path.join(root, decodeURIComponent(url.pathname));
  if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  fs.readFile(p, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://x');
  const m = url.pathname.match(/^\/api\/room\/(\d{4})$/);
  if (!m) { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => {
    const r = room(m[1]);
    const pid = url.searchParams.get('pid') || `p${Math.random().toString(36).slice(2, 10)}`;
    const name = url.searchParams.get('name') || '플레이어';
    const old = r.sockets.get(pid); if (old) old.close();
    r.sockets.set(pid, ws);
    if (r.gone.has(pid)) { clearTimeout(r.gone.get(pid)); r.gone.delete(pid); }
    // A small artificial delay (DEV_LAG=ms) to feel what phones on mobile data feel.
    const lag = Number(process.env.DEV_LAG) || 0;
    const later = (f) => (lag ? setTimeout(f, lag / 2) : f());
    if (!r.core.resync(pid)) {
      const res = r.core.join(pid, name);
      if (res.error) { ws.send(JSON.stringify({ t: 'error', text: res.error })); ws.close(); r.sockets.delete(pid); return; }
    }
    ws.on('message', (data) => later(() => {
      let msg; try { msg = JSON.parse(data); } catch { return; }
      if (msg.t === 'ping') { later(() => ws.readyState === 1 && ws.send(JSON.stringify({ t: 'pong', c: msg.c }))); return; }
      r.core.message(pid, msg);
    }));
    ws.on('close', () => {
      if (r.sockets.get(pid) !== ws) return;
      r.sockets.delete(pid);
      r.gone.set(pid, setTimeout(() => { r.gone.delete(pid); r.core.leave(pid); }, 20000));
    });
  });
});

server.listen(PORT, () => console.log(`http://localhost:${PORT}/crazyarcade/`));
