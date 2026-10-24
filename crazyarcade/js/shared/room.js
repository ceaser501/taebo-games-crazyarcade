// A game room: up to eight seats, the host's settings, and the round in progress. The same
// class runs inside the Cloudflare Durable Object (online) and in the browser (practice
// against the computer). It never touches sockets; it calls send(id, msg) and broadcast(msg)
// and is driven by join/leave/message and tick().
import { HZ, MAX_PLAYERS, CHARACTERS, TEAMS, COLS, ROWS } from './const.js';
import { createGame, step, snapshot, isOver } from './sim.js';
import { Bot } from './ai.js';
import { MAPS } from './maps.js';

export const DEFAULT_MAP = 'Village10';
const BOT_NAMES = ['컴퓨터1', '컴퓨터2', '컴퓨터3', '컴퓨터4', '컴퓨터5', '컴퓨터6', '컴퓨터7'];

export class RoomCore {
  constructor({ code, title, send, broadcast, onChange = () => {} }) {
    Object.assign(this, { code, send, broadcast, onChange });
    this.title = title || '즐거운 크레이지아케이드';
    this.mode = 'team'; // 'team' or 'solo'
    this.mapId = DEFAULT_MAP;
    this.slots = Array.from({ length: MAX_PLAYERS }, () => ({ open: true, id: null }));
    this.members = new Map(); // id -> { id, name, char, color, ready, bot, slot }
    this.host = null;
    this.phase = 'room';
    this.game = null; this.inputs = new Map(); this.bots = new Map(); this.lastObjs = null;
    this.chatLog = [];
  }

  get count() { return [...this.members.values()].length; }
  summary() {
    return { code: this.code, title: this.title, mode: this.mode, map: this.mapId, players: this.count,
      seats: this.slots.filter((s) => s.open).length, playing: this.phase === 'game' };
  }

  state() {
    return {
      code: this.code, title: this.title, mode: this.mode, map: this.mapId, host: this.host, phase: this.phase,
      slots: this.slots.map((s) => ({ open: s.open, id: s.id })),
      members: [...this.members.values()].map(({ id, name, char, color, ready, bot, slot }) => ({ id, name, char, color, ready, bot, slot })),
    };
  }

  changed() { this.broadcast({ t: 'room', room: this.state() }); this.onChange(); }

  freeSlot() { return this.slots.findIndex((s) => s.open && s.id === null); }

  join(id, name) {
    if (this.phase !== 'room') return { error: 'playing' };
    const slot = this.freeSlot();
    if (slot < 0) return { error: 'full' };
    // A colour nobody uses yet, so a fresh room starts as a free-for-all of distinct teams.
    const used = new Set([...this.members.values()].map((m) => m.color));
    const color = [0, 5, 3, 1, 2, 4, 6, 7].find((c) => !used.has(c)) ?? 0;
    const m = { id, name: String(name || '플레이어').slice(0, 10), char: CHARACTERS[slot % 4].id, color, ready: false, bot: false, slot };
    this.members.set(id, m);
    this.slots[slot].id = id;
    if (!this.host) this.host = id;
    this.send(id, { t: 'welcome', you: id, room: this.state() });
    this.chat(null, `${m.name}님이 들어왔습니다.`);
    this.changed();
    return { ok: true };
  }

  leave(id) {
    const m = this.members.get(id);
    if (!m) return;
    this.members.delete(id);
    this.slots[m.slot].id = null;
    if (this.game) {
      const p = this.game.players.find((x) => x.id === id);
      if (p && p.state !== 'dead') { p.state = 'dead'; this.game.events.push({ type: 'pop', id }); }
    }
    if (this.host === id) {
      const next = [...this.members.values()].find((x) => !x.bot);
      this.host = next ? next.id : null;
      if (!next) { for (const b of [...this.members.values()]) this.removeBot(b.id); }
    }
    this.chat(null, `${m.name}님이 나갔습니다.`);
    this.changed();
  }

