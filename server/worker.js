// Room server on Cloudflare: one Durable Object per room runs the round (RoomCore, the same
// code the browser uses for practice) 30 times a second and talks to the players over
// WebSockets; one Lobby object keeps the list of open rooms; one Accounts object keeps the
// players' names, PINs and experience. The site (Cloudflare Pages) reaches these through
// functions/api/[[path]].js.
import { RoomCore } from '../crazyarcade/js/shared/room.js';
import { HZ } from '../crazyarcade/js/shared/const.js';
import { AccountsCore } from '../crazyarcade/js/shared/accounts.js';
import { gainFor } from '../crazyarcade/js/shared/level.js';

const GRACE = 20000; // a dropped player keeps the seat this long
const accounts = (env) => env.ACCOUNTS.get(env.ACCOUNTS.idFromName('accounts'));
const ask = async (env, action, body) => (await accounts(env).fetch(`https://accounts/${action}`, { method: 'POST', body: JSON.stringify(body) })).json();
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*' } });

export class Room {
  constructor(state, env) {
    this.state = state; this.env = env;
    this.sockets = new Map(); // player id -> WebSocket
    this.gone = new Map(); // player id -> timeout until the seat is given up
    this.core = null; this.loop = null; this.lastReport = 0;
  }

  async fetch(req) {
    const url = new URL(req.url);
    const code = decodeURIComponent(url.pathname.split('/').pop());
    if (req.headers.get('Upgrade') !== 'websocket') return json({ error: 'websocket only' }, 426);
    if (!this.core) {
      this.core = new RoomCore({
        code,
        send: (id, m) => this.sendTo(id, m),
        broadcast: (m) => { const s = JSON.stringify(m); for (const ws of this.sockets.values()) try { ws.send(s); } catch { /* closed */ } },
        onChange: () => this.report(),
        onResult: (list) => this.state.waitUntil(this.award(list)),
      });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    const pid = (url.searchParams.get('pid') || '').replace(/[^\w-]/g, '').slice(0, 40) || `p${Math.random().toString(36).slice(2, 10)}`;
    let name = (url.searchParams.get('name') || '플레이어').slice(0, 10);
    // Signed in: the account's name and rank; otherwise a guest under the name given.
    let acct = null;
    const token = url.searchParams.get('token');
    try {
      const a = token ? await ask(this.env, 'resolve', { token }) : {};
      if (a.key) { acct = { key: a.key, exp: a.exp, title: a.title }; name = a.name; } else name = (await ask(this.env, 'guest', { name })).name || name;
    } catch { /* play as a guest */ }
    const old = this.sockets.get(pid);
    if (old) try { old.close(1000, 'replaced'); } catch { /* gone */ }
    this.sockets.set(pid, server);
    if (this.gone.has(pid)) { clearTimeout(this.gone.get(pid)); this.gone.delete(pid); }
    if (!this.core.resync(pid)) {
      const r = this.core.join(pid, name, acct);
      if (r.error) {
        server.send(JSON.stringify({ t: 'error', text: r.error }));
        this.sockets.delete(pid);
        server.close(1000, r.error);
        return new Response(null, { status: 101, webSocket: client });
      }
    }
    server.addEventListener('message', (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'ping') { try { server.send(JSON.stringify({ t: 'pong', c: m.c })); } catch { /* closed */ } return; }
      this.core.message(pid, m);
    });
    const bye = () => {
      if (this.sockets.get(pid) !== server) return;
      this.sockets.delete(pid);
      this.gone.set(pid, setTimeout(() => { this.gone.delete(pid); this.core.leave(pid); this.maybeStop(); }, GRACE));
    };
    server.addEventListener('close', bye);
    server.addEventListener('error', bye);
    if (!this.loop) this.loop = setInterval(() => this.tick(), 1000 / HZ);
    this.report();
    return new Response(null, { status: 101, webSocket: client });
  }

  // Experience for a decided round, to each signed-in player.
  async award(list) {
    for (const r of list) {
      try {
        const a = await ask(this.env, 'award', { key: r.acct, gained: gainFor(r.result, r.kills), game: r });
        if (!a || a.exp == null) continue;
        this.core.setExp(r.id, a.exp);
        this.sendTo(r.id, { t: 'exp', ...a });
      } catch { /* the next game counts */ }
    }
  }

  sendTo(id, m) { const ws = this.sockets.get(id); if (ws) try { ws.send(JSON.stringify(m)); } catch { /* closed */ } }

  tick() {
    if (this.core.phase === 'game') this.core.tick();
    if (Date.now() - this.lastReport > 20000) this.report();
  }

  maybeStop() {
    if (this.core.members.size && [...this.core.members.values()].some((m) => !m.bot)) return;
    clearInterval(this.loop); this.loop = null;
    this.report(true);
  }

  report(closed = false) {
    this.lastReport = Date.now();
    const lobby = this.env.LOBBY.get(this.env.LOBBY.idFromName('lobby'));
    const humans = [...this.core.members.values()].filter((m) => !m.bot).length;
    const body = closed || !humans ? { code: this.core.code, closed: true } : this.core.summary();
    this.state.waitUntil(lobby.fetch('https://lobby/update', { method: 'POST', body: JSON.stringify(body) }).catch(() => {}));
  }
}

export class Lobby {
  constructor(state) { this.state = state; this.rooms = new Map(); }
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/update') {
      const r = await req.json();
      if (r.closed) this.rooms.delete(r.code); else this.rooms.set(r.code, { ...r, at: Date.now() });
      return json({ ok: true });
    }
    const now = Date.now();
    for (const [k, r] of this.rooms) if (now - r.at > 60000) this.rooms.delete(k);
    return json({ rooms: [...this.rooms.values()].sort((a, b) => a.playing - b.playing || b.at - a.at) });
  }
}

export class Accounts {
  constructor(state) {
    this.core = new AccountsCore({ get: (k) => state.storage.get(k), put: (k, v) => state.storage.put(k, v) });
  }
  async fetch(req) {
    const action = new URL(req.url).pathname.slice(1);
    let body = {};
    try { body = await req.json(); } catch { /* empty */ }
    // From the room objects only (the page cannot reach these paths).
    if (action === 'resolve') { const a = await this.core.user(body.token); return json(a && a.u ? { key: a.key, name: a.u.name, exp: a.u.exp, title: await this.core.titleOf(a.key, a.u) } : {}); }
    if (action === 'award') return json((await this.core.award(body.key, body.gained, body.game)) || {});
    if (action === 'guest') return json({ name: await this.core.guestName(body.name) });
    return json(await this.core.handle(action, body));
  }
}

// Requests that come straight to the Worker (the Pages function does the same routing).
export default {
  async fetch(req, env) { return route(req, env); },
};

export async function route(req, env) {
  const url = new URL(req.url);
  if (url.pathname === '/api/rooms') {
    const r = await env.LOBBY.get(env.LOBBY.idFromName('lobby')).fetch('https://lobby/list');
    return new Response(r.body, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*' } });
  }
  const m = url.pathname.match(/^\/api\/room\/(\d{4})$/);
  if (m) return env.ROOMS.get(env.ROOMS.idFromName(m[1])).fetch(req);
  const a = url.pathname.match(/^\/api\/account\/(enter|me|practice|buy|wear|char|import|missions|claim|spin|title)$/);
  if (a && req.method === 'POST') return accounts(env).fetch(`https://accounts/${a[1]}`, { method: 'POST', body: await req.text() });
  return json({ error: 'not found' }, 404);
}
