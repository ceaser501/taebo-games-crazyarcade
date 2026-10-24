// The round: PC game screen (map on the left, players and timer on the right). The server's
// snapshots are the truth; this player's character is predicted locally so it answers the
// stick at once, and everyone else is drawn a few ticks in the past, interpolated, so they
// glide smoothly between updates.
import * as A from './assets.js';
import { stage, ui, text, roundRect, W } from './stage.js';
import * as input from './input.js';
import { sfx, playMusic, stopMusic } from './audio.js';
import { COLS, ROWS, TILE, HZ, FLAME, TEAMS, ITEMS, RIDES, PUNCH_TICKS, charById } from './shared/const.js';
import { createGame, walk, cellOf, DIR_NAMES, DIRS } from './shared/sim.js';
import { mapById } from './shared/room.js';

const MX = 20, MY = 40; // map origin on the 800×600 screen
const INTERP = 3; // ticks others are drawn behind the newest snapshot

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
    this.snapTick = 0; this.snapTime = 0; this.result = null; this.endAt = 0;
    this.floorCanvas = null;
    this.ready = this.load();
    input.enable(true);
    this.off = conn.on ? null : null;
  }

  async load() {
    const chars = [...new Set(this.g.players.map((p) => p.char))];
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
    if (m.m) for (const [i, ot, bt, it, f] of m.m) {
      g.objs[i] = ot >= 0 ? { t: ot, k: g.tiles[ot].k, breakT: bt } : null;
      g.items[i] = it ? { k: it, fresh: 0 } : null;
      g.flames[i] = f ? { kind: f[0], end: !!f[1], born: f[2], d: f[3], t: Math.max(0, FLAME - (m.k - f[2])) } : null;
    }
    for (const e of m.ev || []) this.event(e);
  }

  // Our own character: compare the server's position with where we predicted we were one
  // round trip ago and fold the difference in gently (or at once if it is large).
  reconcile(p, x, y, dir, moving) {
    if (p.state === 'dead' || this.g.phase !== 'play') { p.x = x; p.y = y; p.dir = dir; p.moving = !!moving; this.hist = []; return; }
    const lag = Math.round(((this.conn.rtt || 0) / 1000) * HZ) + 1;
    const h = this.hist.find((e) => e.t === this.localTick - lag) || this.hist[this.hist.length - 1];
    if (!h) { p.x = x; p.y = y; return; }
    const dx = x - h.x, dy = y - h.y;
    const big = Math.hypot(dx, dy) > 34;
    const k = big ? 1 : 0.25;
    p.x += dx * k; p.y += dy * k;
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
      case 'punch': sfx('Cha_ThrowBomb', 0.8); break;
      case 'dart': sfx('Itm_ThrowDart', 0.8); this.darts.push({ ...e, at: performance.now() }); break;
      case 'hurry': sfx('Ntc_HurryUp'); break;
      case 'end': {
        const mine = g.players.find((p) => p.id === this.me);
        const won = e.team !== null && mine && mine.team === e.team;
        this.result = e.team === null ? 'draw' : won ? 'win' : mine ? 'lose' : 'win';
        this.endAt = performance.now();
        stopMusic();
        playMusic(this.result === 'win' ? 'Ntc_Win' : this.result === 'lose' ? 'Ntc_Lose' : 'Ntc_Draw');
        break;
      }
    }
  }

  // Fixed 30 Hz steps for input and prediction.
  update(now) {
    this.acc += Math.min(250, now - this.last); this.last = now;
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
    if (send) { this.conn.send(msg); this.lastSent = { d: inp.dir, at: this.localTick }; }
    if (g.phase === 'play' && p.state !== 'dead') walk(g, p, inp.dir);
    else p.moving = false;
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
    this.pendingBombs.push({ c, r, at: performance.now() });
  }

  // Where another player is drawn: INTERP ticks behind the newest snapshot, interpolated.
  view(p) {
    if (p.id === this.me) return { x: p.x, y: p.y, dir: p.dir, moving: p.moving };
    const b = this.buffers.get(p.id);
    if (!b || !b.length) return { x: p.x, y: p.y, dir: p.dir, moving: false };
    const est = this.snapTick + ((performance.now() - this.snapTime) / 1000) * HZ;
    const t = est - INTERP;
    let i = b.length - 1;
    while (i > 0 && b[i - 1].k > t) i--;
    const a = b[Math.max(0, i - 1)], c = b[i];
    if (t >= c.k || a === c) return { x: c.x, y: c.y, dir: c.dir, moving: !!c.moving };
    const f = Math.max(0, Math.min(1, (t - a.k) / (c.k - a.k || 1)));
    return { x: a.x + (c.x - a.x) * f, y: a.y + (c.y - a.y) * f, dir: c.dir, moving: !!c.moving };
  }

  draw(now) {
    this.update(now);
    const c = stage.begin();
    const bgimg = A.bg('game');
    if (bgimg) c.drawImage(bgimg, 0, 0); else { c.fillStyle = '#0b5fb8'; c.fillRect(0, 0, 800, 600); }
    c.save();
    c.beginPath(); c.rect(MX, MY, COLS * TILE, ROWS * TILE); c.clip();
    c.translate(MX, MY);
    if (this.floorCanvas) c.drawImage(this.floorCanvas, 0, 0);
    this.drawWorld(c, now);
    c.restore();
    this.drawOverlay(c, now);
    this.drawPanel(c, now);
    ui.begin();
    if (ui.area('exit', 640, 558, 156, 38)) this.app.leaveRoom();
    text('나가기', 718, 583, { size: 15, bold: true, color: '#fff', align: 'center', shadow: '#03306e' });
    if (this.g.phase === 'end' && this.app.isHost() && performance.now() - this.endAt > 1500) {
      // The host can go back early; the server also returns everyone after a few seconds.
    }
    ui.end();
    input.draw();
  }

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
        const name = tile[0], ax = col * TILE, ay = r * TILE + TILE - 1;
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
    const sprite = 'Bomb/Bomb00';
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
    const age = Math.min(18, FLAME - f.t);
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
    if (!A.drawChar(c, ch, action, frame, ax, ay, team, alpha)) {
      c.fillStyle = TEAMS[team]?.css || '#f44'; c.beginPath(); c.arc(v.x, v.y - 8, 15, 0, Math.PI * 2); c.fill();
    }
    if (p.state === 'trapped') {
      const t0 = this.trapAt.get(p.id) || now;
      const age = now - t0, left = p.stateT / HZ;
      const bf = age < 200 ? Math.floor(age / 70) : left < 1 ? 7 + (Math.floor(now / 120) % 2) : 6;
      A.draw(c, 'Bomb/Bubble00', bf, ax, ay - 6, 0.92);
    }
    if (p.curse) A.drawAt(c, 'Item/Skeleton0', 0, v.x - 12, v.y - 70 + Math.sin(now / 150) * 2, 24, 24);
    if (p.shieldT > 0) {
      c.strokeStyle = `rgba(255,240,120,${0.5 + 0.3 * Math.sin(now / 80)})`; c.lineWidth = 3;
      c.beginPath(); c.arc(v.x, v.y - 8, 24, 0, Math.PI * 2); c.stroke();
    }
  }

  drawOverlay(c, now) {
    const g = this.g;
    const cx = MX + (COLS * TILE) / 2, cy = MY + (ROWS * TILE) / 2;
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
      if (!word(s, this.endAt)) text(this.result === 'win' ? 'WIN!' : this.result === 'lose' ? 'LOSE' : 'DRAW', cx, cy, { size: 48, bold: true, align: 'center', color: '#ffe23a', shadow: '#5a2a00' });
    }
  }

  drawPanel(c, now) {
    const g = this.g;
    // Timer as the client shows it: "TIMER m:ss".
    const secs = Math.max(0, Math.ceil(g.timer / HZ));
    // The background already has the colon of "TIMER  :"; minutes go left of it, seconds right.
    const tcol = g.hurry ? '#ff5050' : '#ffe14a';
    text(String(Math.floor(secs / 60)), 737, 88, { size: 15, bold: true, color: tcol, align: 'right', shadow: '#0a2a5a' });
    text(String(secs % 60).padStart(2, '0'), 745, 88, { size: 15, bold: true, color: tcol, align: 'left', shadow: '#0a2a5a' });
    text(this.map.name, 58, 18, { size: 12, bold: true, color: '#fff', align: 'center', shadow: '#03306e' });
    text(this.app.roomTitle || '', 717, 49, { size: 11, color: '#cfe8ff', align: 'center', maxW: 150 });
    g.players.forEach((p, i) => {
      const y = 101 + 43 * i;
      const dead = p.state === 'dead';
      c.save(); c.beginPath(); c.rect(658, y + 2, 43, 38); c.clip();
      A.drawChar(c, p.char, dead ? 'PortraitDie' : 'Portrait', dead ? Math.floor(now / 200) % 4 : 0, 658, y + 4, p.color);
      c.restore();
      c.fillStyle = TEAMS[p.color]?.css || '#888'; c.fillRect(709, y + 4, 14, 14);
      text(p.name, 753, y + 16, { size: 11, color: dead ? '#8aa' : '#fff', align: 'center', maxW: 44 });
      if (p.state === 'trapped') text('!', 716, y + 32, { size: 12, bold: true, color: '#7df', align: 'center' });
      text(`${p.kills}`, 753, y + 33, { size: 10, color: '#9cf', align: 'center' });
    });
    const me = this.myPlayer();
    if (me) {
      const items = [['Item/Niddle', me.needle], ['Item/Shield', me.shield], ['Item/Dart', me.dart || 0], ['Item/Bomb', me.bombs], ['Item/Potion', me.power], ['Item/Skate', me.speed]];

      // Kept powers (shoe, punch) as small marks beside the ITEM label.
      [['Item/Shoe', me.kick], ['Item/Punch', me.punch]].filter(([, on]) => on).forEach(([sp], k) => A.drawAt(c, sp, 0, 712 + k * 24, 448, 22, 22));
      items.forEach(([s, n], k) => {
        const x = 656 + (k % 3) * 44, y = 472 + Math.floor(k / 3) * 38;
        const [w, h] = A.size(s);
        if (w) { const sc = Math.min(1, 30 / Math.max(w, h)); c.drawImage(A.frameOf(s, 0).img, A.frameOf(s, 0).sx, A.frameOf(s, 0).sy, w, h, x, y, w * sc, h * sc); }
        text(String(n), x + 36, y + 30, { size: 12, bold: true, color: '#fff', align: 'right', shadow: '#03306e' });
      });
    }
  }

  leave() { input.enable(false); }
}
