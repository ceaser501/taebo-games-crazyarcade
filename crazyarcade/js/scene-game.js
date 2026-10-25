// The round: PC game screen (map on the left, players and timer on the right). The server's
// snapshots are the truth; this player's character is predicted locally so it answers the
// stick at once, and everyone else is drawn a few ticks in the past, interpolated, so they
// glide smoothly between updates.
import * as A from './assets.js';
import { stage, ui, text, roundRect, W } from './stage.js';
import * as input from './input.js';
import { sfx, playMusic, stopMusic } from './audio.js';
import { COLS, ROWS, TILE, HZ, TEAMS, ITEMS, RIDES, PUNCH_TICKS, charById } from './shared/const.js';
import { createGame, walk, carry, cellOf, DIR_NAMES, DIRS, PUSH_SLIDE } from './shared/sim.js';
import { mapById } from './shared/room.js';
import * as Wallet from './wallet.js';
import { viewMode, showSettings, settingsShown } from './settings.js';

const WW = COLS * TILE, WH = ROWS * TILE; // the map in world pixels (600×520)
const INTERP = 4; // ticks others are drawn behind the server clock (smooths uneven arrival)

// Flame/Flame states FireL01..FireL10 (left arm; up, right and down add 1, 2, 3): row n is the
// cell n places from the arm's tip, so the tip dries up first and the stream recedes inwards.
const FLAME_ARM = (() => {
  const grow = [4, 16, 20, 24, 28, 32, 36, 40, 44, 48];
  const dry = [64, 60, 72, 76, 80, 84, 88, 92, 96];
  const hold = [52, 56, 52, 48, 52, 56, 52, 48];
  const rows = [[4, 8, 12, 8, 12, 8, 12, 8, 12, 60, 64, 60, 72, 76, 80, 84, 88, 92, 96]];
  for (let n = 2; n <= 10; n++) rows.push([...grow, ...dry.map((f, k) => (k < n - 2 ? hold[k] : f))]);
  return rows;
})();

export class GameScene {
  constructor(app, conn, start, me) {
    Object.assign(this, { app, conn, me });
    this.map = mapById(start.map);
    this.g = createGame({ map: this.map, players: start.players, seed: start.seed, mode: start.mode });
    this.mode = start.mode;
    this.buffers = new Map(this.g.players.map((p) => [p.id, []]));
    this.deathAt = new Map(); this.trapAt = new Map(); this.effects = [];
    this.localTick = 0; this.acc = 0; this.last = performance.now();
    this.hist = []; this.lastSent = { d: -1 }; this.pendingBombs = []; this.darts = [];
    this.snapTick = 0; this.snapTime = 0; this.clock = 0; this.clockSet = false; this.result = null; this.endAt = 0;
    this.floorCanvas = null;
    // Shop decorations each player wears: { hat, bomb, pet } by player id; pets trail behind.
    this.looks = new Map(start.players.map((p) => [p.id, p.look || {}]));
    this.trails = new Map();
    this.ready = this.load();
    input.enable(true);
    this.off = conn.on ? null : null;
  }

  async load() {
    const chars = [...new Set(this.g.players.map((p) => p.char))];
    Wallet.loadLook({}).then(() => Promise.all([...this.looks.values()].map((l) => Wallet.loadLook(l))));
    await Promise.all([...this.map.sets.map((t) => A.loadGroup(`tile_${t}`)), A.loadGroup('game'), A.loadBg('game'), ...chars.map((c) => A.loadGroup(`char_${c}`))]);
    this.buildFloor();
    playMusic(this.map.bgm);
    sfx('Ntc_GameStart');
  }

  buildFloor() {
    const cv = document.createElement('canvas');
    cv.width = COLS * TILE; cv.height = ROWS * TILE;
    const c = cv.getContext('2d');
    c.fillStyle = '#5a8d3a'; c.fillRect(0, 0, cv.width, cv.height);
    for (let r = 0; r < ROWS; r++) for (let col = 0; col < COLS; col++) {
      const t = this.map.tiles[this.map.floor[r * COLS + col]];
      if (t && !this.map.conv?.[r * COLS + col]) A.draw(c, t[0], 0, col * TILE, r * TILE + TILE - 1);
    }
    this.floorCanvas = cv;
  }

  myPlayer() { return this.g.players.find((p) => p.id === this.me); }

