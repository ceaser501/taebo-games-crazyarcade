// Computer players. Each tick a bot looks at the board on a cell grid: which cells a stream
// will reach and when, where it can walk, and picks between running to safety, bursting a
// trapped enemy, freeing a trapped teammate, picking up an item, or placing a balloon when it
// has a way out.
import { COLS, ROWS, TILE, HZ, FUSE, FLAME, speedPx } from './const.js';
import { cellOf } from './sim.js';

const idx = (c, r) => r * COLS + c;
const inside = (c, r) => c >= 0 && r >= 0 && c < COLS && r < ROWS;
const NB = [[0, -1, 1], [0, 1, 2], [-1, 0, 3], [1, 0, 4]];

// When (in ticks from now) each cell gets hit; Infinity if never. Chains are followed.
function dangerMap(g) {
  const when = new Array(COLS * ROWS).fill(Infinity);
  for (let i = 0; i < g.flames.length; i++) if (g.flames[i]) when[i] = 0;
  const bombs = g.bombs.map((b) => ({ ...b, at: b.t }));
  const byCell = new Map(bombs.map((b) => [idx(b.c, b.r), b]));
  // Relax chain reactions: a bomb hit earlier goes off earlier.
  for (let pass = 0; pass < 4; pass++) {
    bombs.sort((a, b) => a.at - b.at);
    for (const b of bombs) {
      const hit = (c, r) => {
        const i = idx(c, r);
        if (b.at < when[i]) when[i] = b.at;
        const o = byCell.get(i);
        if (o && o !== b && o.at > b.at) o.at = b.at;
      };
      hit(b.c, b.r);
      for (const [dc, dr] of NB) {
        for (let k = 1; k <= b.power; k++) {
          const c = b.c + dc * k, r = b.r + dr * k;
          if (!inside(c, r)) break;
          const o = g.objs[idx(c, r)];
          if (o && o.k !== 'bush' && !o.breakT) break;
          hit(c, r);
          if (byCell.has(idx(c, r))) break;
        }
      }
    }
  }
  return when;
}

function walkable(g, c, r, me) {
  if (!inside(c, r)) return false;
  const o = g.objs[idx(c, r)];
  if (o && o.k !== 'bush' && !o.breakT) return false;
  const b = g.bombs.find((x) => x.c === c && x.r === r);
  return !b || b.pass.includes(me.id);
}

// Breadth-first search from the bot's cell. Returns { dist, first } arrays: steps to each cell
// and the first move (1-4) to get there, avoiding cells that will be under water on arrival.
function search(g, me, when, extraBlock = null) {
  const sc = cellOf(me.x), sr = cellOf(me.y);
  const perStep = Math.max(2, Math.round((TILE / speedPx(me.speed)) * HZ));
  const dist = new Array(COLS * ROWS).fill(-1), first = new Array(COLS * ROWS).fill(0);
  const q = [[sc, sr]]; dist[idx(sc, sr)] = 0;
  while (q.length) {
    const [c, r] = q.shift();
    const d = dist[idx(c, r)];
    for (const [dc, dr, dir] of NB) {
      const nc = c + dc, nr = r + dr, ni = idx(nc, nr);
      if (!inside(nc, nr) || dist[ni] >= 0) continue;
      if (!walkable(g, nc, nr, me) || (extraBlock && extraBlock(nc, nr))) continue;
      const arrive = (d + 1) * perStep;
      // Do not walk into a stream that is there when we would be.
      if (when[ni] <= arrive + 2 && when[ni] + FLAME >= arrive - perStep) continue;
      dist[ni] = d + 1; first[ni] = d === 0 ? dir : first[idx(c, r)];
      q.push([nc, nr]);
    }
  }
  return { dist, first, perStep };
}

