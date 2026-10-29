// The game itself: a deterministic tick-based simulation of one round. The room server runs
// it authoritatively; the browser runs the same code to predict its own player and for
// practice games against the computer. No DOM, no timers, no Math.random (seeded RNG).
import {
  COLS, ROWS, TILE, HZ, ROUND_SECONDS, HURRY_SECONDS, FUSE, FLAME, TRAP, START_DELAY, END_DELAY,
  speedPx, TRAPPED_PX, charById, ITEMS, ITEM_CHANCE, SHIELD_TIME, RIDES, CURSE_TIME, CURSES, KICK_PX, CONVEYOR_PX,
  PUNCH_TICKS,
} from './const.js';

export const DIRS = [[0, 0], [0, -1], [0, 1], [-1, 0], [1, 0]]; // none, up, down, left, right
export const DIR_NAMES = ['Down', 'Up', 'Down', 'Left', 'Right'];
const HALF = TILE / 2;
const CORNER = 9; // this far into the next row/column and you slide around a corner
const BREAK = 9; // ticks a block takes to crumble
const CONTACT = 28; // an opponent this close pops a bubble
// A teammate frees one from a little further: the bubble is drawn about 60 px wide, and online
// each phone shows the others slightly late, so a touch seen on screen must not fall short.
const RESCUE = 38;
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
  g.tiles = map.tiles.map((t) => (Array.isArray(t) ? { s: t[0], k: t[1], w: t[2] || 1, h: t[3] || 1, push: t[5] === 1 } : t));
  for (let i = 0; i < ROWS * COLS; i++) {
    const t = map.objs[i];
    g.objs.push(t >= 0 ? { t, k: g.tiles[t].k, item: null, breakT: 0, push: !!g.tiles[t].push } : null);
  }
  // A big static object (a truck, a cabin) also fills the cells its picture covers, to the right
  // and upwards; those parts block like it and are not drawn (part: the cell drawing it).
  for (let i = 0; i < ROWS * COLS; i++) {
    const o = g.objs[i];
    if (!o || o.part != null || o.k !== 'hard') continue;
    const { w, h } = g.tiles[o.t];
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) {
      const c = (i % COLS) + dx, r = Math.floor(i / COLS) - dy;
      if ((dx || dy) && c < COLS && r >= 0 && !g.objs[r * COLS + c] && !map.spawns.some(([sc, sr]) => sc === c && sr === r)) g.objs[r * COLS + c] = { t: o.t, k: 'hard', item: null, breakT: 0, push: false, part: i };
    }
  }
  // Hidden items: every breakable block gets a roll.
  // A map with a drop list gets exactly its items (plus the three basic ones if it leaves them out).
  const listed = map.drops && Object.keys(map.drops).length;
  const weights = Object.entries(ITEMS)
    .map(([k, it]) => [k, listed ? map.drops[k] ?? (['bomb', 'potion', 'skate'].includes(k) ? it.weight : 0) : it.weight])
    .filter(([, w]) => w > 0);
  for (const o of g.objs) if (o && o.k === 'soft') o.item = rollItem(g, weights);
  for (const [k, c, r, chance] of map.places || []) {
    if (!ITEMS[k] || rng(g) * 100 >= chance) continue;
    const o = g.objs[r * COLS + c];
    if (o && o.k === 'soft') o.item = k;
    else if (!o) g.items[r * COLS + c] = { k, fresh: 0 };
  }
  g.conv = map.conv || null;
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
      dart: 0, kick: false, punch: false, curse: null, curseT: 0, lucci: 0, got: [],
    });
  });
  return g;
}

const idx = (c, r) => r * COLS + c;
const inside = (c, r) => c >= 0 && r >= 0 && c < COLS && r < ROWS;
export const cellOf = (v) => Math.floor(v / TILE);

function bombAt(g, c, r) { return g.bombs.find((b) => b.c === c && b.r === r && !b.fly); }

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
    if (p.curse === 'reverse') d = [0, 2, 1, 4, 3][d];
    p.dir = d;
    const level = p.ride ? RIDES[p.ride].speed : p.curse === 'slow' ? 1 : p.curse === 'fast' ? 10 : p.speed;
    const px = p.state === 'trapped' ? TRAPPED_PX : speedPx(level);
    const [dx, dy] = DIRS[d];
    if (dx) move(g, p, 0, dx, px / HZ); else move(g, p, 1, dy, px / HZ);
    p.moving = true;
  } else p.moving = false;
}

// Conveyor belts carry whoever stands on them.
export function carry(g, p) {
  if (!g.conv || p.state === 'dead') return;
  const cd = g.conv[idx(cellOf(p.x), cellOf(p.y))];
  if (cd) { const [dx, dy] = DIRS[cd]; if (dx) move(g, p, 0, dx, CONVEYOR_PX / HZ); else move(g, p, 1, dy, CONVEYOR_PX / HZ); }
}

