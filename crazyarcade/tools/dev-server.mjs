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
import { AccountsCore } from '../js/shared/accounts.js';
import { gainFor } from '../js/shared/level.js';

// Accounts as on Cloudflare, kept in a file so they survive restarts.
const ACCT_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.cache', 'dev-accounts.json');
const acctData = new Map(fs.existsSync(ACCT_FILE) ? Object.entries(JSON.parse(fs.readFileSync(ACCT_FILE, 'utf8'))) : []);
const accounts = new AccountsCore({
  get: async (k) => acctData.get(k),
  put: async (k, v) => { acctData.set(k, v); fs.mkdirSync(path.dirname(ACCT_FILE), { recursive: true }); fs.writeFileSync(ACCT_FILE, JSON.stringify(Object.fromEntries(acctData))); },
});

// DEV_LAG=ms delays messages both ways (half each way); DEV_JITTER=ms adds a random extra
// delay to what the server sends, keeping the order, like a phone on mobile data.
const LAG = Number(process.env.DEV_LAG) || 0, JITTER = Number(process.env.DEV_JITTER) || 0;
function deliver(ws, s) {
  if (!LAG && !JITTER) { if (ws.readyState === 1) ws.send(s); return; }
  const at = Math.max(ws.nextAt || 0, Date.now() + LAG / 2 + Math.random() * JITTER);
  ws.nextAt = at;
  setTimeout(() => ws.readyState === 1 && ws.send(s), at - Date.now());
}

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
    send: (id, m) => { const ws = r.sockets.get(id); if (ws) deliver(ws, JSON.stringify(m)); },
    broadcast: (m) => { const s = JSON.stringify(m); for (const ws of r.sockets.values()) deliver(ws, s); },
    onResult: async (list) => {
      for (const x of list) {
        const a = await accounts.award(x.acct, gainFor(x.result, x.kills), x);
        if (!a) continue;
        r.core.setExp(x.id, a.exp);
        const ws = r.sockets.get(x.id); if (ws) deliver(ws, JSON.stringify({ t: 'exp', ...a }));
      }
    },
  });
  r.loop = setInterval(() => { if (r.core.phase === 'game') r.core.tick(); }, 1000 / HZ);
  rooms.set(code, r);
  return r;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const am = url.pathname.match(/^\/api\/account\/(enter|me|practice|buy|wear|char|import|missions|claim|spin|title)$/);
  if (am && req.method === 'POST') {
    let body = '';
    for await (const c of req) body += c;
    let b = {}; try { b = JSON.parse(body); } catch { /* empty */ }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(await accounts.handle(am[1], b))); return;
  }
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
  wss.handleUpgrade(req, socket, head, async (ws) => {
    const r = room(m[1]);
    const pid = url.searchParams.get('pid') || `p${Math.random().toString(36).slice(2, 10)}`;
    let name = url.searchParams.get('name') || '플레이어', acct = null;
    const a = await accounts.user(url.searchParams.get('token'));
    if (a && a.u) { acct = { key: a.key, exp: a.u.exp, title: await accounts.titleOf(a.key, a.u) }; name = a.u.name; } else name = await accounts.guestName(name);
    const old = r.sockets.get(pid); if (old) old.close();
    r.sockets.set(pid, ws);
    if (r.gone.has(pid)) { clearTimeout(r.gone.get(pid)); r.gone.delete(pid); }
    // A small artificial delay (DEV_LAG=ms) to feel what phones on mobile data feel.
    const lag = Number(process.env.DEV_LAG) || 0;
    const later = (f) => (lag ? setTimeout(f, lag / 2) : f());
    if (!r.core.resync(pid)) {
      const res = r.core.join(pid, name, acct);
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
