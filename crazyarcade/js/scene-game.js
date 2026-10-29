// The round: PC game screen (map on the left, players and timer on the right). The server's
// snapshots are the truth; this player's character is predicted locally so it answers the
// stick at once, and everyone else is drawn a few ticks in the past, interpolated, so they
// glide smoothly between updates.
import * as A from './assets.js';
import { stage, ui, text, roundRect, W, FONT } from './stage.js';
import * as input from './input.js';
import { sfx, playMusic, stopMusic } from './audio.js';
import { COLS, ROWS, TILE, HZ, TEAMS, ITEMS, RIDES, PUNCH_TICKS, charById } from './shared/const.js';
import { createGame, walk, carry, cellOf, DIR_NAMES, DIRS, PUSH_SLIDE, punchTarget, sideScores, scoreOf, KILL_POINTS, DEATH_POINTS } from './shared/sim.js';
import { mapById } from './shared/room.js';
import * as Wallet from './wallet.js';
import { viewMode, showSettings, settingsShown } from './settings.js';
import * as Account from './account.js';
import { showShop, shopShown } from './shop.js';
import { drawRank } from './rank.js';
import * as Chat from './chat.js';
import { fanfareSound } from './fanfare.js';

const WW = COLS * TILE, WH = ROWS * TILE; // the map in world pixels (600×520)
const INTERP = 4; // ticks others are drawn behind the server clock (smooths uneven arrival)
const HORROR = /^(Tomb|Cemetery|DarkCastle)/i, DARK_SECONDS = 60; // maps that go dark near the end

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
    this.g = createGame({ map: this.map, players: start.players, seed: start.seed, mode: start.mode, rule: start.rule });
    this.mode = start.mode;
    this.buffers = new Map(this.g.players.map((p) => [p.id, []]));
    this.deathAt = new Map(); this.trapAt = new Map(); this.freeAt = new Map(); this.mountAt = new Map(); this.effects = [];
    this.localTick = 0; this.acc = 0; this.last = performance.now();
    this.hist = []; this.lastSent = { d: -1 }; this.pendingBombs = []; this.darts = [];
    this.snapTick = 0; this.snapTime = 0; this.clock = 0; this.clockSet = false; this.result = null; this.endAt = 0;
    this.floorCanvas = null;
    // Shop decorations each player wears: { hat, bomb, pet } by player id; pets trail behind.
    this.looks = new Map(start.players.map((p) => [p.id, p.look || {}]));
    this.levels = new Map(start.players.map((p) => [p.id, p.lv || 0])); // ranks of signed-in players
    this.trails = new Map();
    this.ready = this.load();
    input.enable(true);
    this.off = conn.on ? null : null;
    this.chatKeys();
  }

  // Chat in the round. With a keyboard, Enter opens a line to type under the list of players
  // and Enter sends it; the arrow keys keep moving the character meanwhile (input.js), and the
  // other game keys type. On a touch screen the list can be tapped to type once out of the round.
  chatKeys() {
    const form = document.getElementById('game-chat'), box = document.getElementById('game-chat-input');
    this.chatInput = box;
    const close = () => { form.hidden = true; box.value = ''; box.blur(); };
    this.closeChat = close;
    form.onsubmit = (e) => e.preventDefault();
    box.onkeydown = (e) => {
      if (e.isComposing || e.keyCode === 229) return; // a Korean syllable still being typed
      if (e.key === 'Enter') { e.preventDefault(); const t = box.value.trim(); if (t) this.app.send({ t: 'chat', text: t }); close(); }
      if (e.key === 'Escape') { e.preventDefault(); close(); }
    };
    box.onblur = () => { if (!box.value.trim()) form.hidden = true; };
    this.onKey = (e) => {
      if (e.key === 'Tab' && this.g.rule === 'duel' && e.target.tagName !== 'INPUT') { e.preventDefault(); if (!e.repeat) this.toggleBoard(); return; }
      if (e.key !== 'Enter' || e.target.tagName === 'INPUT' || input.touchMode.on || settingsShown() || shopShown()) return;
      e.preventDefault(); this.openChat();
    };
    window.addEventListener('keydown', this.onKey);
  }
  openChat() {
    if (!this.chatRect) return;
    const form = document.getElementById('game-chat');
    form.hidden = false;
    this.placeChat();
    this.chatInput.focus();
  }
  // The typing line sits at the bottom of the chat list (canvas coordinates are CSS pixels).
  placeChat() {
    const form = document.getElementById('game-chat');
    if (form.hidden || !this.chatRect) return;
    const r = stage.canvas.getBoundingClientRect(), { x, y, w, h } = this.chatRect;
    Object.assign(form.style, { left: `${r.left + x + 4}px`, top: `${r.top + y + h - 32}px`, width: `${w - 8}px` });
  }

  // The chat list: newest line at the bottom, older ones moving up and out of the panel.
  drawChat(c, x, y, w, h, { size = 12, alpha = 0.72, hint = true } = {}) {
    this.chatRect = { x, y, w, h };
    const typing = !document.getElementById('game-chat').hidden;
    c.fillStyle = `rgba(2, 22, 70, ${alpha})`; roundRect(c, x, y, w, h, 9); c.fill();
    c.strokeStyle = 'rgba(127, 212, 255, 0.5)'; c.lineWidth = 1.2; c.stroke();
    const lh = Math.round(size * 1.4), bottom = y + h - (typing ? 36 : hint ? 20 : 6);
    c.save(); c.beginPath(); c.rect(x + 2, y + 2, w - 4, bottom - y); c.clip();
    c.font = `bold ${size}px ${FONT}`;
    let ly = bottom;
    for (let i = Chat.lines.length - 1; i >= 0 && ly > y; i--) {
      const l = Chat.lines[i];
      const rows = wrap(c, l.name ? `${l.name}: ${l.text}` : l.text, w - 14, size);
      for (let j = rows.length - 1; j >= 0 && ly > y; j--, ly -= lh) {
        const row = rows[j];
        if (j === 0 && l.name) {
          text(`${l.name}:`, x + 7, ly, { size, bold: true, color: '#ffe95a', shadow: '#02163f' });
          c.font = `bold ${size}px ${FONT}`;
          text(row.slice(l.name.length + 1), x + 7 + c.measureText(`${l.name}:`).width, ly, { size, color: '#fff', shadow: '#02163f' });
        } else text(row, x + 7, ly, { size, bold: !l.name, color: l.name ? '#fff' : '#9fe0ff', shadow: '#02163f' });
      }
    }
    c.restore();
    if (!typing && hint) text(input.touchMode.on ? '눌러서 채팅' : 'Enter 키로 채팅', x + w / 2, y + h - 6, { size: 10, bold: true, color: 'rgba(159, 208, 245, 0.75)', align: 'center' });
    this.placeChat();
  }

  async load() {
    const chars = [...new Set(this.g.players.map((p) => p.char))];
    Wallet.loadLook({}).then(() => Promise.all([...this.looks.values()].map((l) => Wallet.loadLook(l))));
    await Promise.all([...this.map.sets.map((t) => A.loadGroup(`tile_${t}`)), A.loadGroup('game'), A.loadGroup('rank'), A.loadBg('game'), ...chars.map((c) => A.loadGroup(`char_${c}`))]);
    this.buildFloor();
    this.loaded = true;
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
    A.toBitmap(cv, (b) => { if (this.floorCanvas === cv) this.floorCanvas = b; });
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
        dart, kick, punch, curse, curseT, lucci, deaths, respawnT] = row;
      const p = g.players.find((q) => q.id === id);
      if (!p) continue;
      Object.assign(p, { state, stateT, bombs, power, speed, needle, shield, shieldT, ride, invT, kills,
        dart, kick: !!kick, punch: !!punch, curse, curseT, lucci, deaths: deaths || 0, respawnT: respawnT || 0 });
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
      if (!(g.objs[i] && g.objs[i].part != null && g.objs[i].t === ot)) g.objs[i] = ot >= 0 ? { t: ot, k: g.tiles[ot].k, breakT: bt, push: !!g.tiles[ot].push, sl: sl ? { d: sl[0], at: sl[1] } : null } : null;
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
      case 'go': break; // the start jingle already played as the round opened
      case 'place': sfx('Cha_BombIgnite', 0.7); break;
      case 'boom': sfx('Cha_BombExplode', 0.6); break;
      case 'trap': this.trapAt.set(e.id, performance.now()); sfx('Cha_LockedIn'); break;
      case 'pop': this.deathAt.set(e.id, performance.now()); sfx('Cha_Die'); break;
      case 'free': this.freeAt.set(e.id, performance.now()); sfx('Cha_Release'); break;
      case 'respawn': this.trails.delete(e.id); if (e.id === this.me) { this.hist = []; sfx('Cha_Release', 0.7); } break;
      case 'pick':
        if (ITEMS[e.item]?.ride) this.mountAt.set(e.id, performance.now());
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
        // Lucci, record and experience: online the room server counts them and says so ('exp'),
        // a practice round is reported to the account, a guest's is counted here.
        if (mine && !this.counted) {
          this.counted = true;
          const exp = Account.exp();
          Wallet.roundDone(this.result, mine.kills, mine.lucci, this.app.practiceMode).then((n) => {
            if (n != null) this.paid = n;
            if (Account.exp() > exp) this.expGained = Account.exp() - exp;
          });
        }
        stopMusic();
        playMusic(this.result === 'win' ? 'Ntc_Win' : this.result === 'lose' ? 'Ntc_Lose' : 'Ntc_Draw');
        // A win after three or more losses in a row: the fanfare, once.
        if (mine && comeback(this.result)) setTimeout(fanfareSound, 600);
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
    if (this.board && inp.dir && this.g.phase === 'play') this.board = false; // moving closes the board
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
    if (p.state !== 'normal' || this.g.phase !== 'play' || punchTarget(this.g, p)) return; // a throw, not a new balloon
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
  // the right one, and the touch controls low in both margins. 'big': the same, the map 1.2
  // times larger, the camera following me up and down. 'fill' (as the mobile game): the map
  // fills the whole screen, the camera follows me and everything else sits over it.
  layout() {
    const vw = stage.cssW, vh = stage.cssH, mode = viewMode();
    if (mode === 'fill') {
      const k = Math.max(vw / WW, vh / WH);
      this.L = { k, x: 0, y: 0, vw, vh, mode };
      input.setSides(0);
      return;
    }
    let k = (vh - 8) / WH;
    const side = (vw - WW * k) / 2;
    if (side < 130) k = Math.max((vh - 8) / WH * 0.72, Math.min((vh - 8) / WH, (vw - 260) / WW));
    if (mode === 'big') k *= 1.2;
    if (WW * k > vw) k = vw / WW;
    this.L = { k, x: Math.round((vw - WW * k) / 2), y: Math.round((vh - WH * k) / 2), vw, vh, mode };
    input.setSides(this.L.x);
  }

  // Big and fill views: the map's offset on screen, centred on me (or where the camera last was)
  // and kept inside the map's edges; a map narrower than the screen stays centred across.
  camera() {
    const { k, vw, vh } = this.L, me = this.myPlayer();
    if (me && me.state !== 'dead') { const v = this.view(me); this.cam = { x: v.x, y: v.y }; }
    const at = this.cam || { x: WW / 2, y: WH / 2 };
    const clamp = (v, lo) => Math.round(Math.min(0, Math.max(lo, v)));
    this.L.x = WW * k > vw ? clamp(vw / 2 - at.x * k, vw - WW * k) : Math.round((vw - WW * k) / 2);
    this.L.y = WH * k > vh ? clamp(vh / 2 - at.y * k, vh - WH * k) : Math.round((vh - WH * k) / 2);
  }

  draw(now) {
    this.update(now);
    if (!this.L || this.L.vw !== stage.cssW || this.L.vh !== stage.cssH || this.L.mode !== viewMode()) this.layout();
    const fill = this.L.mode === 'fill';
    if (this.L.mode !== 'full') this.camera();
    const { k, x, y, vw, vh } = this.L;
    const c = stage.begin();
    if (fill) { c.fillStyle = '#04163f'; c.fillRect(0, 0, vw, vh); } else {
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
    // Until the map's pictures are in, nothing half-drawn: blocks would look like open ground.
    if (this.loaded) { this.drawWorld(c, now); this.drawDark(c, now); }
    else { c.fillStyle = '#04163f'; c.fillRect(0, 0, WW, WH); text('맵 불러오는 중…', WW / 2, WH / 2, { size: 22, bold: true, align: 'center', color: '#cfe8ff' }); }
    this.drawOverlay(c, now, Math.min(WW, Math.max(0, (vw / 2 - x) / k)), Math.min(WH, Math.max(0, (vh / 2 - y) / k)));
    c.restore();
    if (fill) this.drawHudFill(c, now); else this.drawHud(c, now);
    this.drawOutButton(c, now);
    // 무한 결투: the board on demand, and by itself once the round is over.
    if (this.g.rule === 'duel' && (this.board || (this.g.phase === 'end' && now - this.endAt > 1800))) this.drawBoard(c, now);
    if (this.L.mode === 'big' && !this.darkNow()) this.drawOffscreen(c, x, Math.max(0, y), x + WW * k, Math.min(vh, y + WH * k));
    ui.end();
    input.draw();
  }

  // Out of the round while it goes on: a button in the middle of the map opens the shop over it,
  // to look at the decorations until the round ends.
  drawOutButton(c, now) {
    const me = this.myPlayer();
    if (!me || me.state !== 'dead' || this.g.phase !== 'play' || this.g.rule === 'duel' || shopShown() || now - (this.deathAt.get(me.id) || 0) < 1500) return;
    const { k, x, y, vw, vh } = this.L;
    const cx = Math.min(vw / 2, x + (WW * k) / 2), cy = Math.min(vh - 40, y + WH * k - 46);
    const w = 190, h = 42;
    c.fillStyle = 'rgba(2, 22, 70, 0.85)'; roundRect(c, cx - w / 2, cy - h / 2, w, h, 21); c.fill();
    c.strokeStyle = '#ffe95a'; c.lineWidth = 2; c.stroke();
    text('🛍 상점 구경하기', cx, cy + 6, { size: 16, bold: true, align: 'center', color: '#ffe95a' });
    if (ui.area('outshop', cx - w / 2, cy - h / 2, w, h)) { sfx('Bt_c_Pop', 0.6); showShop(this.app, () => {}, true); }
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
        if (!o || o.part != null) continue;
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
    // What a player just said, in a bubble over their head for a few seconds.
    for (const { p, v } of views) {
      if (p.state === 'dead' || this.inBush(v) && p.id !== this.me) continue;
      const l = Chat.bubbleFor(p.id, now);
      if (!l) continue;
      c.font = `bold 12px ${FONT}`;
      const rows = wrap(c, l.text, 130, 12).slice(0, 3);
      const bw = Math.max(...rows.map((r) => c.measureText(r).width)) + 14, bh = rows.length * 15 + 8;
      // Over the head, or under the feet when the player is at the map's top edge.
      const below = v.y - 72 - bh < 2;
      const bx = Math.max(2, Math.min(WW - bw - 2, v.x - bw / 2)), by = below ? v.y + 10 : v.y - 72 - bh;
      const edge = below ? by : by + bh, tip = below ? by - 7 : by + bh + 7;
      c.globalAlpha = Math.min(1, (Chat.BUBBLE_MS - (now - l.at)) / 300);
      c.fillStyle = '#fff'; c.strokeStyle = '#1a3a7a'; c.lineWidth = 1.5;
      roundRect(c, bx, by, bw, bh, 7); c.fill(); c.stroke();
      c.beginPath(); c.moveTo(v.x - 5, edge); c.lineTo(v.x, tip); c.lineTo(v.x + 5, edge); c.closePath(); c.fill();
      c.beginPath(); c.moveTo(v.x - 5, edge); c.lineTo(v.x, tip); c.lineTo(v.x + 5, edge); c.stroke();
      rows.forEach((r, i) => text(r, bx + 7, by + 16 + i * 15, { size: 12, bold: true, color: '#102040' }));
      c.globalAlpha = 1;
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
    // Frames and their timing come from the client's own animation table (A.animFrame); the
    // even timings after ?? are only for a client without it.
    const anim = (state, ms, end, fallback) => { const f = A.animFrame(ch, state, ms, end); return f ?? fallback; };
    const freedAt = this.freeAt.get(p.id), mountAt = this.mountAt.get(p.id);
    if (p.state === 'dead') {
      // Popped: the bubble bursts (ExpKill) while the character jumps out and blinks away.
      const ms = now - (this.deathAt.get(p.id) || 0);
      frame = anim('Die', ms, 'stop', Math.floor(ms / 60) < A.charFrames(ch, 'Die') ? Math.floor(ms / 60) : -1);
      if (frame < 0) return;
      action = 'Die';
      const bf = A.animFrame('Bubble', 'ExpKill', ms, 'stop') ?? (ms < 210 ? 3 + Math.floor(ms / 70) : -1);
      if (bf >= 0) A.draw(c, 'Bomb/Bubble00', bf, ax, ay - 6, 0.55);
    } else if (g.phase === 'start') {
      const ms = now - (this.startShown || (this.startShown = now));
      action = 'Start'; frame = anim('Start', ms, 'hold', Math.min(A.charFrames(ch, 'Start') - 1, Math.floor(ms / 110)));
    } else if (g.phase === 'end' && g.result && !g.result.draw && p.team === g.result.team) {
      action = 'Hurrah'; frame = anim('Hurrah', now - this.endAt, 'loop', Math.floor(now / 150) % Math.max(1, A.charFrames(ch, 'Hurrah')));
    } else if (p.state === 'trapped') {
      // Locked in: the client holds the first Die frame inside the bubble.
      action = 'Die'; frame = anim('Locked In', now - (this.trapAt.get(p.id) || now), 'hold', 0);
    } else if (freedAt && now - freedAt < 540) {
      // Freed by a teammate: a short cheer while the bubble bursts open (ExpLive).
      action = 'Hurrah'; frame = anim('Release', now - freedAt, 'hold', 0);
    } else if (p.ride && mountAt && now - mountAt < 270) {
      action = 'SlideRide'; frame = anim(`Slide Ride ${dirName}`, now - mountAt, 'hold', 0);
    } else if (p.ride) {
      action = 'Ride' + dirName;
      frame = v.moving ? anim(`Ride ${dirName}`, now, 'loop', Math.floor(now / 110) % Math.max(1, A.charFrames(ch, action))) : 0;
    } else {
      action = 'Walk' + dirName;
      frame = v.moving ? anim(`Walk ${dirName}`, now, 'loop', 1 + (Math.floor(now / 90) % Math.max(1, A.charFrames(ch, action) - 1))) : 0;
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
    if (p.state === 'trapped' || (freedAt && now - freedAt < 400)) {
      // The bubble closes (Lock: 0, 1, 2, then 6 held) and on rescue bursts open (ExpLive). Its
      // pictures carry no alpha of their own; drawn see-through, the character shows inside it.
      const bf = p.state === 'trapped'
        ? A.animFrame('Bubble', 'Lock', now - (this.trapAt.get(p.id) || now), 'hold') ?? 6
        : A.animFrame('Bubble', 'ExpLive', now - freedAt, 'stop') ?? -1;
      if (bf >= 0) A.draw(c, 'Bomb/Bubble00', bf, ax, ay - 6, 0.55);
    }
    // A hat from the shop, facing the same way, playing its own animation.
    if (look.hat && p.state === 'normal') {
      const hat = `CharDeco/CharDeco_${look.hat}${action.startsWith('Walk') || action.startsWith('Ride') ? dirName : 'Down'}`;
      if (A.frames(hat)) A.draw(c, hat, A.decoFrame(hat, now), ax, ay, alpha);
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
    this.drawRespawn(c, cx, cy);
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
    if (g.phase === 'end' && this.result && !(g.rule === 'duel' && now - this.endAt > 1800)) {
      const s = this.result === 'win' ? 'Game/Win' : this.result === 'lose' ? 'Game/Lose' : 'Game/Draw';
      if (this.paid && now - this.endAt > 900) text(`+${this.paid.toLocaleString()} 루찌`, cx, cy + 70, { size: 20, bold: true, align: 'center', color: '#ffe23a', shadow: '#5a2a00' });
      if (this.expGained && now - this.endAt > 1200) text(`+${this.expGained} 경험치`, cx, cy + 96, { size: 18, bold: true, align: 'center', color: '#8ff0ff', shadow: '#02306b' });
      if (!word(s, this.endAt)) text(this.result === 'win' ? 'WIN!' : this.result === 'lose' ? 'LOSE' : 'DRAW', cx, cy, { size: 48, bold: true, align: 'center', color: '#ffe23a', shadow: '#5a2a00' });
    }
  }

  // Timer and players at the left, my items and the exit at the right (over the map's top
  // corners when the screen has no margins).
  drawHud(c, now) {
    const g = this.g, { k, x, vw } = this.L, y = Math.max(4, this.L.y);
    const left = x - 16, right = vw - (x + WW * k) - 20;
    const lx = left >= 110 ? 8 : x + 6, rx = right >= 110 ? x + WW * k + 12 : x + WW * k - 116;
    const lw = Math.min(left >= 110 ? left : 150, 190), rw = Math.min(right >= 110 ? right : 110, 190);
    const panel = (px, py, w, h) => { c.fillStyle = 'rgba(2, 22, 70, 0.72)'; roundRect(c, px, py, w, h, 9); c.fill(); c.strokeStyle = 'rgba(127, 212, 255, 0.6)'; c.lineWidth = 1.5; c.stroke(); };
    // Timer.
    const secs = Math.max(0, Math.ceil(g.timer / HZ));
    panel(lx, y + 2, lw, 34);
    text('TIME', lx + 10, y + 24, { size: 11, bold: true, color: '#9fd0f5' });
    text(`${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`, lx + lw - 10, y + 27, { size: 20, bold: true, color: g.hurry ? '#ff5a5a' : '#ffe14a', align: 'right', shadow: '#02163f' });
    // 무한 결투: the points so far (team against team, or my place in solo play).
    const duel = g.rule === 'duel';
    if (duel) this.drawDuelScore(c, lx, y + 40, lw, panel);
    // Players: portrait, name, kills (무한 결투: kills/deaths).
    const rowH = 27, py = y + (duel ? 76 : 42);
    panel(lx, py, lw, g.players.length * rowH + 8);
    g.players.forEach((p, i) => {
      const ry = py + 4 + i * rowH, dead = p.state === 'dead';
      c.save(); c.beginPath(); c.rect(lx + 4, ry, 26, 25); c.clip();
      c.translate(lx + 4, ry); c.scale(0.58, 0.58);
      A.drawChar(c, p.char, dead ? 'PortraitDie' : 'Portrait', dead ? Math.floor(now / 200) % 4 : 0, 0, 0, p.color, dead ? 0.5 : 1);
      c.restore();
      c.fillStyle = TEAMS[p.color]?.css || '#888'; c.fillRect(lx + 33, ry + 8, 6, 10);
      const lv = this.levels.get(p.id), nx = lv ? lx + 62 : lx + 44;
      if (lv) drawRank(c, lv, lx + 43, ry + 5);
      text(p.name, nx, ry + 17, { size: 12, bold: p.id === this.me, color: dead ? '#7a8aa8' : p.id === this.me ? '#ffe95a' : '#fff', maxW: lw - (nx - lx) - 32 });
      const kd = duel ? `${p.kills}/${p.deaths || 0}` : `${p.kills}`;
      text(p.state === 'trapped' ? '갇힘' : duel && dead ? `부활 ${Math.max(1, Math.ceil((p.respawnT || 0) / HZ))}` : kd, lx + lw - 8, ry + 17, { size: 11, bold: true, color: p.state === 'trapped' ? '#7df' : duel && dead ? '#ffb070' : '#9cf', align: 'right' });
    });
    // Chat under the players, down to the screen's bottom (above the stick on a touch screen).
    ui.begin();
    const ct = py + g.players.length * rowH + 16, side = left >= 110;
    const cb = input.touchMode.on ? Math.min(this.L.vh * 0.58, ct + 130) : side ? this.L.vh - 10 : Math.min(this.L.vh - 10, ct + 150);
    if (cb - ct > 50) this.chatArea(c, lx, ct, lw, cb - ct, { size: input.touchMode.on ? 12 : 13 });
    else this.chatRect = null;
    // Exit, map name, my items.
    const hw = (rw - 6) / 2;
    panel(rx, y + 2, hw, 34);
    text('⚙ 설정', rx + hw / 2, y + 24, { size: 13, bold: true, color: '#fff', align: 'center', shadow: '#03306e' });
    if (ui.area('settings', rx, y + 2, hw, 34)) this.openSettings();
    panel(rx + hw + 6, y + 2, hw, 34);
    text('나가기', rx + hw + 6 + hw / 2, y + 24, { size: 13, bold: true, color: '#fff', align: 'center', shadow: '#03306e' });
    if (ui.area('exit', rx + hw + 6, y + 2, hw, 34)) this.app.leaveRoom();
    // 무한 결투: the kill/death board (also the Tab key).
    const dy = duel ? 40 : 0;
    if (duel) {
      panel(rx, y + 42, rw, 32);
      text('📊 킬/데스 현황', rx + rw / 2, y + 63, { size: 13, bold: true, color: '#ffe95a', align: 'center', shadow: '#03306e' });
      if (!input.touchMode.on) text('Tab', rx + rw - 8, y + 62, { size: 10, bold: true, color: '#9fd0f5', align: 'right' });
      if (ui.area('board', rx, y + 42, rw, 32)) this.toggleBoard();
    }
    text(this.map.name, rx + rw / 2, y + dy + 56, { size: 12, bold: true, color: '#cfe8ff', align: 'center', maxW: rw });
    const me = this.myPlayer();
    if (!me) return;
    const items = [['Item/Bomb', me.bombs], ['Item/Potion', me.power], ['Item/Skate', me.speed]];
    if (me.kick) items.push(['Item/Shoe', '✓']);
    if (me.punch) items.push(['Item/Punch', '✓']);
    const per = Math.max(1, Math.min(3, Math.floor(rw / 52)));
    panel(rx, y + dy + 66, rw, Math.ceil(items.length / per) * 36 + 8);
    items.forEach(([sp, n], i) => {
      const ix = rx + 6 + (i % per) * (rw - 12) / per, iy = y + dy + 70 + Math.floor(i / per) * 36;
      const [w, h] = A.size(sp);
      if (w) { const sc = Math.min(1, 28 / Math.max(w, h)); A.drawAt(c, sp, 0, ix, iy + (32 - h * sc) / 2, w * sc, h * sc); }
      text(String(n), ix + 46, iy + 26, { size: 14, bold: true, color: '#fff', align: 'right', shadow: '#03306e' });
    });
    // Played with a keyboard: the item slots and their keys (1 needle, 2 shield, 3 dart, 4 free).
    if (!input.touchMode.on) {
      const sy = y + dy + 66 + Math.ceil(items.length / per) * 36 + 16;
      text('아이템 (숫자 키)', rx + 4, sy + 10, { size: 11, bold: true, color: '#9fd0f5' });
      const slots = [['Item/Niddle', me.needle, '1'], ['Item/Shield', me.shield, '2'], ['Item/Dart', me.dart || 0, '3'], [null, 0, '4']];
      const sw = Math.min(46, (rw - 6) / 4 - 4);
      slots.forEach(([sp, n, key], i) => {
        const sx = rx + i * (sw + 4) + 2, yy = sy + 16;
        panel(sx, yy, sw, sw + 4);
        c.globalAlpha = sp && n ? 1 : 0.35;
        if (sp) { const [w, h] = A.size(sp); if (w) { const sc = Math.min(1, (sw - 10) / Math.max(w, h)); A.drawAt(c, sp, 0, sx + (sw - w * sc) / 2, yy + (sw - h * sc) / 2, w * sc, h * sc); } }
        c.globalAlpha = 1;
        text(key, sx + 5, yy + 13, { size: 11, bold: true, color: '#ffe95a', shadow: '#000' });
        if (sp) text(String(n), sx + sw - 4, yy + sw, { size: 12, bold: true, color: '#fff', align: 'right', shadow: '#000' });
      });
    }
  }

  // Fill view, laid out like the mobile game: a small player list at the top left, the timer at
  // the top centre, settings and exit at the top right, my items along the bottom, and arrows
  // at the screen's edge pointing to players out of sight.
  drawHudFill(c, now) {
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
      const lv = this.levels.get(p.id), nx = lv ? 38 : 21;
      if (lv) drawRank(c, lv, 20, ry + 2);
      text(p.name, nx, ry + 14, { size: 11, bold: p.id === this.me, color: dead ? '#7a8aa8' : p.id === this.me ? '#ffe95a' : '#fff', maxW: lw - nx - 26, shadow: '#000' });
      text(dead ? (g.rule === 'duel' ? `${Math.max(1, Math.ceil((p.respawnT || 0) / HZ))}초` : '-') : p.state === 'trapped' ? '갇힘' : g.rule === 'duel' ? `${p.kills}/${p.deaths || 0}` : `${p.kills}`, lw, ry + 14, { size: 11, bold: true, color: p.state === 'trapped' ? '#7df' : '#cfe8ff', align: 'right', shadow: '#000' });
    });
    // Chat under the players, small.
    ui.begin();
    const ct = top + g.players.length * rowH + 12;
    this.chatArea(c, 6, ct, 190, Math.min(input.touchMode.on ? 96 : 130, vh * 0.5 - ct + 40), { size: 11, alpha: 0.45 });
    // Settings and exit.
    const bw = 58, bh = 28;
    panel(vw - 6 - bw * 2 - 6, top, bw, bh, 0.7);
    text('⚙ 설정', vw - 6 - bw * 1.5 - 6, top + 19, { size: 12, bold: true, align: 'center', color: '#fff' });
    if (ui.area('settings', vw - 6 - bw * 2 - 6, top, bw, bh)) this.openSettings();
    panel(vw - 6 - bw, top, bw, bh, 0.7);
    text('나가기', vw - 6 - bw / 2, top + 19, { size: 12, bold: true, align: 'center', color: '#fff' });
    if (ui.area('exit', vw - 6 - bw, top, bw, bh)) this.app.leaveRoom();
    if (g.rule === 'duel') {
      const bx = vw - 6 - bw * 2 - 6, by = top + bh + 6, w2 = bw * 2 + 6;
      panel(bx, by, w2, bh, 0.7);
      text('📊 킬/데스 현황', bx + w2 / 2, by + 19, { size: 12, bold: true, align: 'center', color: '#ffe95a' });
      if (ui.area('board', bx, by, w2, bh)) this.toggleBoard();
      this.drawDuelScore(c, vw / 2 - 90, top + 34, 180, (px, py, w, h) => panel(px, py, w, h, 0.45));
    }
    if (!this.darkNow()) this.drawOffscreen(c, 0, 34, vw, vh);
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

  // Players out of sight: an arrow in their colour at the edge of the visible map (the screen
  // rectangle left..right, top..bottom), pointing towards them.
  drawOffscreen(c, left, top, right, bottom) {
    const { k, x, y } = this.L, pad = 16;
    for (const p of this.g.players) {
      if (p.id === this.me || p.state === 'dead') continue;
      const v = this.view(p);
      if (this.inBush(v) && p.state === 'normal') continue;
      const sx = x + v.x * k, sy = y + (v.y - 20) * k;
      if (sx > left - 10 && sx < right + 10 && sy > top - 10 && sy < bottom + 10) continue;
      const ex = Math.max(left + pad, Math.min(right - pad, sx)), ey = Math.max(top + pad, Math.min(bottom - pad, sy));
      c.save(); c.translate(ex, ey); c.rotate(Math.atan2(sy - ey, sx - ex));
      c.fillStyle = TEAMS[p.color]?.css || '#fff'; c.strokeStyle = '#fff'; c.lineWidth = 2;
      c.beginPath(); c.moveTo(10, 0); c.lineTo(-7, -8); c.lineTo(-7, 8); c.closePath(); c.fill(); c.stroke();
      c.restore();
    }
  }

  // Horror maps (묘지, 공동묘지, 다크캐슬): in the last DARK_SECONDS the lights go out and only a
  // small circle round me stays lit (those out of the round see everything).
  darkNow() { return HORROR.test(this.map.id) && this.g.phase === 'play' && this.g.timer <= DARK_SECONDS * HZ; }
  drawDark(c, now) {
    if (!this.darkNow()) { this.darkAt = 0; return; }
    if (!this.darkAt) { this.darkAt = now; sfx('Itm_Devil_Start', 0.6); }
    const me = this.myPlayer();
    if (!me || me.state === 'dead') return;
    const v = this.view(me), fade = Math.min(1, (now - this.darkAt) / 1500);
    const r = 70 * (1 + 0.04 * Math.sin(now / 110) + 0.02 * Math.sin(now / 37));
    const gr = c.createRadialGradient(v.x, v.y - 12, r * 0.45, v.x, v.y - 12, r * 1.7);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.45, `rgba(4,0,14,${0.45 * fade})`); gr.addColorStop(1, `rgba(4,0,14,${0.94 * fade})`);
    c.fillStyle = gr; c.fillRect(0, 0, WW, WH);
    if (now - this.darkAt < 2600) text('불이 꺼졌어요… 내 주변만 보여요!', v.x < WW / 2 ? WW * 0.62 : WW * 0.38, 60, { size: 18, bold: true, color: '#d8b8ff', align: 'center', shadow: '#000' });
  }

  toggleBoard() { sfx('Bt_c_Pop', 0.5); this.board = !this.board; }

  // 무한 결투 points in a small panel: red against blue, or my place among everyone.
  drawDuelScore(c, x, y, w, panel) {
    const g = this.g, sc = sideScores(g), me = this.myPlayer();
    panel(x, y, w, 30);
    if (g.mode === 'team') {
      const teams = [...new Set(g.players.map((p) => p.team))];
      const [a, b] = teams, ca = TEAMS[g.players.find((p) => p.team === a)?.color]?.css || '#f55', cb = TEAMS[g.players.find((p) => p.team === b)?.color]?.css || '#58f';
      text('⚔', x + w / 2, y + 21, { size: 13, bold: true, color: '#fff', align: 'center' });
      text(`${sc.get(a) ?? 0}`, x + w / 2 - 14, y + 22, { size: 17, bold: true, color: ca, align: 'right', shadow: '#02163f' });
      text(`${sc.get(b) ?? 0}`, x + w / 2 + 14, y + 22, { size: 17, bold: true, color: cb, shadow: '#02163f' });
      text('점', x + w - 8, y + 21, { size: 10, bold: true, color: '#9fd0f5', align: 'right' });
    } else if (me) {
      const order = [...g.players].sort((p, q) => scoreOf(q) - scoreOf(p));
      text(`⚔ ${order.indexOf(me) + 1}위`, x + 10, y + 21, { size: 13, bold: true, color: '#ffe95a' });
      text(`${scoreOf(me)}점`, x + w - 10, y + 22, { size: 16, bold: true, color: '#fff', align: 'right', shadow: '#02163f' });
    }
  }

  // The kill/death board over the map (the map shows through): every player with their rank,
  // level, kills, deaths and points, by team. X, Tab or moving closes it.
  drawBoard(c, now) {
    const g = this.g, { k, x, y, vw, vh } = this.L, team = g.mode === 'team';
    const mx = Math.max(0, x), mw = Math.min(vw, WW * k), my = Math.max(0, y), mh = Math.min(vh, WH * k);
    // Nearly the whole map (as on a phone); everything scales with the board's width.
    const w = mw - 24, u = Math.max(1, Math.min(1.9, w / 520));
    const rowH = Math.max(28, Math.min(36 * u, (mh - 140 * u) / (g.players.length + (team ? 2 : 1))));
    const groups = team ? [...new Set(g.players.map((p) => p.team))].map((t) => g.players.filter((p) => p.team === t)) : [[...g.players].sort((p, q) => scoreOf(q) - scoreOf(p))];
    const h = 64 * u + groups.reduce((n, gr) => n + (team ? 30 : 22) * u + gr.length * rowH, 0) + 34 * u;
    const bx = mx + (mw - w) / 2, by = my + Math.max(10, (mh - h) / 2);
    c.fillStyle = 'rgba(2, 14, 46, 0.78)'; roundRect(c, bx, by, w, h, 14); c.fill();
    c.strokeStyle = 'rgba(127, 212, 255, 0.8)'; c.lineWidth = 2; c.stroke();
    const over = g.phase === 'end';
    text(over ? '⚔ 무한 결투 결과' : '⚔ 킬/데스 현황', bx + 18 * u, by + 34 * u, { size: 20 * u, bold: true, color: '#ffe95a', shadow: '#02163f' });
    if (over && this.result) {
      const [word, col] = { win: ['승리!', '#7dffb0'], lose: ['패배', '#ff8a8a'], draw: ['무승부', '#cfe8ff'] }[this.result];
      text(word, bx + 210 * u, by + 35 * u, { size: 24 * u, bold: true, color: col, shadow: '#02163f' });
    }
    text(`킬 +${KILL_POINTS}점 · 데스 -${DEATH_POINTS}점`, bx + w - 56 * u, by + 32 * u, { size: 12 * u, bold: true, color: '#9fd0f5', align: 'right' });
    // X
    ui.begin();
    if (!over) {
      c.fillStyle = 'rgba(255,255,255,0.12)'; c.beginPath(); c.arc(bx + w - 26 * u, by + 26 * u, 14 * u, 0, Math.PI * 2); c.fill();
      text('✕', bx + w - 26 * u, by + 32 * u, { size: 15 * u, bold: true, color: '#fff', align: 'center' });
      if (ui.area('board-x', bx + w - 44 * u, by + 8 * u, 36 * u, 36 * u)) this.toggleBoard();
    }
    const cols = { lv: bx + w * 0.52, kill: bx + w * 0.68, death: bx + w * 0.8, score: bx + w - 20 * u };
    let cy = by + 56 * u;
    const sc = sideScores(g);
    groups.forEach((gr, gi) => {
      const col = TEAMS[gr[0].color]?.css || '#fff';
      if (team) {
        c.fillStyle = col; c.globalAlpha = 0.28; roundRect(c, bx + 12, cy, w - 24, 26 * u, 7); c.fill(); c.globalAlpha = 1;
        const name = gr[0].color === 0 ? '빨강팀' : gr[0].color === 5 ? '파랑팀' : `${gi + 1}팀`;
        const kills = gr.reduce((n, p) => n + p.kills, 0), deaths = gr.reduce((n, p) => n + (p.deaths || 0), 0);
        text(name, bx + 22 * u, cy + 18 * u, { size: 14 * u, bold: true, color: '#fff', shadow: '#000' });
        text(String(kills), cols.kill, cy + 18 * u, { size: 13 * u, bold: true, color: '#fff', align: 'center' });
        text(String(deaths), cols.death, cy + 18 * u, { size: 13 * u, bold: true, color: '#fff', align: 'center' });
        text(`${sc.get(gr[0].team) ?? 0}점`, cols.score, cy + 18 * u, { size: 14 * u, bold: true, color: '#ffe95a', align: 'right', shadow: '#000' });
        cy += 30 * u;
      } else {
        for (const [label, cx2] of [['레벨', cols.lv], ['킬', cols.kill], ['데스', cols.death]]) text(label, cx2, cy + 14 * u, { size: 11 * u, bold: true, color: '#9fd0f5', align: 'center' });
        text('점수', cols.score, cy + 14 * u, { size: 11 * u, bold: true, color: '#9fd0f5', align: 'right' });
        cy += 22 * u;
      }
      gr.forEach((p, i) => {
        const ry = cy + i * rowH, mine = p.id === this.me;
        if (mine) { c.fillStyle = 'rgba(255, 233, 90, 0.16)'; roundRect(c, bx + 12, ry, w - 24, rowH - 3, 6); c.fill(); }
        let nx = bx + 20 * u;
        if (!team) { text(`${i + 1}`, nx + 6 * u, ry + rowH / 2 + 5 * u, { size: 14 * u, bold: true, color: i === 0 ? '#ffe95a' : '#cfe8ff', align: 'center' }); nx += 20 * u; }
        c.save(); c.beginPath(); c.rect(nx, ry, rowH - 4, rowH - 3); c.clip(); c.translate(nx, ry); c.scale((rowH - 4) / 45, (rowH - 4) / 45);
        A.drawChar(c, p.char, 'Portrait', 0, 0, 0, p.color); c.restore();
        nx += rowH;
        const lv = this.levels.get(p.id);
        if (lv) { drawRank(c, lv, nx, ry + rowH / 2 - 7 * u, u); nx += 20 * u; }
        text(p.name, nx, ry + rowH / 2 + 5 * u, { size: 14 * u, bold: mine, color: mine ? '#ffe95a' : '#fff', maxW: cols.lv - nx - 30 * u });
        text(lv ? `Lv.${lv}` : '-', cols.lv, ry + rowH / 2 + 5 * u, { size: 12 * u, bold: true, color: '#cfe8ff', align: 'center' });
        text(String(p.kills), cols.kill, ry + rowH / 2 + 5 * u, { size: 15 * u, bold: true, color: '#7dffb0', align: 'center' });
        text(String(p.deaths || 0), cols.death, ry + rowH / 2 + 5 * u, { size: 15 * u, bold: true, color: '#ff8a8a', align: 'center' });
        text(String(scoreOf(p)), cols.score, ry + rowH / 2 + 5 * u, { size: 15 * u, bold: true, color: '#fff', align: 'right' });
      });
      cy += gr.length * rowH;
    });
    if (team) {
      for (const [label, cx2] of [['레벨', cols.lv], ['킬', cols.kill], ['데스', cols.death]]) text(label, cx2, by + 50 * u, { size: 11 * u, bold: true, color: '#9fd0f5', align: 'center' });
      text('점수', cols.score, by + 50 * u, { size: 11 * u, bold: true, color: '#9fd0f5', align: 'right' });
    }
    const prize = [this.paid ? `+${this.paid.toLocaleString()} 루찌` : '', this.expGained ? `+${this.expGained} 경험치` : ''].filter(Boolean).join(' · ');
    text(over ? prize : input.touchMode.on ? '✕를 누르거나 움직이면 닫혀요' : 'Tab 키를 다시 누르거나 방향키로 움직이면 닫혀요', bx + w / 2, by + h - 12 * u, { size: 12 * u, bold: true, color: '#9fd0f5', align: 'center' });
  }

  // 무한 결투: popped, the client's big blue digits count down to coming back.
  drawRespawn(c, cx, cy) {
    const me = this.myPlayer();
    if (!me || this.g.rule !== 'duel' || me.state !== 'dead' || !me.respawnT || this.g.phase !== 'play') return;
    const n = Math.ceil(me.respawnT / HZ);
    if (n > 3) return;
    const frac = (me.respawnT / HZ) % 1 || 1, sc = 0.7 + 0.3 * frac;
    const [w, h] = A.size('Game/Kill_ImageNo-Revive', n);
    text('부활까지', cx, cy - 70, { size: 20, bold: true, color: '#fff', align: 'center', shadow: '#02163f' });
    if (w) { c.save(); c.translate(cx, cy); c.scale(sc, sc); A.drawAt(c, 'Game/Kill_ImageNo-Revive', n, -w / 2, -h / 2); c.restore(); }
    else text(String(n), cx, cy + 20, { size: 80, bold: true, color: '#7fd4ff', align: 'center', shadow: '#02163f' });
  }

  // The chat list, which a touch player out of the round can tap to type.
  chatArea(c, x, y, w, h, opts) {
    const me = this.myPlayer(), touch = input.touchMode.on, canType = !touch || (me && me.state === 'dead');
    this.drawChat(c, x, y, w, h, { ...opts, hint: canType });
    if (touch && canType && ui.area('chat', x, y, w, h)) this.openChat();
  }

  leave() {
    input.enable(false);
    window.removeEventListener('keydown', this.onKey);
    if (this.closeChat) this.closeChat();
  }
}

// Splits a chat line into rows that fit `width` (by characters, so Korean wraps too). The
// rows are kept, since the chat and the bubbles are drawn every frame.
const wrapped = new Map();
function wrap(c, str, width, size) {
  const key = `${size}|${width}|${str}`;
  let rows = wrapped.get(key);
  if (!rows) {
    rows = split(c, str, width);
    if (wrapped.size > 300) wrapped.clear();
    wrapped.set(key, rows);
  }
  return rows;
}
function split(c, str, width) {
  const rows = [];
  let row = '';
  for (const ch of str) {
    if (row && c.measureText(row + ch).width > width) { rows.push(row); row = ch.trimStart(); } else row += ch;
  }
  if (row) rows.push(row);
  return rows.length ? rows : [''];
}

// Losses in a row on this device; true for a win that ends three or more of them (once).
function comeback(result) {
  let run = 0;
  try { run = Number(localStorage.getItem('ca-loserun')) || 0; } catch { /* private mode */ }
  const next = result === 'lose' ? run + 1 : 0;
  try { localStorage.setItem('ca-loserun', String(next)); } catch { /* ignore */ }
  return result === 'win' && run >= 3;
}