// A position sent by the player's phone: accepted if it is no farther than the fastest
// possible move over a few ticks (messages bunch up on mobile data) and not inside a wall.
const REPORT_TICKS = 5;
function takePosition(g, p, inp) {
  if (!Number.isFinite(inp.x) || !Number.isFinite(inp.y)) return false;
  const max = ((speedPx(10) + CONVEYOR_PX) / HZ) * REPORT_TICKS + 4;
  if (Math.hypot(inp.x - p.x, inp.y - p.y) > max) return false;
  const lim = (n) => n * TILE - HALF;
  if (inp.x < HALF || inp.y < HALF || inp.x > lim(COLS) || inp.y > lim(ROWS)) return false;
  const c = cellOf(inp.x), r = cellOf(inp.y);
  if ((c !== cellOf(p.x) || r !== cellOf(p.y)) && blocked(g, c, r, p)) return false;
  p.x = inp.x; p.y = inp.y;
  if (inp.dir) p.dir = p.curse === 'reverse' ? [0, 2, 1, 4, 3][inp.dir] : inp.dir; // faces where it walks
  p.moving = !!inp.dir;
  return true;
}

// Walking into a balloon with the shoe kicks it: it slides until something stops it.
// Pushing a crate: keep walking into it for a moment and it slides one cell on, if that cell
// is empty (no block, balloon, player or item). sl = { d, at } lets the screens slide it.
const PUSH_DELAY = Math.round(0.2 * HZ);
export const PUSH_SLIDE = Math.round(0.2 * HZ);
function tryPush(g, p, d) {
  const [dx, dy] = DIRS[d];
  const c = cellOf(p.x), r = cellOf(p.y);
  const lane = dx ? Math.abs(p.y - (r * TILE + HALF)) : Math.abs(p.x - (c * TILE + HALF));
  const ahead = dx ? (p.x - (c * TILE + HALF)) * dx : (p.y - (r * TILE + HALF)) * dy;
  const o = inside(c + dx, r + dy) && g.objs[idx(c + dx, r + dy)];
  if (!o || !o.push || o.breakT || o.sl || lane > CORNER || ahead < -1) { p.pushT = 0; return; }
  const tc = c + 2 * dx, tr = r + 2 * dy;
  const busy = !inside(tc, tr) || g.objs[idx(tc, tr)] || bombAt(g, tc, tr) || g.items[idx(tc, tr)]
    || g.players.some((q) => q.state !== 'dead' && cellOf(q.x) === tc && cellOf(q.y) === tr);
  if (busy) { p.pushT = 0; return; }
  p.pushT = (p.pushT || 0) + 1;
  if (p.pushT < PUSH_DELAY) return;
  p.pushT = 0;
  g.objs[idx(tc, tr)] = o; g.objs[idx(c + dx, r + dy)] = null;
  o.sl = { d, at: g.tick };
  emit(g, 'push', { c: tc, r: tr });
}

function tryKick(g, p, d) {
  const [dx, dy] = DIRS[d];
  const c = cellOf(p.x), r = cellOf(p.y);
  const lane = dx ? Math.abs(p.y - (r * TILE + HALF)) : Math.abs(p.x - (c * TILE + HALF));
  if (lane > CORNER) return;
  const ahead = dx ? (p.x - (c * TILE + HALF)) * dx : (p.y - (r * TILE + HALF)) * dy;
  if (ahead < -1) return; // not yet up against the next cell
  const b = bombAt(g, c + dx, r + dy);
  if (!b || b.kick || b.pass.includes(p.id) || !openFor(g, b.c + dx, b.r + dy)) return;
  b.kick = d; b.off = 0;
  emit(g, 'kick', { c: b.c, r: b.r });
}

function emit(g, type, data = {}) { g.events.push({ type, ...data }); }

export function punchTarget(g, p) {
  if (!p.punch) return null;
  const c = cellOf(p.x), r = cellOf(p.y);
  const [dx, dy] = DIRS[p.dir] || [0, 0];
  if (!dx && !dy) return null;
  return bombAt(g, c, r) || bombAt(g, c + dx, r + dy) || null;
}

function placeBomb(g, p) {
  const c = cellOf(p.x), r = cellOf(p.y);
  if (p.curse === 'jam') return;
  // With the glove, the balloon button throws a balloon three cells the way you face: the one
  // you stand on, or else the one right in front of you.
  const thrown = punchTarget(g, p);
  if (thrown) { punch(g, thrown, ...DIRS[p.dir]); return; }
  if (g.bombs.filter((b) => b.owner === p.id).length >= p.bombs) return;
  if (bombAt(g, c, r)) return;
  const o = g.objs[idx(c, r)];
  if (o && o.k !== 'bush') return;
  const pass = g.players.filter((q) => q.state !== 'dead' && overlapsCell(q, c, r)).map((q) => q.id);
  g.bombs.push({ id: g.nextId++, c, r, owner: p.id, power: p.power, t: FUSE, pass, off: 0, kick: 0, fly: null });
  emit(g, 'place', { c, r });
}

