// The game itself: a deterministic tick-based simulation of one round. The room server runs
// it authoritatively; the browser runs the same code to predict its own player and for
// practice games against the computer. No DOM, no timers, no Math.random (seeded RNG).
import {
  COLS, ROWS, TILE, HZ, ROUND_SECONDS, HURRY_SECONDS, FUSE, FLAME, TRAP, START_DELAY, END_DELAY,
  speedPx, TRAPPED_PX, charById, ITEMS, ITEM_CHANCE, SHIELD_TIME,
} from './const.js';

export const DIRS = [[0, 0], [0, -1], [0, 1], [-1, 0], [1, 0]]; // none, up, down, left, right
export const DIR_NAMES = ['Down', 'Up', 'Down', 'Left', 'Right'];
const HALF = TILE / 2;
const CORNER = 9; // this far into the next row/column and you slide around a corner
const BREAK = 9; // ticks a block takes to crumble
const CONTACT = 28; // players this close touch (rescue or pop a bubble)
const INVULN = Math.round(1 * HZ); // after losing a ride or being freed

export function rng(state) {
  // mulberry32
  let t = (state.seed = (state.seed + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function rollItem(g, weights) {
  if (rng(g) * 1000 >= ITEM_CHANCE) return null;
  const total = weights.reduce((n, [, w]) => n + w, 0);
  let x = rng(g) * total;
  for (const [k, w] of weights) { x -= w; if (x < 0) return k; }
  return null;
}

// map: { tiles: [[sprite, kind, w, h]], floor: [ROWS*COLS] tile index, objs: [ROWS*COLS] tile index or -1,
// spawns: [[c, r]...] }. players: [{ id, name, char, team, color, bot }].
export function createGame({ map, players, seed = 1, mode = 'team' }) {
  const g = {
    tick: 0, phase: 'start', phaseT: START_DELAY, timer: ROUND_SECONDS * HZ, seed: seed | 0, mode,
    mapId: map.id, floor: map.floor.slice(), objs: [], items: new Array(ROWS * COLS).fill(null),
    bombs: [], flames: new Array(ROWS * COLS).fill(null), players: [], events: [], nextId: 1,
    result: null, hurry: false,
  };
  g.tiles = map.tiles.map((t) => (Array.isArray(t) ? { s: t[0], k: t[1], w: t[2] || 1, h: t[3] || 1 } : t));
  for (let i = 0; i < ROWS * COLS; i++) {
    const t = map.objs[i];
    g.objs.push(t >= 0 ? { t, k: g.tiles[t].k, item: null, breakT: 0 } : null);
  }
  // Hidden items: every breakable block gets a roll.
  const weights = Object.entries(ITEMS).map(([k, it]) => [k, map.drops?.[k] ?? it.weight]).filter(([, w]) => w > 0);
  for (const o of g.objs) if (o && o.k === 'soft') o.item = rollItem(g, weights);
  const spawns = map.spawns.slice();
  // Shuffle spawn points so seats do not always start in the same corner.
  for (let i = spawns.length - 1; i > 0; i--) { const j = Math.floor(rng(g) * (i + 1)); [spawns[i], spawns[j]] = [spawns[j], spawns[i]]; }
  players.forEach((pl, i) => {
    const ch = charById(pl.char);
    const [c, r] = spawns[i % spawns.length];
    g.players.push({
      id: pl.id, name: pl.name, char: ch.id, team: pl.team, color: pl.color ?? pl.team, bot: !!pl.bot,
      x: c * TILE + HALF, y: r * TILE + HALF, dir: 2, moving: false,
      bombs: ch.bombs[0], power: ch.power[0], speed: ch.speed[0], max: { bombs: ch.bombs[1], power: ch.power[1], speed: ch.speed[1] },
      state: 'normal', stateT: 0, needle: 0, shield: 0, shieldT: 0, ride: null, invT: 0, kills: 0, anim: 0,
    });
  });
  return g;
}

const idx = (c, r) => r * COLS + c;
const inside = (c, r) => c >= 0 && r >= 0 && c < COLS && r < ROWS;
export const cellOf = (v) => Math.floor(v / TILE);

function bombAt(g, c, r) { return g.bombs.find((b) => b.c === c && b.r === r); }

function blocked(g, c, r, p) {
  if (!inside(c, r)) return true;
  const o = g.objs[idx(c, r)];
  if (o && o.k !== 'bush' && !o.breakT) return true;
  const b = bombAt(g, c, r);
  return !!(b && !(p && b.pass.includes(p.id)));
}

function overlapsCell(p, c, r) {
  return Math.abs(p.x - (c * TILE + HALF)) < TILE - 4 && Math.abs(p.y - (r * TILE + HALF)) < TILE - 4;
}

// Moves along one axis with corner sliding. ax: 0 for x, 1 for y; s: -1 or +1.
function move(g, p, ax, s, dist) {
  const pos = ax ? 'y' : 'x', side = ax ? 'x' : 'y';
  const free = (along, across) => (ax ? !blocked(g, across, along, p) : !blocked(g, along, across, p));
  const here = cellOf(p[pos]);
  let lane = Math.round((p[side] - HALF) / TILE);
  let off = p[side] - (lane * TILE + HALF);
  if (Math.abs(off) > 0.01) {
    const other = lane + Math.sign(off);
    if (free(here + s, lane)) {
      // Pull onto the lane first, then go on.
      const st = Math.min(dist, Math.abs(off));
      p[side] -= Math.sign(off) * st; dist -= st;
    } else if (free(here + s, other) && Math.abs(off) > CORNER) {
      // Mostly in the next lane already: slide into it around the corner.
      const t = other * TILE + HALF, st = Math.min(dist, Math.abs(t - p[side]));
      p[side] += Math.sign(t - p[side]) * st;
      return;
    }
  }
  if (dist <= 0) return;
  lane = Math.round((p[side] - HALF) / TILE);
  off = p[side] - (lane * TILE + HALF);
  const center = here * TILE + HALF;
  let next = p[pos] + s * dist;
  if ((next - center) * s > 0) {
    let ok = free(here + s, lane);
    if (ok && Math.abs(off) > 0.01) ok = free(here + s, lane + Math.sign(off));
    if (!ok) next = (p[pos] - center) * s > 0 ? p[pos] : center;
  }
  const lim = (ax ? ROWS : COLS) * TILE - HALF;
  p[pos] = Math.max(HALF, Math.min(lim, next));
}

// One tick of walking in direction d (0-4). The browser also calls this to predict its own
// player between server updates.
export function walk(g, p, d) {
  if (d) {
    p.dir = d;
    const px = p.state === 'trapped' ? TRAPPED_PX : speedPx(p.ride === 'turtle' ? 1 : p.ride === 'owl' ? Math.max(p.speed, 6) : p.speed);
    const [dx, dy] = DIRS[d];
    if (dx) move(g, p, 0, dx, px / HZ); else move(g, p, 1, dy, px / HZ);
    p.moving = true;
  } else p.moving = false;
}

function emit(g, type, data = {}) { g.events.push({ type, ...data }); }

function placeBomb(g, p) {
  const c = cellOf(p.x), r = cellOf(p.y);
  if (g.bombs.filter((b) => b.owner === p.id).length >= p.bombs) return;
  if (bombAt(g, c, r)) return;
  const o = g.objs[idx(c, r)];
  if (o && o.k !== 'bush') return;
  const pass = g.players.filter((q) => q.state !== 'dead' && overlapsCell(q, c, r)).map((q) => q.id);
  g.bombs.push({ id: g.nextId++, c, r, owner: p.id, power: p.power, t: FUSE, pass });
  emit(g, 'place', { c, r });
}

// d: for an arm cell its place counted from the arm's tip (1 = tip), for the centre the
// longest arm; it picks the animation (the stream dries up from the tips inwards).
function setFlame(g, c, r, kind, end, d) {
  g.flames[idx(c, r)] = { t: FLAME, kind, end, born: g.tick, d };
}

function explode(g, b) {
  g.bombs.splice(g.bombs.indexOf(b), 1);
  emit(g, 'boom', { c: b.c, r: b.r });
  const kinds = { '0,-1': 'u', '0,1': 'd', '-1,0': 'l', '1,0': 'r' };
  let longest = 0;
  for (const [dc, dr] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
    const arm = [];
    for (let i = 1; i <= b.power; i++) {
      const c = b.c + dc * i, r = b.r + dr * i;
      if (!inside(c, r)) break;
      const o = g.objs[idx(c, r)];
      if (o && o.k === 'hard') break;
      if (o && o.k === 'soft') { if (!o.breakT) { o.breakT = 1; emit(g, 'break', { c, r }); } break; }
      if (o && o.k === 'bush') g.objs[idx(c, r)] = null;
      const other = bombAt(g, c, r);
      if (other) { other.t = Math.min(other.t, 1); arm.push([c, r]); break; }
      if (g.items[idx(c, r)] && !(g.items[idx(c, r)].fresh > g.tick)) g.items[idx(c, r)] = null;
      arm.push([c, r]);
    }
    arm.forEach(([c, r], k) => setFlame(g, c, r, kinds[`${dc},${dr}`], k === arm.length - 1, arm.length - k));
    longest = Math.max(longest, arm.length);
  }
  setFlame(g, b.c, b.r, 'c', false, Math.max(1, longest));
}

function applyItem(g, p, k) {
  switch (k) {
    case 'bomb': p.bombs = Math.min(p.max.bombs, p.bombs + 1); break;
    case 'potion': p.power = Math.min(p.max.power, p.power + 1); break;
    case 'maxpower': p.power = p.max.power; break;
    case 'skate': p.speed = Math.min(p.max.speed, p.speed + 1); break;
    case 'devil': p.speed = p.max.speed; break;
    case 'needle': p.needle++; break;
    case 'shield': p.shield++; break;
    case 'turtle': case 'owl': if (!p.ride) p.ride = k; break;
  }
  emit(g, 'pick', { id: p.id, item: k });
}

function trap(g, p) {
  if (p.state !== 'normal' || p.shieldT > 0 || p.invT > 0) return;
  if (p.ride) { p.ride = null; p.invT = INVULN; emit(g, 'unride', { id: p.id }); return; }
  p.state = 'trapped'; p.stateT = TRAP;
  emit(g, 'trap', { id: p.id });
}

function die(g, p, by) {
  p.state = 'dead'; p.stateT = 0;
  if (by && by.team !== p.team) by.kills++;
  emit(g, 'pop', { id: p.id, by: by ? by.id : null });
}

function free(g, p, by) {
  p.state = 'normal'; p.invT = Math.round(HZ / 2);
  emit(g, 'free', { id: p.id, by: by ? by.id : null });
}

// One tick. inputs: { [playerId]: { dir: 0-4, bomb: bool, item: 'needle' | 'shield' | null } }.
export function step(g, inputs = {}) {
  g.tick++;
  g.events = [];
  if (g.phase === 'start') {
    if (--g.phaseT <= 0) { g.phase = 'play'; emit(g, 'go'); }
  } else if (g.phase === 'play') {
    g.timer--;
    if (!g.hurry && g.timer <= HURRY_SECONDS * HZ) { g.hurry = true; emit(g, 'hurry'); }
    if (g.timer <= 0) finish(g, null);
  } else if (g.phase === 'end') {
    g.phaseT--;
  }
  const playing = g.phase === 'play';

  for (const p of g.players) {
    p.anim++;
    if (p.invT > 0) p.invT--;
    if (p.shieldT > 0) p.shieldT--;
    if (p.state === 'dead') continue;
    const inp = inputs[p.id] || {};
    if (!playing) { p.moving = false; continue; }
    if (inp.item === 'needle' && p.state === 'trapped' && p.needle > 0) { p.needle--; free(g, p, null); emit(g, 'needle', { id: p.id }); }
    if (inp.item === 'shield' && p.state === 'normal' && p.shield > 0 && p.shieldT <= 0) { p.shield--; p.shieldT = SHIELD_TIME; emit(g, 'shield', { id: p.id }); }
    walk(g, p, inp.dir | 0);
    if (inp.bomb && p.state === 'normal') placeBomb(g, p);
    if (p.state === 'normal') {
      const i = idx(cellOf(p.x), cellOf(p.y));
      if (g.items[i] && !(g.items[i].fresh > g.tick)) { applyItem(g, p, g.items[i].k); g.items[i] = null; }
    }
  }

  // Players leave the bombs they were standing on.
  for (const b of g.bombs) b.pass = b.pass.filter((id) => { const q = g.players.find((x) => x.id === id); return q && overlapsCell(q, b.c, b.r); });

  if (playing || g.phase === 'end') {
    for (const b of g.bombs.slice()) if (--b.t <= 0 && g.bombs.includes(b)) explode(g, b);
    // A bomb set off by a stream this tick goes off now too.
    let again = true;
    while (again) { again = false; for (const b of g.bombs.slice()) if (b.t <= 0) { explode(g, b); again = true; } }
  }

  for (let i = 0; i < g.flames.length; i++) {
    const f = g.flames[i];
    if (!f) continue;
    if (--f.t <= 0) { g.flames[i] = null; continue; }
    const c = i % COLS, r = (i / COLS) | 0;
    for (const p of g.players) if (p.state === 'normal' && cellOf(p.x) === c && cellOf(p.y) === r) trap(g, p);
  }

  for (let i = 0; i < g.objs.length; i++) {
    const o = g.objs[i];
    if (o && o.breakT && ++o.breakT > BREAK) {
      g.objs[i] = null;
      if (o.item) g.items[i] = { k: o.item, fresh: g.tick + 2 };
    }
  }

  if (playing) {
    for (const p of g.players) {
      if (p.state !== 'trapped') continue;
      if (--p.stateT <= 0) { die(g, p, null); continue; }
      for (const q of g.players) {
        if (q === p || q.state !== 'normal') continue;
        if (Math.hypot(q.x - p.x, q.y - p.y) > CONTACT) continue;
        if (g.mode === 'team' && q.team === p.team) free(g, p, q); else die(g, p, q);
        break;
      }
    }
    const alive = new Set(g.players.filter((p) => p.state !== 'dead').map((p) => p.team));
    if (alive.size <= 1 && g.players.length > 1) finish(g, alive.size ? [...alive][0] : null);
    else if (g.players.length === 1 && alive.size === 0) finish(g, null);
  }
  return g;
}

function finish(g, team) {
  if (g.phase === 'end') return;
  g.phase = 'end'; g.phaseT = END_DELAY;
  g.result = { team, draw: team === null };
  emit(g, 'end', { team });
}

export const isOver = (g) => g.phase === 'end' && g.phaseT <= 0;

// Compact state for the wire.
export function snapshot(g) {
  return {
    k: g.tick, ph: g.phase, pt: g.phaseT, tm: g.timer, hu: g.hurry, rs: g.result,
    p: g.players.map((p) => [p.id, Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10, p.dir, p.moving ? 1 : 0, p.state, p.stateT,
      p.bombs, p.power, p.speed, p.needle, p.shield, p.shieldT, p.ride, p.invT, p.kills]),
    b: g.bombs.map((b) => [b.id, b.c, b.r, b.t, b.owner, b.pass]),
    ev: g.events,
  };
}

// The map-changing part, sent when it changes (blocks, items, flames).
export function mapState(g) {
  return {
    o: g.objs.map((o) => (o ? [o.t, o.breakT] : 0)),
    i: g.items.map((it) => (it ? it.k : 0)),
    f: g.flames.map((f) => (f ? [f.kind, f.end ? 1 : 0, f.t] : 0)),
  };
}