  onMessage(m) {
    if (m.t !== 's') return;
    const g = this.g;
    g.phase = m.ph; g.phaseT = m.pt; g.timer = m.tm; g.hurry = m.hu; g.result = m.rs;
    this.snapTick = m.k; this.snapTime = performance.now();
    // The server clock runs on local time and is nudged towards each snapshot's tick, so
    // uneven arrival does not make others jump back and forth.
    if (!this.clockSet || Math.abs(m.k - this.clock) > 12) { this.clock = m.k; this.clockSet = true; }
    else this.clock += (m.k - this.clock) * 0.06;
    for (const row of m.p) {
      const [id, x, y, dir, moving, state, stateT, bombs, power, speed, needle, shield, shieldT, ride, invT, kills,
        dart, kick, punch, curse, curseT, lucci] = row;
      const p = g.players.find((q) => q.id === id);
      if (!p) continue;
      Object.assign(p, { state, stateT, bombs, power, speed, needle, shield, shieldT, ride, invT, kills,
        dart, kick: !!kick, punch: !!punch, curse, curseT, lucci });
      if (id === this.me) this.reconcile(p, x, y, dir, moving);
      else {
        const b = this.buffers.get(id);
        b.push({ k: m.k, x, y, dir, moving });
        if (b.length > 20) b.shift();
      }
    }
    g.bombs = m.b.map(([id, c, r, t, owner, pass, off, dir, fly]) => ({ id, c, r, t, owner, pass, power: 1, off, dir,
      fly: fly ? { fc: fly[0], fr: fly[1], dx: fly[2], dy: fly[3], t: fly[4], n: fly[5], at: performance.now() } : null }));
    this.pendingBombs = this.pendingBombs.filter((pb) => !g.bombs.some((b) => b.c === pb.c && b.r === pb.r) && performance.now() - pb.at < 400);
    if (m.m) for (const [i, ot, bt, it, f, sl] of m.m) {
      g.objs[i] = ot >= 0 ? { t: ot, k: g.tiles[ot].k, breakT: bt, push: !!g.tiles[ot].push, sl: sl ? { d: sl[0], at: sl[1] } : null } : null;
      g.items[i] = it ? { k: it, fresh: 0 } : null;
      g.flames[i] = f ? { kind: f[0], end: !!f[1], born: f[2], d: f[3] } : null;
    }
    for (const e of m.ev || []) this.event(e);
  }

  // Our own character: compare the server's position with where we predicted we were one
  // round trip ago and fold the difference in gently (or at once if it is large).
  reconcile(p, x, y, dir, moving) {
    if (p.state === 'dead' || this.g.phase !== 'play') { p.x = p.px = x; p.y = p.py = y; p.dir = dir; p.moving = !!moving; this.hist = []; return; }
    const lag = Math.round(((this.conn.rtt || 0) / 1000) * HZ) + 1;
    const h = this.hist.find((e) => e.t === this.localTick - lag) || this.hist[this.hist.length - 1];
    if (!h) { p.x = p.px = x; p.y = p.py = y; return; }
    const dx = x - h.x, dy = y - h.y;
    // The server follows our reports, so small differences are only lag: leave them alone.
    if (Math.hypot(dx, dy) < 18) return;
    const big = Math.hypot(dx, dy) > 34;
    const k = big ? 1 : 0.25;
    p.x += dx * k; p.y += dy * k;
    if (p.px != null) { p.px += dx * k; p.py += dy * k; }
    for (const e of this.hist) { e.x += dx * k; e.y += dy * k; }
  }

  event(e) {
    const g = this.g;
    switch (e.type) {
      case 'go': sfx('Ntc_GameStart', 0.6); break;
      case 'place': sfx('Cha_BombIgnite', 0.7); break;
      case 'boom': sfx('Cha_BombExplode', 0.6); break;
      case 'trap': this.trapAt.set(e.id, performance.now()); sfx('Cha_LockedIn'); break;
      case 'pop': this.deathAt.set(e.id, performance.now()); sfx('Cha_Die'); break;
      case 'free': sfx('Cha_Release'); break;
      case 'pick':
        if (e.id !== this.me) break;
        if (ITEMS[e.item]?.lucci) sfx('Itm_TakeCoin', 0.7);
        else if (e.item === 'skull') sfx('Itm_Devil_Start', 0.8);
        else sfx('Itm_ItemEaten', 0.7);
        break;
      case 'needle': sfx('Itm_Niddle'); break;
      case 'shield': sfx('Itm_ShieldOn'); break;
      case 'unride': sfx('Cha_Release', 0.5); break;
      case 'kick': sfx('Cha_KickBomb', 0.8); break;
      case 'push': sfx('Cha_KickBomb', 0.4); break;
      case 'punch': sfx('Cha_ThrowBomb', 0.8); break;
      case 'dart': sfx('Itm_ThrowDart', 0.8); this.darts.push({ ...e, at: performance.now() }); break;
      case 'hurry': sfx('Ntc_HurryUp'); break;
      case 'end': {
        const mine = g.players.find((p) => p.id === this.me);
        const won = e.team !== null && mine && mine.team === e.team;
        this.result = e.team === null ? 'draw' : won ? 'win' : mine ? 'lose' : 'win';
        this.endAt = performance.now();
        // Lucci: the coins picked up this round plus a bonus by the result.
        if (mine && !this.paid) { this.paid = (mine.lucci || 0) + Wallet.ROUND_BONUS[this.result]; Wallet.earn(this.paid); Wallet.record(this.result, mine.kills); }
        stopMusic();
        playMusic(this.result === 'win' ? 'Ntc_Win' : this.result === 'lose' ? 'Ntc_Lose' : 'Ntc_Draw');
        break;
      }
    }
  }

  // Fixed 30 Hz steps for input and prediction.
  update(now) {
    const el = Math.min(250, now - this.last);
    this.acc += el; this.last = now;
    if (this.clockSet) this.clock += (el / 1000) * HZ;
    const dt = 1000 / HZ;
    while (this.acc >= dt) { this.acc -= dt; this.fixed(); }
  }