// Direction that keeps the bot on its row/column while heading for a cell's centre.
function steer(me, c, r, fallback) {
  const tx = c * TILE + TILE / 2, ty = r * TILE + TILE / 2;
  const dx = tx - me.x, dy = ty - me.y;
  if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return 0;
  if (fallback === 1 || fallback === 2) { if (Math.abs(dx) > 3) return dx < 0 ? 3 : 4; return dy < 0 ? 1 : 2; }
  if (fallback === 3 || fallback === 4) { if (Math.abs(dy) > 3) return dy < 0 ? 1 : 2; return dx < 0 ? 3 : 4; }
  return Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 3 : 4) : (dy < 0 ? 1 : 2);
}

// Towards the middle of the current cell, but only while more than a step away: a shorter
// move would overshoot and the bot would shake around the middle.
function center(me) {
  const step = speedPx(me.speed) / HZ;
  const dx = cellOf(me.x) * TILE + TILE / 2 - me.x, dy = cellOf(me.y) * TILE + TILE / 2 - me.y;
  if (Math.abs(dx) >= step) return dx < 0 ? 3 : 4;
  if (Math.abs(dy) >= step) return dy < 0 ? 1 : 2;
  return 0;
}

function lineHits(g, c, r, power, test) {
  for (const [dc, dr] of NB) for (let k = 1; k <= power; k++) {
    const cc = c + dc * k, rr = r + dr * k;
    if (!inside(cc, rr)) break;
    const o = g.objs[idx(cc, rr)];
    if (o && o.k === 'hard') break;
    if (test(cc, rr)) return true;
    if (o && o.k === 'soft') break;
  }
  return false;
}

export class Bot {
  constructor(id, level = 1) {
    this.id = id; this.level = level; this.seed = id * 9301 + 49297; this.plan = null; this.wait = 0; this.cool = 0;
  }
  rand() { this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff; return this.seed / 0x7fffffff; }