  // A player whose connection came back: send them everything again.
  resync(id) {
    const m = this.members.get(id);
    if (!m) return false;
    this.send(id, { t: 'welcome', you: id, room: this.state() });
    for (const line of this.chatLog.slice(-10)) this.send(id, { t: 'chat', ...line });
    if (this.phase === 'game' && this.game) {
      const g = this.game;
      this.send(id, { t: 'start', seed: this.startInfo.seed, map: this.startInfo.map, mode: this.mode, players: this.startInfo.players });
      const snap = snapshot(g);
      snap.m = g.objs.map((o, i) => [i, o ? o.t : -1, o ? o.breakT : 0, g.items[i] ? g.items[i].k : 0, g.flames[i] ? [g.flames[i].kind, g.flames[i].end ? 1 : 0, g.flames[i].born, g.flames[i].d] : 0]);
      this.send(id, { t: 's', ...snap, a: 0 });
    }
    return true;
  }

  removeBot(id) {
    const m = this.members.get(id);
    if (!m) return;
    this.members.delete(id); this.slots[m.slot].id = null; this.bots.delete(id);
  }

  chat(from, text) {
    const m = from ? this.members.get(from) : null;
    const line = { name: m ? m.name : null, text: String(text).slice(0, 80) };
    this.chatLog.push(line); if (this.chatLog.length > 30) this.chatLog.shift();
    this.broadcast({ t: 'chat', ...line });
  }

  message(id, msg) {
    const m = this.members.get(id);
    if (!m || !msg || typeof msg !== 'object') return;
    const host = id === this.host;
    switch (msg.t) {
      case 'set':
        if (this.phase !== 'room') return;
        if (msg.char && CHARACTERS.some((c) => c.id === msg.char)) m.char = msg.char;
        if (Number.isInteger(msg.color) && msg.color >= 0 && msg.color < TEAMS.length) m.color = msg.color;
        if (!host) m.ready = false;
        this.changed(); break;
      case 'ready':
        if (this.phase !== 'room' || host) return;
        m.ready = !!msg.on; this.changed(); break;
      case 'settings':
        if (!host || this.phase !== 'room') return;
        if (msg.mode === 'team' || msg.mode === 'solo') this.mode = msg.mode;
        if (msg.map && MAPS.some((x) => x.id === msg.map)) this.mapId = msg.map;
        if (typeof msg.title === 'string' && msg.title.trim()) this.title = msg.title.trim().slice(0, 24);
        for (const x of this.members.values()) if (!x.bot) x.ready = false;
        this.changed(); break;
      case 'slot': {
        if (!host || this.phase !== 'room') return;
        const s = this.slots[msg.i];
        if (!s) return;
        if (s.id !== null) {
          const who = this.members.get(s.id);
          if (who && who.bot) { this.removeBot(who.id); this.changed(); }
          return;
        }
        s.open = !s.open; this.changed(); break;
      }
      case 'bot': {
        if (!host || this.phase !== 'room') return;
        const slot = Number.isInteger(msg.i) && this.slots[msg.i] && this.slots[msg.i].open && this.slots[msg.i].id === null ? msg.i : this.freeSlot();
        if (slot < 0) return;
        const bid = `bot${slot}-${Date.now() % 100000}`;
        const used = new Set([...this.members.values()].map((x) => x.color));
        const color = Number.isInteger(msg.color) ? msg.color : ([5, 0, 3, 1, 2, 4, 6, 7].find((c) => !used.has(c)) ?? 5);
        const ch = CHARACTERS[Math.floor(Math.random() * 12)].id;
        this.members.set(bid, { id: bid, name: BOT_NAMES[slot % BOT_NAMES.length], char: ch, color, ready: true, bot: true, slot });
        this.slots[slot].id = bid; this.slots[slot].open = true;
        this.changed(); break;
      }
      case 'kick': {
        if (!host || this.phase !== 'room' || msg.id === id) return;
        const who = this.members.get(msg.id);
        if (!who) return;
        if (who.bot) { this.removeBot(who.id); this.changed(); } else this.send(msg.id, { t: 'kicked' });
        break;
      }
      case 'start': {
        if (!host || this.phase !== 'room') return;
        const why = this.cannotStart();
        if (why) { this.send(id, { t: 'notice', text: why }); return; }
        this.startGame(); break;
      }
      case 'in':
        if (this.phase === 'game') {
          const cur = this.inputs.get(id) || { dir: 0, bomb: 0, item: null, ct: 0 };
          cur.dir = msg.d | 0;
          if (msg.b) cur.bomb = 1;
          if (msg.i === 'needle' || msg.i === 'shield') cur.item = msg.i;
          cur.ct = msg.ct | 0;
          this.inputs.set(id, cur);
        }
        break;
      case 'chat':
        if (typeof msg.text === 'string' && msg.text.trim()) this.chat(id, msg.text.trim());
        break;
      case 'back':
        if (host && this.phase === 'game' && this.game && this.game.phase === 'end') this.endGame();
        break;
    }
  }