  fixed() {
    this.localTick++;
    const g = this.g, p = this.myPlayer();
    const inp = input.read();
    if (!p) return;
    let item = inp.item;
    if (item === 'auto') item = p.state === 'trapped' ? 'needle' : p.dart > 0 ? 'dart' : 'shield';
    const msg = { t: 'in', d: inp.dir, ct: this.localTick };
    let send = inp.dir !== this.lastSent.d || this.localTick - (this.lastSent.at || 0) > HZ;
    if (inp.bomb) { msg.b = 1; send = true; this.predictBomb(p); }
    if (item) { msg.i = item; send = true; }
    p.px = p.x; p.py = p.y; // where this step starts, for drawing between steps
    if (g.phase === 'play' && p.state !== 'dead') { walk(g, p, inp.dir); carry(g, p); }
    else p.moving = false;
    // While playing, the server takes our position from us (checked), so it never lags.
    const moved = Math.abs(p.x - (this.lastSent.x ?? -1)) > 0.05 || Math.abs(p.y - (this.lastSent.y ?? -1)) > 0.05;
    if (g.phase === 'play' && p.state !== 'dead' && (moved || send)) { msg.x = Math.round(p.x * 10) / 10; msg.y = Math.round(p.y * 10) / 10; send = true; }
    if (send) { this.conn.send(msg); this.lastSent = { d: inp.dir, at: this.localTick, x: p.x, y: p.y }; }
    p.anim = (p.anim || 0) + 1;
    this.hist.push({ t: this.localTick, x: p.x, y: p.y });
    if (this.hist.length > 60) this.hist.shift();
    input.setCounts({ needle: p.needle, shield: p.shield, dart: p.dart || 0 });
  }

  predictBomb(p) {
    if (p.state !== 'normal' || this.g.phase !== 'play') return;
    const c = cellOf(p.x), r = cellOf(p.y);
    const mine = this.g.bombs.filter((b) => b.owner === p.id).length + this.pendingBombs.length;
    if (mine >= p.bombs || this.g.bombs.some((b) => b.c === c && b.r === r)) return;
    this.pendingBombs.push({ c, r, at: performance.now(), owner: p.id });
  }

  // Where another player is drawn: INTERP ticks behind the newest snapshot, interpolated.
  view(p) {
    if (p.id === this.me) {
      // Drawn between the last two 30 Hz steps, so it glides on 60/120 Hz screens.
      const a = Math.min(1, this.acc / (1000 / HZ));
      if (p.px == null || Math.hypot(p.x - p.px, p.y - p.py) > 30) return { x: p.x, y: p.y, dir: p.dir, moving: p.moving };
      return { x: p.px + (p.x - p.px) * a, y: p.py + (p.y - p.py) * a, dir: p.dir, moving: p.moving };
    }
    const b = this.buffers.get(p.id);
    if (!b || !b.length) return { x: p.x, y: p.y, dir: p.dir, moving: false };
    const t = this.clock - INTERP;
    let i = b.length - 1;
    while (i > 0 && b[i - 1].k > t) i--;
    const a = b[Math.max(0, i - 1)], c = b[i];
    if (t >= c.k || a === c) return { x: c.x, y: c.y, dir: c.dir, moving: !!c.moving };
    const f = Math.max(0, Math.min(1, (t - a.k) / (c.k - a.k || 1)));
    return { x: a.x + (c.x - a.x) * f, y: a.y + (c.y - a.y) * f, dir: c.dir, moving: !!c.moving };
  }

  // Laid out for the phone rather than the PC's 800×600. 'full' view: the map as tall as the
  // screen in the middle, the timer and players in the left margin, my items and the exit in
  // the right one, and the touch controls low in both margins. 'big' view (as the mobile game):
  // the map fills the whole screen, the camera follows me and everything else sits over it.
  layout() {
    const vw = stage.cssW, vh = stage.cssH, mode = viewMode();
    if (mode === 'big') {
      const k = Math.max(vw / WW, vh / WH);
      this.L = { k, x: 0, y: 0, vw, vh, mode };
      input.setSides(0);
      return;
    }
    let k = (vh - 8) / WH;
    const side = (vw - WW * k) / 2;
    if (side < 130) k = Math.max((vh - 8) / WH * 0.72, Math.min((vh - 8) / WH, (vw - 260) / WW));
    if (WW * k > vw) k = vw / WW;
    this.L = { k, x: Math.round((vw - WW * k) / 2), y: Math.round((vh - WH * k) / 2), vw, vh, mode };
    input.setSides(this.L.x);
  }

  // Big view: the map's offset on screen, centred on me (or where the camera last was) and kept
  // inside the map's edges.
  camera() {
    const { k, vw, vh } = this.L, me = this.myPlayer();
    if (me && me.state !== 'dead') { const v = this.view(me); this.cam = { x: v.x, y: v.y }; }
    const at = this.cam || { x: WW / 2, y: WH / 2 };
    const clamp = (v, lo) => Math.round(Math.min(0, Math.max(lo, v)));
    this.L.x = clamp(vw / 2 - at.x * k, vw - WW * k);
    this.L.y = clamp(vh / 2 - at.y * k, vh - WH * k);
  }