// d: for an arm cell its place counted from the arm's tip (1 = tip), for the centre the
// longest arm; it picks the animation (the stream dries up from the tips inwards).
function setFlame(g, c, r, kind, end, d) {
  g.flames[idx(c, r)] = { t: FLAME, kind, end, born: g.tick, d };
}

// Can a sliding balloon go into this cell?
function openFor(g, c, r) {
  if (!inside(c, r)) return false;
  const o = g.objs[idx(c, r)];
  if (o && o.k !== 'bush') return false;
  if (bombAt(g, c, r)) return false;
  return !g.players.some((q) => q.state !== 'dead' && cellOf(q.x) === c && cellOf(q.y) === r);
}

// Kicked or carried balloons: off is the distance from the cell centre along the direction.
function slide(g, b) {
  const dir = b.kick || (g.conv && g.conv[idx(b.c, b.r)]);
  if (!dir) { b.off = 0; return; }
  const [dx, dy] = DIRS[dir];
  const v = (b.kick ? KICK_PX : CONVEYOR_PX) / HZ;
  if (b.off <= 0 && b.off + v > 0 && !openFor(g, b.c + dx, b.r + dy)) { b.off = 0; b.kick = 0; return; }
  b.off += v;
  if (b.off > TILE / 2) { b.c += dx; b.r += dy; b.off -= TILE; b.pass = []; }
  b.dir = dir;
}

// Punched balloons fly three cells (wrapping round the edges, as in the original) and bounce
// on one cell at a time while they would land on something.
function punch(g, b, dx, dy) {
  b.fly = { fc: b.c, fr: b.r, dx, dy, t: PUNCH_TICKS, n: PUNCH_TICKS };
  b.c = (b.c + 3 * dx + COLS) % COLS; b.r = (b.r + 3 * dy + ROWS) % ROWS;
  b.off = 0; b.kick = 0; b.pass = [];
  emit(g, 'punch', { c: b.c, r: b.r });
}
function land(g, b) {
  const { dx, dy } = b.fly;
  const o = g.objs[idx(b.c, b.r)];
  if ((o && o.k !== 'bush') || g.bombs.some((x) => x !== b && !x.fly && x.c === b.c && x.r === b.r)) {
    const n = Math.round(PUNCH_TICKS / 3);
    b.fly = { fc: b.c, fr: b.r, dx, dy, t: n, n };
    b.c = (b.c + dx + COLS) % COLS; b.r = (b.r + dy + ROWS) % ROWS;
    return;
  }
  b.fly = null;
  b.pass = g.players.filter((q) => q.state !== 'dead' && overlapsCell(q, b.c, b.r)).map((q) => q.id);
}

