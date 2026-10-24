// Game controls. Keyboard as on the PC client (arrows or WASD, Space for a balloon, Ctrl for the
// item), and on touch screens the layout of the mobile game: a stick on the left, a big
// balloon button on the right with the needle and shield buttons above it. The touch controls
// are drawn on the main canvas in screen pixels, in the space beside the 800×600 picture when
// there is room, over its edges when there is not.
import { stage, FONT } from './stage.js';
import * as A from './assets.js';

const keys = new Set();
let bombQueued = false, itemQueued = null;
let enabled = false;
export const touchMode = { on: matchMedia('(pointer: coarse)').matches };

const KEYDIR = { ArrowUp: 1, KeyW: 1, ArrowDown: 2, KeyS: 2, ArrowLeft: 3, KeyA: 3, ArrowRight: 4, KeyD: 4 };
let lastDirKey = null;
window.addEventListener('keydown', (e) => {
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
  if (!enabled) return;
  if (KEYDIR[e.code]) { keys.add(e.code); lastDirKey = e.code; e.preventDefault(); }
  if (e.code === 'Space' && !e.repeat) { bombQueued = true; e.preventDefault(); }
  if ((e.code === 'ControlLeft' || e.code === 'ControlRight' || e.code === 'KeyZ') && !e.repeat) itemQueued = 'auto';
  if (e.code === 'KeyX' && !e.repeat) itemQueued = 'shield';
});
window.addEventListener('keyup', (e) => { keys.delete(e.code); if (lastDirKey === e.code) lastDirKey = [...keys].reverse().find((k) => KEYDIR[k]) || null; });
window.addEventListener('blur', () => keys.clear());

// Touch state.
const stick = { id: null, cx: 0, cy: 0, x: 0, y: 0, r: 60, dir: 0, baseX: 0, baseY: 0 };
const btn = { bomb: { x: 0, y: 0, r: 52, id: null }, needle: { x: 0, y: 0, r: 30, id: null }, shield: { x: 0, y: 0, r: 30, id: null } };
let counts = { needle: 0, shield: 0 };

function layout() {
  const vw = stage.cssW, vh = stage.cssH;
  const margin = stage.ox; // free width on each side of the picture
  const unit = Math.max(0.75, Math.min(1.25, Math.min(vw, vh) / 380));
  stick.r = 58 * unit; btn.bomb.r = 50 * unit; btn.needle.r = btn.shield.r = 27 * unit;
  const side = margin >= stick.r * 2.2 ? margin / 2 : stick.r + 18;
  stick.baseX = side; stick.baseY = vh - Math.max(stick.r + 24, vh * 0.3);
  if (!stick.id) { stick.cx = stick.baseX; stick.cy = stick.baseY; }
  const rx = vw - (margin >= btn.bomb.r * 2.4 ? margin / 2 : btn.bomb.r + 20);
  btn.bomb.x = rx; btn.bomb.y = vh - Math.max(btn.bomb.r + 26, vh * 0.28);
  btn.needle.x = rx - btn.bomb.r * 0.95; btn.needle.y = btn.bomb.y - btn.bomb.r * 1.75;
  btn.shield.x = rx + btn.bomb.r * 0.55; btn.shield.y = btn.bomb.y - btn.bomb.r * 2.0;
  if (margin < btn.bomb.r * 2.4) { btn.shield.x = rx; btn.shield.y = btn.bomb.y - btn.bomb.r * 2.3; btn.needle.x = rx - btn.bomb.r * 1.5; btn.needle.y = btn.bomb.y - btn.bomb.r * 1.2; }
}

function inCircle(b, x, y, extra = 1.25) { return Math.hypot(x - b.x, y - b.y) <= b.r * extra; }

function stickDir() {
  const dx = stick.x - stick.cx, dy = stick.y - stick.cy;
  if (Math.hypot(dx, dy) < stick.r * 0.28) return 0;
  return Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 3 : 4) : (dy < 0 ? 1 : 2);
}

export function attach(canvas) {
  const down = (e) => {
    if (!enabled || !touchMode.on) return;
    const x = e.clientX, y = e.clientY;
    for (const [k, b] of Object.entries(btn)) {
      if (b.id === null && inCircle(b, x, y)) {
        b.id = e.pointerId;
        if (k === 'bomb') bombQueued = true; else itemQueued = k;
        if (navigator.vibrate) navigator.vibrate(12);
        e.stopImmediatePropagation(); e.preventDefault(); return;
      }
    }
    if (stick.id === null && x < stage.cssW * 0.45 && y > stage.cssH * 0.25) {
      stick.id = e.pointerId; stick.cx = x; stick.cy = y; stick.x = x; stick.y = y;
      e.stopImmediatePropagation(); e.preventDefault();
    }
  };
  const move = (e) => {
    if (e.pointerId === stick.id) {
      stick.x = e.clientX; stick.y = e.clientY;
      // Drag the base along when the thumb goes far, as the mobile game does.
      const dx = stick.x - stick.cx, dy = stick.y - stick.cy, d = Math.hypot(dx, dy);
      if (d > stick.r) { stick.cx = stick.x - (dx / d) * stick.r; stick.cy = stick.y - (dy / d) * stick.r; }
      e.preventDefault();
    }
  };
  const up = (e) => {
    if (e.pointerId === stick.id) { stick.id = null; stick.cx = stick.baseX; stick.cy = stick.baseY; stick.x = stick.cx; stick.y = stick.cy; }
    for (const b of Object.values(btn)) if (b.id === e.pointerId) b.id = null;
  };
  canvas.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') touchMode.on = true; down(e); }, true);
  canvas.addEventListener('pointermove', move, true);
  window.addEventListener('pointerup', up, true);
  window.addEventListener('pointercancel', up, true);
  window.addEventListener('keydown', () => { if (!matchMedia('(pointer: coarse)').matches) touchMode.on = false; });
}

