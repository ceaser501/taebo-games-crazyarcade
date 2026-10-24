// The round: PC game screen (map on the left, players and timer on the right). The server's
// snapshots are the truth; this player's character is predicted locally so it answers the
// stick at once, and everyone else is drawn a few ticks in the past, interpolated, so they
// glide smoothly between updates.
import * as A from './assets.js';
import { stage, ui, text, roundRect, W } from './stage.js';
import * as input from './input.js';
import { sfx, playMusic, stopMusic } from './audio.js';
import { COLS, ROWS, TILE, HZ, FLAME, TEAMS, ITEMS, charById } from './shared/const.js';
import { createGame, walk, cellOf, DIR_NAMES } from './shared/sim.js';
import { mapById } from './shared/room.js';

const MX = 20, MY = 40; // map origin on the 800×600 screen
const INTERP = 3; // ticks others are drawn behind the newest snapshot

export class GameScene {
  constructor(app, conn, start, me) {
    Object.assign(this, { app, conn, me });
    this.map = mapById(start.map);
    this.g = createGame({ map: this.map, players: start.players, seed: start.seed, mode: start.mode });
    this.mode = start.mode;
    this.buffers = new Map(this.g.players.map((p) => [p.id, []]));
    this.deathAt = new Map(); this.trapAt = new Map(); this.effects = [];
    this.localTick = 0; this.acc = 0; this.last = performance.now();
    this.hist = []; this.lastSent = { d: -1 }; this.pendingBombs = [];
    this.snapTick = 0; this.snapTime = 0; this.result = null; this.endAt = 0;
    this.floorCanvas = null;
    this.ready = this.load();
    input.enable(true);
    this.off = conn.on ? null : null;
  }

  async load() {
    const t = this.map.theme;
    const chars = [...new Set(this.g.players.map((p) => p.char))];
    await Promise.all([A.loadGroup(`tile_${t}`), A.loadGroup('game'), A.loadBg('game'), ...chars.map((c) => A.loadGroup(`char_${c}`))]);
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
      if (t) A.draw(c, t[0], 0, col * TILE, r * TILE + TILE - 1);
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
      const [id, x, y, dir, moving, state, stateT, bombs, power, speed, needle, shield, shieldT, ride, invT, kills] = row;
      const p = g.players.find((q) => q.id === id);
      if (!p) continue;
      Object.assign(p, { state, stateT, bombs, power, speed, needle, shield, shieldT, ride, invT, kills });
      if (id === this.me) this.reconcile(p, x, y, dir, moving);
      else {
        const b = this.buffers.get(id);
        b.push({ k: m.k, x, y, dir, moving });
        if (b.length > 20) b.shift();
      }
    }
    g.bombs = m.b.map(([id, c, r, t, owner, pass]) => ({ id, c, r, t, owner, pass, power: 1 }));
    this.pendingBombs = this.pendingBombs.filter((pb) => !g.bombs.some((b) => b.c === pb.c && b.r === pb.r) && performance.now() - pb.at < 400);
    if (m.m) for (const [i, ot, bt, it, f] of m.m) {
      g.objs[i] = ot >= 0 ? { t: ot, k: g.tiles[ot].k, breakT: bt } : null;
      g.items[i] = it ? { k: it, fresh: 0 } : null;
      g.flames[i] = f ? { kind: f[0], end: !!f[1], born: f[2], t: Math.max(0, FLAME - (m.k - f[2])) } : null;
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
      case 'pick': if (e.id === this.me) sfx('Itm_ItemEaten', 0.7); break;
      case 'needle': sfx('Itm_Niddle'); break;
      case 'shield': sfx('Itm_ShieldOn'); break;
      case 'unride': sfx('Cha_Release', 0.5); break;
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
    if (item === 'auto') item = p.state === 'trapped' ? 'needle' : 'shield';
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
    input.setCounts({ needle: p.needle, shield: p.shield });
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
      for (const b of g.bombs) if (b.r === r) this.drawBomb(c, b.c, b.r, now, b.t);
      for (const b of this.pendingBombs) if (b.r === r) this.drawBomb(c, b.c, b.r, now, 99);
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

  drawBomb(c, col, r, now, fuse) {
    const n = Math.max(1, A.frames('Bomb/Bomb00'));
    const ax = col * TILE, ay = r * TILE + TILE - 1;
    if (!A.draw(c, 'Bomb/Bomb00', Math.floor(now / 140) % n, ax, ay)) {
      c.fillStyle = '#3ab0ff'; c.beginPath(); c.arc(ax + 20, ay - 18, 15, 0, Math.PI * 2); c.fill();
    }
  }

  // Fire00 (100 frames): 0-3 centre; then for each arm direction k (left, up, right, down)
  // three tip frames (4+k, 8+k, 12+k), ten middle frames (16+k … 52+k) and the fading frames.
  drawFlame(c, f, ax, ay) {
    const age = FLAME - f.t;
    const K = { l: 0, u: 1, r: 2, d: 3 };
    let frame;
    if (f.kind === 'c') frame = Math.floor(age / 2) % 4;
    else {
      const k = K[f.kind];
      if (age < FLAME - 6) {
        frame = f.end ? 4 + k + 4 * (Math.floor(age / 2) % 3) : 16 + k + 4 * (Math.floor(age / 2) % 10);
      } else frame = 56 + k + 4 * Math.min(10, (age - (FLAME - 6)) * 2);
    }
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
    if (p.ride) A.draw(c, p.ride === 'turtle' ? 'Item/Turtle1' : 'Item/Owl', 0, ax, ay + 2);
    if (!A.drawChar(c, ch, action, frame, ax, ay, team, alpha)) {
      c.fillStyle = TEAMS[team]?.css || '#f44'; c.beginPath(); c.arc(v.x, v.y - 8, 15, 0, Math.PI * 2); c.fill();
    }
    if (p.state === 'trapped') {
      const t0 = this.trapAt.get(p.id) || now;
      const age = now - t0, left = p.stateT / HZ;
      const bf = age < 200 ? Math.floor(age / 70) : left < 1 ? 7 + (Math.floor(now / 120) % 2) : 6;
      A.draw(c, 'Bomb/Bubble00', bf, ax, ay - 6, 0.92);
    }
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
      const items = [['Item/Niddle', me.needle], ['Item/Shield', me.shield], ['Item/Bomb', me.bombs], ['Item/Potion', me.power], ['Item/Skate', me.speed]];
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