  players() { return [...this.members.values()].sort((a, b) => a.slot - b.slot); }

  cannotStart() {
    const ps = this.players();
    if (ps.length < 2) return '두 명 이상이어야 시작할 수 있습니다.';
    if (ps.some((p) => !p.ready && p.id !== this.host)) return '모두 준비해야 시작할 수 있습니다.';
    const map = MAPS.find((x) => x.id === this.mapId) || MAPS[0];
    if (ps.length > map.spawns.length) return `${map.name}은(는) ${map.spawns.length}명까지 할 수 있는 맵입니다.`;
    if (this.mode === 'team') {
      const teams = new Set(ps.map((p) => p.color));
      if (teams.size < 2) return '팀전은 두 팀 이상이어야 합니다. 팀 색을 바꿔 주세요.';
    }
    return null;
  }

  startGame() {
    const map = MAPS.find((x) => x.id === this.mapId) || MAPS[0];
    const seed = (Math.random() * 2 ** 31) | 0;
    const list = this.players().map((m) => ({ id: m.id, name: m.name, char: m.char, color: m.color,
      team: this.mode === 'team' ? m.color : m.slot, bot: m.bot }));
    this.game = createGame({ map, players: list, seed, mode: this.mode });
    this.phase = 'game';
    this.inputs.clear(); this.bots.clear();
    for (const m of this.members.values()) if (m.bot) this.bots.set(m.id, new Bot(m.id));
    this.lastObjs = null;
    this.startInfo = { seed, map: map.id, players: list };
    this.broadcast({ t: 'start', seed, map: map.id, mode: this.mode, players: list });
    this.changed();
  }

  endGame() {
    this.phase = 'room'; this.game = null;
    for (const m of this.members.values()) if (!m.bot) m.ready = false;
    this.broadcast({ t: 'back' });
    this.changed();
  }

  // Advances the round one tick and tells everyone. Call HZ times a second.
  tick() {
    const g = this.game;
    if (!g) return;
    const inputs = {};
    for (const [id, inp] of this.inputs) { inputs[id] = { dir: inp.dir, bomb: !!inp.bomb, item: inp.item }; inp.bomb = 0; inp.item = null; }
    for (const [id, bot] of this.bots) inputs[id] = bot.think(g);
    step(g, inputs);
    const snap = snapshot(g);
    // Map changes: only the cells that differ from what was last sent.
    const cells = [];
    const cur = g.objs.map((o, i) => `${o ? o.t + ':' + o.breakT : '-'}|${g.items[i] ? g.items[i].k : ''}|${g.flames[i] ? g.flames[i].kind + (g.flames[i].end ? 1 : 0) + ':' + g.flames[i].born : ''}`);
    if (!this.lastObjs) this.lastObjs = new Array(cur.length).fill('');
    for (let i = 0; i < cur.length; i++) if (cur[i] !== this.lastObjs[i]) {
      const o = g.objs[i], it = g.items[i], f = g.flames[i];
      cells.push([i, o ? o.t : -1, o ? o.breakT : 0, it ? it.k : 0, f ? [f.kind, f.end ? 1 : 0, f.born, f.d] : 0]);
    }
    this.lastObjs = cur;
    if (cells.length) snap.m = cells;
    for (const m of this.members.values()) {
      if (m.bot) continue;
      const inp = this.inputs.get(m.id);
      this.send(m.id, { t: 's', ...snap, a: inp ? inp.ct : 0 });
    }
    if (isOver(g)) this.endGame();
  }
}

export const mapById = (id) => MAPS.find((m) => m.id === id) || MAPS[0];
export { COLS, ROWS };