  draw(now) {
    this.update(now);
    if (!this.L || this.L.vw !== stage.cssW || this.L.vh !== stage.cssH || this.L.mode !== viewMode()) this.layout();
    const big = this.L.mode === 'big';
    if (big) this.camera();
    const { k, x, y, vw, vh } = this.L;
    const c = stage.begin();
    if (big) { c.fillStyle = '#04163f'; c.fillRect(0, 0, vw, vh); } else {
      const sky = c.createLinearGradient(0, 0, 0, vh);
      sky.addColorStop(0, '#1a5fc8'); sky.addColorStop(1, '#0a2f78');
      c.fillStyle = sky; c.fillRect(0, 0, vw, vh);
      // The map with a frame round it.
      c.fillStyle = '#04163f'; roundRect(c, x - 4, y - 4, WW * k + 8, WH * k + 8, 8); c.fill();
      c.strokeStyle = '#7fd4ff'; c.lineWidth = 2; c.stroke();
    }
    c.save();
    c.translate(x, y); c.scale(k, k);
    c.beginPath(); c.rect(0, 0, WW, WH); c.clip();
    if (this.floorCanvas) c.drawImage(this.floorCanvas, 0, 0);
    this.drawWorld(c, now);
    this.drawOverlay(c, now, big ? (vw / 2 - x) / k : WW / 2, big ? (vh / 2 - y) / k : WH / 2);
    c.restore();
    if (big) this.drawHudBig(c, now); else this.drawHud(c, now);
    ui.end();
    input.draw();
  }

  // Opens the settings over the game (the view switches as soon as it is picked).
  openSettings() { if (!settingsShown()) { sfx('Bt_c_Pop', 0.6); showSettings(); } }

  drawWorld(c, now) {
    const g = this.g, t = now / 1000;
    const views = g.players.map((p) => ({ p, v: this.view(p) }));
    if (this.map.conv) {
      for (let i = 0; i < this.map.conv.length; i++) {
        if (!this.map.conv[i]) continue;
        const t = this.map.tiles[this.map.floor[i]];
        if (t) A.draw(c, t[0], Math.floor(now / 90) % Math.max(1, A.frames(t[0])), (i % COLS) * TILE, Math.floor(i / COLS) * TILE + TILE - 1);
      }
    }
    for (let r = 0; r < ROWS; r++) {
      // Water streams and items lie on the floor.
      for (let col = 0; col < COLS; col++) {
        const i = r * COLS + col, ax = col * TILE, ay = r * TILE + TILE - 1;
        const f = g.flames[i];
        if (f) this.drawFlame(c, f, ax, ay);
        const it = g.items[i];
        if (it && ITEMS[it.k]) {
          const bob = Math.round(Math.sin(t * 5 + i) * 2);
          c.fillStyle = 'rgba(0,0,0,0.25)'; c.beginPath(); c.ellipse(ax + 20, ay - 4, 13, 4, 0, 0, Math.PI * 2); c.fill();
          const [w, h] = A.size(ITEMS[it.k].sprite);
          A.drawAt(c, ITEMS[it.k].sprite, 0, ax + 20 - w / 2, ay - h - 4 + bob);
        }
      }
      for (const b of g.bombs) if (!b.fly && b.r === r) this.drawBomb(c, b, now);
      for (const b of this.pendingBombs) if (b.r === r) this.drawBomb(c, b, now);
      for (let col = 0; col < COLS; col++) {
        const o = g.objs[r * COLS + col];
        if (!o) continue;
        const tile = this.map.tiles[o.t];
        if (!tile || tile[0] === '$cover') continue;
        let ax = col * TILE, ay = r * TILE + TILE - 1;
        const name = tile[0];
        // A pushed crate slides in from the cell it left.
        if (o.sl) {
          const f = Math.max(0, 1 - (this.clock - o.sl.at) / PUSH_SLIDE);
          const [dx, dy] = DIRS[o.sl.d];
          ax -= dx * TILE * f; ay -= dy * TILE * f;
        }
        if (o.breakT) {
          const brk = tile[4] || name;
          A.draw(c, brk, Math.min(A.frames(brk) - 1, o.breakT), ax, ay);
        } else {
          const n = A.frames(name);
          const animated = tile[1] === 'hard' && n > 1;
          const bushHas = tile[1] === 'bush' && views.some(({ v }) => cellOf(v.x) === col && cellOf(v.y) === r);
          A.draw(c, name, animated ? Math.floor(t * 5) % n : bushHas ? Math.floor(t * 10) % n : 0, ax, ay);
        }
      }
      const here = views.filter(({ v }) => cellOf(v.y) === r).sort((a, b) => a.v.y - b.v.y);
      for (const { p, v } of here) this.drawPlayer(c, p, v, now);
    }
    // Punched balloons fly over everything.
    for (const b of g.bombs) if (b.fly) this.drawBomb(c, b, now);
    this.drawDarts(c, now);
    // Names over everyone, never hidden behind houses.
    for (const { p, v } of views) {
      if (p.state === 'dead' || this.inBush(v) && p.id !== this.me) continue;
      text(p.name, v.x, v.y - 44, { size: 11, bold: true, align: 'center', color: TEAMS[p.color]?.css || '#fff', shadow: '#000' });
      if (p.id === this.me) {
        c.fillStyle = '#ffe000';
        c.beginPath(); c.moveTo(v.x - 6, v.y - 62); c.lineTo(v.x + 6, v.y - 62); c.lineTo(v.x, v.y - 54); c.closePath(); c.fill();
      }
    }
  }

