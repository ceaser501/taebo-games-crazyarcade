// A game room: up to eight seats, the host's settings, and the round in progress. The same
// class runs inside the Cloudflare Durable Object (online) and in the browser (practice
// against the computer). It never touches sockets; it calls send(id, msg) and broadcast(msg)
// and is driven by join/leave/message and tick().
import { HZ, MAX_PLAYERS, CHARACTERS, TEAMS, COLS, ROWS } from './const.js';
import { createGame, step, snapshot, isOver, scoreOf } from './sim.js';
import { levelOf } from './level.js';
import { Bot } from './ai.js';
import { MAPS } from './maps.js';

export const DEFAULT_MAP = 'Village10';
// The host may leave the map to chance: any map that fits everyone is picked as the round starts.
export const RANDOM_MAP = 'random';
// Team play is red against blue (colours 0 and 5), up to four a side; in solo play everyone
// has a colour of their own.
export const RED = 0, BLUE = 5;
const SOLO_COLORS = [0, 5, 3, 1, 2, 4, 6, 7];
const BOT_NAMES = ['컴퓨터1', '컴퓨터2', '컴퓨터3', '컴퓨터4', '컴퓨터5', '컴퓨터6', '컴퓨터7'];

// Decorations a player wears (shop ids): hat A0015, balloon Bomb001, pet Pet001.
function cleanLook(l) {
  const ok = (v, re) => (typeof v === 'string' && re.test(v) ? v : null);
  return { hat: ok(l.hat, /^[A-Z]\d{1,5}$/), bomb: ok(l.bomb, /^Bomb\d{1,4}$/), pet: ok(l.pet, /^Pet\d{1,4}$/) };
}

