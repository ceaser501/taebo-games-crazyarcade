// Connections to a room. Online: a WebSocket to the room's Durable Object on Cloudflare
// (/api/room/<code>). Practice: the same RoomCore running in this page, with computer players.
// Both look the same to the scenes: on(msg => …), send(msg), close().
import { RoomCore } from './shared/room.js';
import { HZ } from './shared/const.js';

const API = (window.CA_SERVER || '').replace(/\/$/, '');
const wsBase = () => {
  if (API) return API.replace(/^http/, 'ws');
  return location.origin.replace(/^http/, 'ws');
};

export async function listRooms() {
  const r = await fetch(`${API}/api/rooms`, { cache: 'no-store' });
  if (!r.ok) throw new Error('rooms');
  return (await r.json()).rooms || [];
}

export const randomCode = () => String(Math.floor(1000 + Math.random() * 9000));

// Identifies this tab to the room server, so a dropped connection gets its seat back.
function playerId() {
  try {
    let id = sessionStorage.getItem('ca-pid');
    if (!id) { id = 'p' + Math.random().toString(36).slice(2, 12); sessionStorage.setItem('ca-pid', id); }
    return id;
  } catch { return 'p' + Math.random().toString(36).slice(2, 12); }
}

export class Online {
  constructor(code, name, token = null) {
    this.code = code; this.name = name; this.token = token; this.handlers = []; this.rtt = 120; this.closed = false; this.tries = 0;
    this.open();
  }
  open() {
    const ws = new WebSocket(`${wsBase()}/api/room/${this.code}?name=${encodeURIComponent(this.name)}&pid=${playerId()}${this.token ? `&token=${this.token}` : ''}`);
    this.ws = ws;
    ws.onopen = () => { this.tries = 0; this.emit({ t: 'open' }); };
    ws.onmessage = (e) => {
      let msg; try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.t === 'pong') { const r = performance.now() - msg.c; this.rtt = this.rtt * 0.7 + r * 0.3; return; }
      this.emit(msg);
    };
    ws.onclose = () => {
      if (this.closed) return;
      // Phones drop sockets when switching apps; try to get back in a few times.
      if (this.tries++ < 4) setTimeout(() => !this.closed && this.open(), 800 * this.tries);
      else this.emit({ t: 'lost' });
    };
    clearInterval(this.pinger);
    this.pinger = setInterval(() => this.send({ t: 'ping', c: performance.now() }), 2000);
  }
  on(f) { this.handlers.push(f); }
  emit(m) { for (const f of this.handlers) f(m); }
  send(msg) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg)); }
  close() { this.closed = true; clearInterval(this.pinger); try { this.ws.close(); } catch { /* already closed */ } }
}

export class Practice {
  // opts: { mode: 'team'|'solo', bots: number of computer players, map, exp: my experience (shows my rank) }.
  constructor(name, opts = {}) {
    this.handlers = []; this.rtt = 0; this.me = 'me';
    this.room = new RoomCore({
      code: '연습', title: '혼자놀기',
      send: (id, m) => { if (id === this.me) this.deliver(m); },
      broadcast: (m) => this.deliver(m),
    });
    this.timer = setInterval(() => this.room.tick(), 1000 / HZ);
    queueMicrotask(() => {
      this.emit({ t: 'open' });
      this.room.join(this.me, name, opts.exp != null ? { key: null, exp: opts.exp } : null);
      this.room.message(this.me, { t: 'settings', mode: opts.mode || 'team', map: opts.map });
      for (let i = 0; i < (opts.bots ?? 1); i++) this.room.message(this.me, { t: 'bot' });
      // Start once the page has answered the welcome with our character and decorations.
      setTimeout(() => this.room.message(this.me, { t: 'start' }), 120);
    });
  }
  deliver(m) { const copy = JSON.parse(JSON.stringify(m)); queueMicrotask(() => this.emit(copy)); }
  on(f) { this.handlers.push(f); }
  emit(m) { for (const f of this.handlers) f(m); }
  send(msg) { if (msg.t !== 'ping') this.room.message(this.me, msg); }
  close() { clearInterval(this.timer); }
}