  inBush(v) {
    const o = this.g.objs[cellOf(v.y) * COLS + cellOf(v.x)];
    return o && o.k === 'bush';
  }

  // A balloon where it is: sliding (off along its direction) or in the air after a punch.
  drawBomb(c, b, now) {
    const skin = this.looks.get(b.owner || this.me)?.bomb;
    const sprite = skin && A.has(`BombDeco/${skin}`) ? `BombDeco/${skin}` : 'Bomb/Bomb00';
    const n = Math.max(1, A.frames(sprite));
    let x = b.c * TILE, y = b.r * TILE + TILE - 1, lift = 0;
    if (b.fly) {
      const total = b.fly.n === PUNCH_TICKS ? 3 : 1;
      const f = Math.min(1, 1 - (b.fly.t - ((now - b.fly.at) / 1000) * HZ) / b.fly.n);
      const fx = b.fly.fc + b.fly.dx * total * f, fy = b.fly.fr + b.fly.dy * total * f;
      x = (((fx % COLS) + COLS) % COLS) * TILE; y = (((fy % ROWS) + ROWS) % ROWS) * TILE + TILE - 1;
      lift = Math.sin(Math.max(0, f) * Math.PI) * (total === 3 ? 60 : 24);
    } else if (b.off && b.dir) {
      const [dx, dy] = DIRS[b.dir];
      x += dx * b.off; y += dy * b.off;
    }
    if (lift) { c.fillStyle = 'rgba(0,0,0,0.25)'; c.beginPath(); c.ellipse(x + 20, y - 4, 12, 4, 0, 0, Math.PI * 2); c.fill(); }
    if (!A.draw(c, sprite, Math.floor(now / 140) % n, x, y - lift)) {
      c.fillStyle = '#3ab0ff'; c.beginPath(); c.arc(x + 20, y - 18 - lift, 15, 0, Math.PI * 2); c.fill();
    }
  }

  // Thrown darts fly out from the thrower for a short moment.
  drawDarts(c, now) {
    this.darts = this.darts.filter((d) => now - d.at < 60 * d.n + 120);
    for (const d of this.darts) {
      const k = Math.min(d.n, (now - d.at) / 60);
      const x = (d.c + d.dx * k) * TILE, y = (d.r + d.dy * k) * TILE + TILE - 1;
      const dirFrame = d.dx < 0 ? 0 : d.dy < 0 ? 1 : d.dx > 0 ? 2 : 3;
      if (!A.draw(c, 'Item/ThrownDart', Math.min(dirFrame, Math.max(0, A.frames('Item/ThrownDart') - 1)), x, y)) {
        c.fillStyle = '#fff'; c.fillRect(x + 16, y - 24, 8, 8);
      }
    }
  }

  // Fire00 (100 frames): 0-3 centre; then for each arm direction k (left, up, right, down)
  // three tip frames (4+k, 8+k, 12+k), ten middle frames (16+k … 52+k) and the fading frames.
  // Frames of Bomb/Fire00 from the client's Flame/Flame animation table, one frame per step.
  drawFlame(c, f, ax, ay) {
    // Age from the server clock: the flame's own record does not change while it burns.
    const age = Math.max(0, Math.min(18, Math.floor(this.clock - f.born)));
    const n = Math.max(1, Math.min(10, f.d || 1));
    let frame;
    if (f.kind === 'c') frame = age < 4 ? age : age < 7 + n ? 2 + ((age - 4) & 1) : 2 + ((7 + n - 4) & 1);
    else frame = FLAME_ARM[n - 1][age] + { l: 0, u: 1, r: 2, d: 3 }[f.kind];
    if (!A.draw(c, 'Bomb/Fire00', frame, ax, ay)) { c.fillStyle = 'rgba(80,180,255,0.7)'; c.fillRect(ax + 4, ay - 35, 32, 32); }
  }