export class RoomCore {
  // onResult(list) runs once when a round is decided, with [{ id, acct, result, kills, coins }] for
  // the players signed in to an account (the server gives them experience for it).
  constructor({ code, title, send, broadcast, onChange = () => {}, onResult = () => {} }) {
    Object.assign(this, { code, send, broadcast, onChange, onResult });
    this.title = title || '즐거운 크레이지아케이드';
    this.mode = 'team'; // 'team' or 'solo'
    this.rule = 'normal'; // 'normal', or 'duel' (무한 결투: popped players come back, points decide)
    this.size = 1; // team play: seats shown per team (at least as many as the players need)
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
      code: this.code, title: this.title, mode: this.mode, rule: this.rule, size: this.size, map: this.mapId, host: this.host, phase: this.phase,
      slots: this.slots.map((s) => ({ open: s.open, id: s.id })),
      members: [...this.members.values()].map(({ id, name, char, color, ready, bot, slot, look, exp }) => ({ id, name, char, color, ready, bot, slot, look, lv: exp == null ? null : levelOf(exp) })),
    };
  }

  changed() { this.broadcast({ t: 'room', room: this.state() }); this.onChange(); }

  // The colour for someone arriving: the smaller team, or a colour nobody has.
  newColor() {
    const ms = [...this.members.values()];
    if (this.mode === 'team') return ms.filter((m) => m.color === RED).length <= ms.filter((m) => m.color === BLUE).length ? RED : BLUE;
    const used = new Set(ms.map((m) => m.color));
    return SOLO_COLORS.find((c) => !used.has(c)) ?? 0;
  }
  teamSize(color) { return [...this.members.values()].filter((m) => m.color === color).length; }

  freeSlot() { return this.slots.findIndex((s) => s.open && s.id === null); }

  // acct: { key, exp } for a player signed in to an account (their rank shows; games count).
  join(id, name, acct = null) {
    if (this.phase !== 'room') return { error: 'playing' };
    const slot = this.freeSlot();
    if (slot < 0) return { error: 'full' };
    // A colour nobody uses yet, so a fresh room starts as a free-for-all of distinct teams.
    const color = this.newColor();
    const m = { id, name: String(name || '플레이어').slice(0, 10), char: CHARACTERS[slot % 4].id, color, ready: false, bot: false, slot,
      acct: acct ? acct.key : null, exp: acct ? acct.exp : null };
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
      this.send(id, { t: 'start', seed: this.startInfo.seed, map: this.startInfo.map, mode: this.mode, rule: this.startInfo.rule, players: this.startInfo.players });
      const snap = snapshot(g);
      snap.m = g.objs.map((o, i) => [i, o ? o.t : -1, o ? o.breakT : 0, g.items[i] ? g.items[i].k : 0, g.flames[i] ? [g.flames[i].kind, g.flames[i].end ? 1 : 0, g.flames[i].born, g.flames[i].d] : 0, o && o.sl ? [o.sl.d, o.sl.at] : 0]);
      this.send(id, { t: 's', ...snap, a: 0 });
    }
    return true;
  }

  removeBot(id) {
    const m = this.members.get(id);
    if (!m) return;
    this.members.delete(id); this.slots[m.slot].id = null; this.bots.delete(id);
  }

  // A chat line (from: a member's id, or null for the room's own notices); id lets the
  // game put it over that player's head. A member sends at most 5 lines in 5 seconds.
  chat(from, text) {
    const m = from ? this.members.get(from) : null;
    if (m) {
      const now = Date.now();
      m.said = (m.said || []).filter((t) => now - t < 5000);
      if (m.said.length >= 5) { this.send(from, { t: 'notice', text: '채팅을 조금 천천히 보내 주세요.' }); return; }
      m.said.push(now);
    }
    const line = { id: m ? m.id : null, name: m ? m.name : null, text: String(text).replace(/[\u0000-\u001f]/g, ' ').slice(0, 80) };
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
        if (Number.isInteger(msg.color) && msg.color >= 0 && msg.color < TEAMS.length && msg.color !== m.color) {
          if (this.mode === 'team') { if ((msg.color === RED || msg.color === BLUE) && this.teamSize(msg.color) < 4) m.color = msg.color; }
          else if (![...this.members.values()].some((x) => x.color === msg.color)) m.color = msg.color;
        }
        if (msg.look && typeof msg.look === 'object') m.look = cleanLook(msg.look);
        if (!host) m.ready = false;
        this.changed(); break;
      case 'ready':
        if (this.phase !== 'room' || host) return;
        m.ready = !!msg.on; this.changed(); break;
      case 'settings':
        if (!host || this.phase !== 'room') return;
        if ((msg.mode === 'team' || msg.mode === 'solo') && msg.mode !== this.mode) {
          // Re-seat everyone in the order they came: alternate red/blue, or a colour each.
          this.mode = msg.mode;
          this.players().forEach((x, i) => { x.color = this.mode === 'team' ? (i % 2 ? BLUE : RED) : SOLO_COLORS[i % SOLO_COLORS.length]; });
        }
        if (msg.rule === 'normal' || msg.rule === 'duel') this.rule = msg.rule;
        if (msg.map && (msg.map === RANDOM_MAP || MAPS.some((x) => x.id === msg.map))) this.mapId = msg.map;
        if (Number.isInteger(msg.size) && msg.size >= 1 && msg.size <= 4) this.size = msg.size;
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
        if (this.mode === 'team' && (msg.color === RED || msg.color === BLUE) && this.teamSize(msg.color) >= 4) return;
        const color = this.mode === 'team' && (msg.color === RED || msg.color === BLUE) ? msg.color : this.newColor();
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
          // Where the player was when the balloon was pressed: a later message in the same tick
          // (they arrive in bunches) must not carry the balloon on to the next cell.
          if (msg.b) { cur.bomb = 1; if (Number.isFinite(msg.x) && Number.isFinite(msg.y)) { cur.bx = msg.x; cur.by = msg.y; } }
          if (msg.i === 'needle' || msg.i === 'shield' || msg.i === 'dart') cur.item = msg.i;
          cur.ct = msg.ct | 0;
          // The phone's own position for its player (see takePosition in sim.js).
          if (Number.isFinite(msg.x) && Number.isFinite(msg.y)) { cur.x = msg.x; cur.y = msg.y; } else cur.x = cur.y = undefined;
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
    if (ps.length < 2) return '친구가 들어오거나 컴퓨터를 넣으면 시작할 수 있어요.';
    if (this.mapId === RANDOM_MAP) return MAPS.some((m) => m.spawns.length >= ps.length) ? null : '이 인원이 할 수 있는 맵이 없어요.';
    const map = MAPS.find((x) => x.id === this.mapId) || MAPS[0];
    if (ps.length > map.spawns.length) return `${map.name}은(는) ${map.spawns.length}명까지 하는 맵이에요. 맵을 바꿔 주세요.`;
    if (this.mode === 'team' && this.teamSize(RED) !== this.teamSize(BLUE)) return '팀 인원을 맞춰 주세요. (1:1, 2:2, 3:3, 4:4)';
    return null;
  }

  startGame() {
    const fits = MAPS.filter((m) => m.spawns.length >= this.count);
    const map = this.mapId === RANDOM_MAP ? fits[Math.floor(Math.random() * fits.length)] || MAPS[0] : MAPS.find((x) => x.id === this.mapId) || MAPS[0];
    const seed = (Math.random() * 2 ** 31) | 0;
    const list = this.players().map((m) => ({ id: m.id, name: m.name, char: m.char, color: m.color,
      team: this.mode === 'team' ? m.color : m.slot, bot: m.bot, look: m.look || null, lv: m.exp == null ? null : levelOf(m.exp) }));
    this.game = createGame({ map, players: list, seed, mode: this.mode, rule: this.rule });
    this.phase = 'game'; this.decided = false;
    this.inputs.clear(); this.bots.clear();
    for (const m of this.members.values()) if (m.bot) this.bots.set(m.id, new Bot(m.id));
    this.lastObjs = null;
    this.startInfo = { seed, map: map.id, players: list, rule: this.rule };
    this.broadcast({ t: 'start', seed, map: map.id, mode: this.mode, rule: this.rule, players: list });
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
    for (const [id, inp] of this.inputs) {
      inputs[id] = { dir: inp.dir, bomb: !!inp.bomb, item: inp.item, x: inp.x, y: inp.y, bx: inp.bx, by: inp.by };
      inp.bomb = 0; inp.item = null; inp.x = inp.y = inp.bx = inp.by = undefined;
    }
    for (const [id, bot] of this.bots) inputs[id] = bot.think(g);
    step(g, inputs);
    const snap = snapshot(g);
    // Map changes: only the cells that differ from what was last sent.
    const cells = [];
    const cur = g.objs.map((o, i) => `${o ? o.t + ':' + o.breakT + (o.sl ? ':' + o.sl.at : '') : '-'}|${g.items[i] ? g.items[i].k : ''}|${g.flames[i] ? g.flames[i].kind + (g.flames[i].end ? 1 : 0) + ':' + g.flames[i].born : ''}`);
    if (!this.lastObjs) this.lastObjs = new Array(cur.length).fill('');
    for (let i = 0; i < cur.length; i++) if (cur[i] !== this.lastObjs[i]) {
      const o = g.objs[i], it = g.items[i], f = g.flames[i];
      cells.push([i, o ? o.t : -1, o ? o.breakT : 0, it ? it.k : 0, f ? [f.kind, f.end ? 1 : 0, f.born, f.d] : 0, o && o.sl ? [o.sl.d, o.sl.at] : 0]);
    }
    this.lastObjs = cur;
    if (cells.length) snap.m = cells;
    for (const m of this.members.values()) {
      if (m.bot) continue;
      const inp = this.inputs.get(m.id);
      this.send(m.id, { t: 's', ...snap, a: inp ? inp.ct : 0 });
    }
    if (g.result && !this.decided) {
      this.decided = true;
      const list = [];
      // MVP: the most kills in the round (in 무한 결투 the most points), when someone has any.
      const duel = g.rule === 'duel', score = (p) => (duel ? scoreOf(p) : p.kills);
      const top = Math.max(...g.players.map(score)), anyKill = g.players.some((p) => p.kills > 0);
      for (const p of g.players) {
        const m = this.members.get(p.id);
        if (!m || m.bot || !m.acct) continue;
        list.push({ id: p.id, acct: m.acct, kills: p.kills, coins: p.lucci, rescues: p.rescues || 0, duel, mvp: anyKill && score(p) === top,
          result: g.result.draw ? 'draw' : p.team === g.result.team ? 'win' : 'lose' });
      }
      if (list.length) this.onResult(list);
    }
    if (isOver(g)) this.endGame();
  }

  // A player's experience after the server gave it (their rank shows to everyone).
  setExp(id, exp) { const m = this.members.get(id); if (m) { m.exp = exp; if (this.phase === 'room') this.changed(); } }
}

export const mapById = (id) => MAPS.find((m) => m.id === id) || MAPS[0];
export { COLS, ROWS };