  think(g) {
    const me = g.players.find((p) => p.id === this.id);
    if (!me || me.state === 'dead' || g.phase !== 'play') return { dir: 0 };
    if (me.state === 'trapped') return { dir: 0, item: me.needle > 0 && me.stateT < TRAP_HURRY ? 'needle' : null };
    if (this.cool > 0) this.cool--;
    const when = dangerMap(g);
    const mc = cellOf(me.x), mr = cellOf(me.y), mi = idx(mc, mr);
    const S = search(g, me, when);
    const safe = (i) => when[i] === Infinity;

    // 1. In danger: run to the nearest safe cell.
    if (when[mi] !== Infinity) {
      // Keep the escape picked before while it is still safe and reachable, so the bot does not
      // turn back and forth between two equally near cells.
      let best = this.escape != null && S.dist[this.escape] > 0 && safe(this.escape) ? this.escape : -1;
      if (best < 0) for (let i = 0; i < S.dist.length; i++) if (S.dist[i] > 0 && safe(i) && (best < 0 || S.dist[i] < S.dist[best])) best = i;
      this.escape = best >= 0 ? best : null;
      if (best >= 0) return this.go(me, S, best);
      if (me.shield > 0 && when[mi] < 6) return { dir: 0, item: 'shield' };
      return { dir: 0 };
    }

    // Out of danger: plan routes that never step into a cell a balloon is about to hit, or the
    // bot steps in, sees the danger, steps back out, and shakes at the edge.
    const SS = search(g, me, when, (c, r) => when[idx(c, r)] !== Infinity);
    const enemies = g.players.filter((p) => p.state !== 'dead' && p.id !== me.id && (g.mode !== 'team' || p.team !== me.team));
    const friends = g.players.filter((p) => p.state === 'trapped' && p.id !== me.id && g.mode === 'team' && p.team === me.team);

    // 2. Burst a trapped enemy or free a trapped friend.
    for (const t of [...enemies.filter((p) => p.state === 'trapped'), ...friends]) {
      const ti = idx(cellOf(t.x), cellOf(t.y));
      if (SS.dist[ti] >= 0 && SS.dist[ti] < 12) {
        if (SS.dist[ti] === 0) return { dir: steer(me, cellOf(t.x), cellOf(t.y), 0) || (t.x < me.x ? 3 : 4) };
        return this.go(me, SS, ti);
      }
    }

    // 3. Place a balloon when it would hit something and there is a way out.
    const mine = g.bombs.filter((b) => b.owner === me.id).length;
    if (mine < me.bombs && this.cool <= 0 && !g.bombs.some((b) => b.c === mc && b.r === mr)) {
      const softNear = lineHits(g, mc, mr, Math.min(me.power, 1), (c, r) => { const o = g.objs[idx(c, r)]; return o && o.k === 'soft' && !o.breakT; });
      const enemyNear = lineHits(g, mc, mr, me.power, (c, r) => enemies.some((e) => e.state === 'normal' && cellOf(e.x) === c && cellOf(e.y) === r));
      if (softNear || enemyNear) {
        // Pretend the balloon is placed and check for an escape.
        const fake = { ...g, bombs: [...g.bombs, { id: -1, c: mc, r: mr, owner: me.id, power: me.power, t: FUSE, pass: [me.id] }] };
        const w2 = dangerMap(fake), S2 = search(fake, me, w2);
        let esc = -1;
        for (let i = 0; i < S2.dist.length; i++) if (S2.dist[i] > 0 && w2[i] === Infinity && (esc < 0 || S2.dist[i] < S2.dist[esc])) esc = i;
        if (esc >= 0 && S2.dist[esc] * S2.perStep < FUSE - 10 && this.rand() < (enemyNear ? 0.9 : 0.6)) {
          this.cool = Math.round(HZ * (0.3 + this.rand() * 0.5));
          return { dir: 0, bomb: true };
        }
      }
    }

    // 4. Items close by.
    let target = -1;
    for (let i = 0; i < g.items.length; i++) if (g.items[i] && SS.dist[i] > 0 && SS.dist[i] < 9 && safe(i) && (target < 0 || SS.dist[i] < SS.dist[target])) target = i;
    if (target >= 0) return this.go(me, SS, target);

    // 5. Head for a cell next to a breakable block or towards an enemy.
    // Arrived (and settled in the middle): pick the next place at once instead of idling.
    if (this.plan && SS.dist[this.plan.cell] === 0 && !center(me)) this.plan = null;
    if (!this.plan || this.plan.until < g.tick || SS.dist[this.plan.cell] < 0 || !safe(this.plan.cell)) {
      const cands = [];
      for (let i = 0; i < SS.dist.length; i++) {
        if (SS.dist[i] <= 0 || !safe(i)) continue;
        const c = i % COLS, r = (i / COLS) | 0;
        let score = 0;
        for (const [dc, dr] of NB) { const o = inside(c + dc, r + dr) && g.objs[idx(c + dc, r + dr)]; if (o && o.k === 'soft' && !o.breakT) score += 3; }
        for (const e of enemies) score += Math.max(0, 6 - (Math.abs(cellOf(e.x) - c) + Math.abs(cellOf(e.y) - r))) * 1.5;
        score -= SS.dist[i] * 0.6;
        score += this.rand() * 2;
        cands.push([score, i]);
      }
      cands.sort((a, b) => b[0] - a[0]);
      this.plan = cands.length ? { cell: cands[0][1], until: g.tick + HZ * 3 } : null;
    }
    if (this.plan && SS.dist[this.plan.cell] >= 0) return this.go(me, SS, this.plan.cell);
    return { dir: 0 };
  }

  // One step along the BFS path to cell i: just the direction of the first move. Lining up
  // with the lane is left to the walking rules (they slide onto it without overshooting);
  // steering sideways by hand made fast bots overshoot and shake from side to side.
  go(me, S, i) {
    if (S.dist[i] === 0) return { dir: center(me) };
    return { dir: S.first[i] || 0 };
  }
}

const TRAP_HURRY = Math.round(2.5 * HZ);