  drawPlayer(c, p, v, now) {
    const g = this.g;
    const ax = v.x - TILE / 2, ay = v.y + TILE / 2 - 1;
    const ch = p.char, team = p.color;
    const hidden = this.inBush(v) && p.id !== this.me && p.state === 'normal';
    if (hidden) return;
    let alpha = p.invT > 0 && Math.floor(now / 80) % 2 ? 0.45 : 1;
    if (this.inBush(v)) alpha = 0.5;
    let action, frame;
    const dirName = DIR_NAMES[v.dir] || 'Down';
    if (p.state === 'dead') {
      const t0 = this.deathAt.get(p.id) || 0;
      const k = Math.floor((now - t0) / 60);
      if (k >= A.charFrames(ch, 'Die')) return;
      action = 'Die'; frame = k;
      A.draw(c, 'Bomb/Bubble00', 3 + Math.min(2, Math.floor((now - t0) / 70)), ax, ay - 6);
    } else if (g.phase === 'start') {
      // The last Start frame is the white flash the character pops in with; then it spins.
      const n = A.charFrames(ch, 'Start'), k = Math.floor((now - (this.startShown || (this.startShown = now))) / 110);
      action = 'Start'; frame = k < 2 ? n - 1 : Math.min(n - 2, k - 2);
    } else if (g.phase === 'end' && g.result && !g.result.draw && p.team === g.result.team) {
      action = 'Hurrah'; frame = Math.floor(now / 150) % Math.max(1, A.charFrames(ch, 'Hurrah'));
    } else if (p.state === 'trapped') {
      action = 'Faint'; frame = Math.floor(now / 200) % Math.max(1, A.charFrames(ch, 'Faint'));
    } else if (p.ride) {
      action = 'Ride' + dirName; frame = v.moving ? Math.floor(now / 110) % Math.max(1, A.charFrames(ch, action)) : 0;
    } else {
      action = 'Walk' + dirName;
      frame = v.moving ? 1 + (Math.floor(now / 90) % Math.max(1, A.charFrames(ch, action) - 1)) : 0;
    }
    // Shadow.
    c.fillStyle = 'rgba(0,0,0,0.28)'; c.beginPath(); c.ellipse(v.x, ay - 3, 14, 5, 0, 0, Math.PI * 2); c.fill();
    if (p.ride) {
      const ship = `${RIDES[p.ride]?.ship}-${dirName}`;
      const n = A.frames(ship);
      if (!n || !A.draw(c, ship, v.moving ? [0, 1, 2, 3, 2, 1][Math.floor(now / 100) % 6] % n : 0, ax, ay)) A.draw(c, ITEMS[p.ride]?.sprite || 'Item/Owl', 0, ax, ay + 2);
    }
    const look = this.looks.get(p.id) || {};
    if (look.pet && p.state !== 'dead') this.drawPet(c, p, v, look.pet, now);
    if (!A.drawChar(c, ch, action, frame, ax, ay, team, alpha)) {
      c.fillStyle = TEAMS[team]?.css || '#f44'; c.beginPath(); c.arc(v.x, v.y - 8, 15, 0, Math.PI * 2); c.fill();
    }
    if (p.state === 'trapped') {
      const t0 = this.trapAt.get(p.id) || now;
      const age = now - t0, left = p.stateT / HZ;
      const bf = age < 200 ? Math.floor(age / 70) : left < 1 ? 7 + (Math.floor(now / 120) % 2) : 6;
      // The bubble's pictures carry no alpha of their own; drawn see-through, the character
      // shows inside it, as in the client.
      A.draw(c, 'Bomb/Bubble00', bf, ax, ay - 6, 0.55);
    }
    // A hat from the shop follows the walking frames (four per direction).
    if (look.hat && action.startsWith('Walk')) {
      const hat = `CharDeco/CharDeco_${look.hat}${dirName}`;
      const n = A.frames(hat);
      if (n) A.draw(c, hat, v.moving ? Math.max(0, frame - 1) % n : 0, ax, ay, alpha);
    }
    if (p.curse) A.drawAt(c, 'Item/Skeleton0', 0, v.x - 12, v.y - 70 + Math.sin(now / 150) * 2, 24, 24);
    if (p.shieldT > 0) {
      c.strokeStyle = `rgba(255,240,120,${0.5 + 0.3 * Math.sin(now / 80)})`; c.lineWidth = 3;
      c.beginPath(); c.arc(v.x, v.y - 8, 24, 0, Math.PI * 2); c.stroke();
    }
  }

  // A pet walks a few steps behind its owner along the owner's own path.
  drawPet(c, p, v, pet, now) {
    let t = this.trails.get(p.id);
    if (!t) { t = []; this.trails.set(p.id, t); }
    if (t.length && Math.hypot(t[t.length - 1].x - v.x, t[t.length - 1].y - v.y) > 60) t.length = 0; // teleported (start, reconcile)
    const last = t[t.length - 1];
    if (!last || Math.hypot(last.x - v.x, last.y - v.y) > 1.5) t.push({ x: v.x, y: v.y, dir: v.dir });
    while (t.length > 16) t.shift();
    const at = t.length > 12 ? t[t.length - 13] : t[0];
    const dir = DIR_NAMES[at.dir] || 'Down';
    const moving = t.length > 12 && v.moving;
    const sprite = A.has(`Pet/${pet}_Walking${dir}`) ? `Pet/${pet}_Walking${dir}` : `Pet/${pet}_WalkingDown`;
    const n = A.frames(sprite);
    if (n) A.draw(c, sprite, moving ? Math.floor(now / 110) % n : 0, at.x - TILE / 2 + 8, at.y + TILE / 2 - 1);
  }