function throwDart(g, p) {
  const [dx, dy] = DIRS[p.dir] || [0, 1];
  let c = cellOf(p.x), r = cellOf(p.y), n = 0;
  for (;;) {
    c += dx; r += dy; n++;
    if (!inside(c, r)) break;
    const o = g.objs[idx(c, r)];
    if (o && o.k !== 'bush' && !o.breakT) break;
    const b = bombAt(g, c, r);
    if (b) { b.t = Math.min(b.t, 1); break; }
  }
  emit(g, 'dart', { id: p.id, c: cellOf(p.x), r: cellOf(p.y), dx: dx || 0, dy: dy || 0, n });
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

// Items a player gives back to the map on dying (the power-ups taken in this round).
const DROPS = new Set(['bomb', 'potion', 'maxpower', 'skate', 'devil', 'shoe', 'punch']);
function applyItem(g, p, k) {
  if (DROPS.has(k)) p.got.push(k);
  switch (k) {
    case 'bomb': p.bombs = Math.min(p.max.bombs, p.bombs + 1); break;
    case 'potion': p.power = Math.min(p.max.power, p.power + 1); break;
    case 'maxpower': p.power = p.max.power; break;
    case 'skate': p.speed = Math.min(p.max.speed, p.speed + 1); break;
    case 'devil': p.bombs = p.max.bombs; p.power = p.max.power; p.speed = p.max.speed; break; // the red devil: everything to the top
    case 'needle': p.needle++; break;
    case 'shield': p.shield++; break;
    case 'dart': p.dart++; break;
    case 'shoe': p.kick = true; break;
    case 'punch': p.punch = true; break;
    case 'skull': p.curse = 'reverse'; p.curseT = CURSE_TIME; break; // the devil: the arrow keys turn around for a while
    default:
      if (ITEMS[k]?.ride && !p.ride) p.ride = k;
      if (ITEMS[k]?.lucci) p.lucci += ITEMS[k].lucci;
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
  scatter(g, p);
}

// A popped player's power-ups spring out onto empty cells around the map, as in the client.
function scatter(g, p) {
  const got = p.got.splice(0);
  if (!got.length) return;
  const free = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const i = idx(c, r);
    if (g.objs[i] || g.items[i] || g.flames[i] || bombAt(g, c, r)) continue;
    if (g.players.some((q) => q.state !== 'dead' && cellOf(q.x) === c && cellOf(q.y) === r)) continue;
    free.push(i);
  }
  for (const k of got) {
    if (!free.length) break;
    const i = free.splice(Math.floor(rng(g) * free.length), 1)[0];
    g.items[i] = { k, fresh: g.tick + Math.round(HZ / 2) };
  }
  emit(g, 'scatter', { id: p.id, n: got.length });
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
    if (inp.item === 'dart' && p.state === 'normal' && p.dart > 0) { p.dart--; throwDart(g, p); }
    if (p.curseT > 0 && --p.curseT <= 0) p.curse = null;
    // A phone reports where its own player is (it moved it already, with no lag); the server
    // takes that when it is a move the rules allow, and walks the player itself otherwise.
    // Between reports (they arrive in bunches) the player stays put rather than being walked
    // ahead of the phone; players who never report (computers) walk here.
    if (inp.x != null && takePosition(g, p, inp)) p.reportT = g.tick;
    else if (p.reportT && g.tick - p.reportT < HZ) { if (inp.dir) p.dir = inp.dir | 0; p.moving = !!inp.dir; }
    else { walk(g, p, inp.dir | 0); carry(g, p); }
    if (p.kick && p.state === 'normal' && inp.dir) tryKick(g, p, inp.dir | 0);
    if (p.state === 'normal' && inp.dir) tryPush(g, p, inp.dir | 0); else p.pushT = 0;
    if ((inp.bomb || p.curse === 'leak') && p.state === 'normal') placeBomb(g, p);
    if (p.state === 'normal') {
      const i = idx(cellOf(p.x), cellOf(p.y));
      if (g.items[i] && !(g.items[i].fresh > g.tick)) { applyItem(g, p, g.items[i].k); g.items[i] = null; }
    }
  }

  // Players leave the bombs they were standing on.
  for (const b of g.bombs) b.pass = b.pass.filter((id) => { const q = g.players.find((x) => x.id === id); return q && overlapsCell(q, b.c, b.r); });

  for (const b of g.bombs) {
    if (b.fly) { if (--b.fly.t <= 0) land(g, b); } else slide(g, b);
  }

  if (playing || g.phase === 'end') {
    for (const b of g.bombs.slice()) if (!b.fly && --b.t <= 0 && g.bombs.includes(b)) explode(g, b);
    // A bomb set off by a stream this tick goes off now too.
    let again = true;
    while (again) { again = false; for (const b of g.bombs.slice()) if (b.t <= 0 && !b.fly) { explode(g, b); again = true; } }
  }

  for (let i = 0; i < g.flames.length; i++) {
    const f = g.flames[i];
    if (!f) continue;
    if (--f.t <= 0) { g.flames[i] = null; continue; }
    const c = i % COLS, r = (i / COLS) | 0;
    for (const p of g.players) if (p.state === 'normal' && cellOf(p.x) === c && cellOf(p.y) === r) trap(g, p);
  }

  for (const o of g.objs) if (o && o.sl && g.tick - o.sl.at >= PUSH_SLIDE) o.sl = null;
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
      // The nearest touching player decides: a teammate frees, an opponent pops.
      let near = null, nd = Infinity;
      for (const q of g.players) {
        if (q === p || q.state !== 'normal') continue;
        const d = Math.hypot(q.x - p.x, q.y - p.y), mate = g.mode === 'team' && q.team === p.team;
        if (d <= (mate ? RESCUE : CONTACT) && d < nd) { near = q; nd = d; }
      }
      if (near) { if (g.mode === 'team' && near.team === p.team) free(g, p, near); else die(g, p, near); }
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
      p.bombs, p.power, p.speed, p.needle, p.shield, p.shieldT, p.ride, p.invT, p.kills,
      p.dart, p.kick ? 1 : 0, p.punch ? 1 : 0, p.curse, p.curseT, p.lucci]),
    b: g.bombs.map((b) => [b.id, b.c, b.r, b.t, b.owner, b.pass, Math.round(b.off), b.dir || 0,
      b.fly ? [b.fly.fc, b.fly.fr, b.fly.dx, b.fly.dy, b.fly.t, b.fly.n] : 0]),
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