export function enable(on) { enabled = on; keys.clear(); bombQueued = false; itemQueued = null; stick.id = null; layout(); }
export function setCounts(c) { counts = c; }

// Input for this tick: direction 0-4, balloon edge, item edge ('needle' | 'shield' | 'auto').
export function read() {
  let dir = 0;
  if (lastDirKey && keys.has(lastDirKey)) dir = KEYDIR[lastDirKey];
  if (touchMode.on && stick.id !== null) dir = stickDir() || dir;
  const out = { dir, bomb: bombQueued, item: itemQueued };
  bombQueued = false; itemQueued = null;
  return out;
}

function circle(c, x, y, r, fill, stroke, lw = 3) {
  c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2);
  if (fill) { c.fillStyle = fill; c.fill(); }
  if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw; c.stroke(); }
}

// Draws the touch controls in screen pixels (call after the scene, with a fresh transform).
export function draw() {
  if (!enabled || !touchMode.on) return;
  layout();
  const c = stage.ctx, d = stage.dpr;
  c.setTransform(d, 0, 0, d, 0, 0);
  c.imageSmoothingEnabled = true;
  const overlay = stage.ox < btn.bomb.r * 2.4;
  c.globalAlpha = overlay ? 0.55 : 0.92;
  // Stick: white rim with arrow hints and a bear-face thumb like the mobile game.
  circle(c, stick.cx, stick.cy, stick.r, 'rgba(225,240,255,0.35)', 'rgba(255,255,255,0.85)', 3);
  c.fillStyle = 'rgba(255,255,255,0.9)';
  for (const [ax, ay, rot] of [[0, -1, 0], [0, 1, Math.PI], [-1, 0, -Math.PI / 2], [1, 0, Math.PI / 2]]) {
    c.save(); c.translate(stick.cx + ax * stick.r * 0.78, stick.cy + ay * stick.r * 0.78); c.rotate(rot);
    c.beginPath(); c.moveTo(0, -9); c.lineTo(9, 5); c.lineTo(-9, 5); c.closePath(); c.fill(); c.restore();
  }
  const tx = stick.id !== null ? stick.x : stick.cx, ty = stick.id !== null ? stick.y : stick.cy;
  const kx = stick.cx + Math.max(-1, Math.min(1, (tx - stick.cx) / stick.r)) * stick.r * 0.5;
  const ky = stick.cy + Math.max(-1, Math.min(1, (ty - stick.cy) / stick.r)) * stick.r * 0.5;
  circle(c, kx, ky, stick.r * 0.46, '#e8f2ff', '#9fc4ef', 3);
  circle(c, kx - stick.r * 0.28, ky - stick.r * 0.3, stick.r * 0.13, '#cfe1f7');
  circle(c, kx + stick.r * 0.28, ky - stick.r * 0.3, stick.r * 0.13, '#cfe1f7');

  // Balloon button: big blue bubble with the balloon sprite inside.
  const b = btn.bomb;
  const pressed = b.id !== null;
  const g = c.createRadialGradient(b.x - b.r * 0.3, b.y - b.r * 0.35, b.r * 0.1, b.x, b.y, b.r);
  g.addColorStop(0, pressed ? '#9fe3ff' : '#c9f1ff'); g.addColorStop(0.6, pressed ? '#1d9be8' : '#36b6f5'); g.addColorStop(1, '#0a6cc4');
  circle(c, b.x, b.y, b.r * (pressed ? 0.95 : 1), g, '#e9f8ff', 4);
  const bf = A.frameOf('Item/Bomb', 0);
  if (bf && bf.img) { const s = (b.r * 1.15) / bf.h; c.drawImage(bf.img, bf.sx, bf.sy, bf.w, bf.h, b.x - (bf.w * s) / 2, b.y - (bf.h * s) / 2, bf.w * s, bf.h * s); }
  for (const k of ['needle', 'shield']) {
    const t = btn[k], n = counts[k] || 0;
    circle(c, t.x, t.y, t.r, n ? 'rgba(30,110,200,0.9)' : 'rgba(40,60,90,0.6)', '#d9eeff', 3);
    const f = A.frameOf(k === 'needle' ? 'Item/Niddle' : 'Item/Shield', 0);
    if (f && f.img) { const s = (t.r * 1.3) / Math.max(f.w, f.h); c.globalAlpha *= n ? 1 : 0.5; c.drawImage(f.img, f.sx, f.sy, f.w, f.h, t.x - (f.w * s) / 2, t.y - (f.h * s) / 2, f.w * s, f.h * s); c.globalAlpha = overlay ? 0.55 : 0.92; }
    c.font = `bold ${Math.round(t.r * 0.62)}px ${FONT}`; c.textAlign = 'center';
    c.lineWidth = 3; c.strokeStyle = '#03224a'; c.strokeText(String(n), t.x + t.r * 0.62, t.y - t.r * 0.55);
    c.fillStyle = '#fff'; c.fillText(String(n), t.x + t.r * 0.62, t.y - t.r * 0.55);
  }
  c.globalAlpha = 1;
}