  // Words over the map (start, hurry up, the result), centred on (cx, cy) in map pixels.
  drawOverlay(c, now, cx, cy) {
    const g = this.g;
    const word = (sprite, t0, dur = 9e9) => {
      const n = A.frames(sprite);
      if (!n) return false;
      const age = now - t0;
      if (age > dur) return true;
      let total = 0; for (let i = 0; i < n; i++) total += A.size(sprite, i)[0] + 2;
      let x = cx - total / 2;
      for (let i = 0; i < n; i++) {
        const [w, h] = A.size(sprite, i);
        const appear = age - i * 90;
        if (appear > 0) {
          const bounce = appear < 300 ? Math.sin((appear / 300) * Math.PI) * 26 : 0;
          A.drawAt(c, sprite, i, x, cy - h / 2 - bounce);
        }
        x += w + 2;
      }
      return true;
    };
    if (g.phase === 'start') {
      if (!this.startAt) this.startAt = now;
      word('Game/Start', this.startAt);
    }
    if (g.hurry && g.phase === 'play') {
      if (!this.hurryAt) this.hurryAt = now;
      if (now - this.hurryAt < 2500) word('Game/HurryUp', this.hurryAt);
    }
    if (g.phase === 'end' && this.result) {
      const s = this.result === 'win' ? 'Game/Win' : this.result === 'lose' ? 'Game/Lose' : 'Game/Draw';
      if (this.paid && now - this.endAt > 900) text(`+${this.paid.toLocaleString()} 루찌`, cx, cy + 70, { size: 20, bold: true, align: 'center', color: '#ffe23a', shadow: '#5a2a00' });
      if (!word(s, this.endAt)) text(this.result === 'win' ? 'WIN!' : this.result === 'lose' ? 'LOSE' : 'DRAW', cx, cy, { size: 48, bold: true, align: 'center', color: '#ffe23a', shadow: '#5a2a00' });
    }
  }

  // Timer and players at the left, my items and the exit at the right (over the map's top
  // corners when the screen has no margins).
  drawHud(c, now) {
    const g = this.g, { k, x, y, vw } = this.L;
    const left = x - 16, right = vw - (x + WW * k) - 20;
    const lx = left >= 110 ? 8 : x + 6, rx = right >= 110 ? x + WW * k + 12 : x + WW * k - 116;
    const lw = Math.min(left >= 110 ? left : 150, 190), rw = Math.min(right >= 110 ? right : 110, 190);
    const panel = (px, py, w, h) => { c.fillStyle = 'rgba(2, 22, 70, 0.72)'; roundRect(c, px, py, w, h, 9); c.fill(); c.strokeStyle = 'rgba(127, 212, 255, 0.6)'; c.lineWidth = 1.5; c.stroke(); };
    // Timer.
    const secs = Math.max(0, Math.ceil(g.timer / HZ));
    panel(lx, y + 2, lw, 34);
    text('TIME', lx + 10, y + 24, { size: 11, bold: true, color: '#9fd0f5' });
    text(`${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`, lx + lw - 10, y + 27, { size: 20, bold: true, color: g.hurry ? '#ff5a5a' : '#ffe14a', align: 'right', shadow: '#02163f' });
    // Players: portrait, name, kills.
    const rowH = 27, py = y + 42;
    panel(lx, py, lw, g.players.length * rowH + 8);
    g.players.forEach((p, i) => {
      const ry = py + 4 + i * rowH, dead = p.state === 'dead';
      c.save(); c.beginPath(); c.rect(lx + 4, ry, 26, 25); c.clip();
      c.translate(lx + 4, ry); c.scale(0.58, 0.58);
      A.drawChar(c, p.char, dead ? 'PortraitDie' : 'Portrait', dead ? Math.floor(now / 200) % 4 : 0, 0, 0, p.color, dead ? 0.5 : 1);
      c.restore();
      c.fillStyle = TEAMS[p.color]?.css || '#888'; c.fillRect(lx + 33, ry + 8, 6, 10);
      text(p.name, lx + 44, ry + 17, { size: 12, bold: p.id === this.me, color: dead ? '#7a8aa8' : p.id === this.me ? '#ffe95a' : '#fff', maxW: lw - 76 });
      text(p.state === 'trapped' ? '갇힘' : `${p.kills}`, lx + lw - 8, ry + 17, { size: 11, bold: true, color: p.state === 'trapped' ? '#7df' : '#9cf', align: 'right' });
    });
    // Exit, map name, my items.
    ui.begin();
    const hw = (rw - 6) / 2;
    panel(rx, y + 2, hw, 34);
    text('⚙ 설정', rx + hw / 2, y + 24, { size: 13, bold: true, color: '#fff', align: 'center', shadow: '#03306e' });
    if (ui.area('settings', rx, y + 2, hw, 34)) this.openSettings();
    panel(rx + hw + 6, y + 2, hw, 34);
    text('나가기', rx + hw + 6 + hw / 2, y + 24, { size: 13, bold: true, color: '#fff', align: 'center', shadow: '#03306e' });
    if (ui.area('exit', rx + hw + 6, y + 2, hw, 34)) this.app.leaveRoom();
    text(this.map.name, rx + rw / 2, y + 56, { size: 12, bold: true, color: '#cfe8ff', align: 'center', maxW: rw });
    const me = this.myPlayer();
    if (!me) return;
    const items = [['Item/Bomb', me.bombs], ['Item/Potion', me.power], ['Item/Skate', me.speed]];
    if (me.kick) items.push(['Item/Shoe', '✓']);
    if (me.punch) items.push(['Item/Punch', '✓']);
    const per = Math.max(1, Math.min(3, Math.floor(rw / 52)));
    panel(rx, y + 66, rw, Math.ceil(items.length / per) * 36 + 8);
    items.forEach(([sp, n], i) => {
      const ix = rx + 6 + (i % per) * (rw - 12) / per, iy = y + 70 + Math.floor(i / per) * 36;
      const [w, h] = A.size(sp);
      if (w) { const sc = Math.min(1, 28 / Math.max(w, h)); A.drawAt(c, sp, 0, ix, iy + (32 - h * sc) / 2, w * sc, h * sc); }
      text(String(n), ix + 46, iy + 26, { size: 14, bold: true, color: '#fff', align: 'right', shadow: '#03306e' });
    });
  }

  // Big view, laid out like the mobile game: a small player list at the top left, the timer at
  // the top centre, settings and exit at the top right, my items along the bottom, and arrows
  // at the screen's edge pointing to players out of sight.
  drawHudBig(c, now) {
    const g = this.g, { k, x, y, vw, vh } = this.L;
    const panel = (px, py, w, h, a = 0.6) => { c.fillStyle = `rgba(2, 22, 70, ${a})`; roundRect(c, px, py, w, h, 8); c.fill(); c.strokeStyle = 'rgba(127, 212, 255, 0.5)'; c.lineWidth = 1.2; c.stroke(); };
    const top = 6;
    // Timer.
    const secs = Math.max(0, Math.ceil(g.timer / HZ));
    panel(vw / 2 - 46, top, 92, 30, 0.45);
    text(`${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`, vw / 2, top + 22, { size: 19, bold: true, align: 'center', color: g.hurry ? '#ff5a5a' : '#fff', shadow: '#02163f' });
    // Players.
    const rowH = 18, lw = 128;
    panel(6, top, lw, g.players.length * rowH + 6, 0.5);
    g.players.forEach((p, i) => {
      const ry = top + 3 + i * rowH, dead = p.state === 'dead';
      c.fillStyle = TEAMS[p.color]?.css || '#888'; c.fillRect(11, ry + 4, 5, 10);
      text(p.name, 21, ry + 14, { size: 11, bold: p.id === this.me, color: dead ? '#7a8aa8' : p.id === this.me ? '#ffe95a' : '#fff', maxW: lw - 50, shadow: '#000' });
      text(dead ? '-' : p.state === 'trapped' ? '갇힘' : `${p.kills}`, lw, ry + 14, { size: 11, bold: true, color: p.state === 'trapped' ? '#7df' : '#cfe8ff', align: 'right', shadow: '#000' });
    });
    // Settings and exit.
    ui.begin();
    const bw = 58, bh = 28;
    panel(vw - 6 - bw * 2 - 6, top, bw, bh, 0.7);
    text('⚙ 설정', vw - 6 - bw * 1.5 - 6, top + 19, { size: 12, bold: true, align: 'center', color: '#fff' });
    if (ui.area('settings', vw - 6 - bw * 2 - 6, top, bw, bh)) this.openSettings();
    panel(vw - 6 - bw, top, bw, bh, 0.7);
    text('나가기', vw - 6 - bw / 2, top + 19, { size: 12, bold: true, align: 'center', color: '#fff' });
    if (ui.area('exit', vw - 6 - bw, top, bw, bh)) this.app.leaveRoom();
    // Players out of sight: an arrow in their colour at the edge, towards them.
    const pad = 16;
    for (const p of g.players) {
      if (p.id === this.me || p.state === 'dead') continue;
      const v = this.view(p);
      if (this.inBush(v) && p.state === 'normal') continue;
      const sx = x + v.x * k, sy = y + v.y * k;
      if (sx > -10 && sx < vw + 10 && sy > -10 && sy < vh + 10) continue;
      const ex = Math.max(pad, Math.min(vw - pad, sx)), ey = Math.max(pad + 34, Math.min(vh - pad, sy));
      const ang = Math.atan2(sy - ey, sx - ex);
      c.save(); c.translate(ex, ey); c.rotate(ang);
      c.fillStyle = TEAMS[p.color]?.css || '#fff'; c.strokeStyle = '#fff'; c.lineWidth = 2;
      c.beginPath(); c.moveTo(10, 0); c.lineTo(-7, -8); c.lineTo(-7, 8); c.closePath(); c.fill(); c.stroke();
      c.restore();
    }
    // My items, small, at the bottom centre between the controls.
    const me = this.myPlayer();
    if (!me) return;
    const items = [['Item/Bomb', me.bombs], ['Item/Potion', me.power], ['Item/Skate', me.speed]];
    if (me.kick) items.push(['Item/Shoe', '✓']);
    if (me.punch) items.push(['Item/Punch', '✓']);
    const iw = 46, ix0 = vw / 2 - (items.length * iw) / 2, iy = vh - 30;
    panel(ix0 - 4, iy - 2, items.length * iw + 8, 28, 0.55);
    items.forEach(([sp, n], i) => {
      const ix = ix0 + i * iw;
      const [w, h] = A.size(sp);
      if (w) { const sc = Math.min(1, 22 / Math.max(w, h)); A.drawAt(c, sp, 0, ix + 2, iy + (24 - h * sc) / 2, w * sc, h * sc); }
      text(String(n), ix + 40, iy + 18, { size: 13, bold: true, color: '#fff', align: 'right', shadow: '#03306e' });
    });
  }

  leave() { input.enable(false); }
}
