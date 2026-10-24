// The 800×600 screen of the PC client, scaled to fit the window, plus a tiny immediate-mode UI:
// scenes draw every frame and ask ui.button(...) whether it was tapped.
import * as A from './assets.js';

export const W = 800, H = 600;
export const FONT = '"Nanum Gothic", "NanumGothic", Gulim, "Malgun Gothic", sans-serif';

export const stage = {
  // fill: the menus stretch the 800×600 screen over the whole display; the game keeps its
  // shape (fit) so the touch controls get the space at the sides.
  // mode: 'fit' keeps the 800×600 picture whole (letterboxed), 'fill' stretches it, 'css' maps
  // stage units to CSS pixels so a scene lays itself out for the screen (the game does).
  canvas: null, ctx: null, scale: 1, sx: 1, sy: 1, ox: 0, oy: 0, dpr: 1, cssW: 0, cssH: 0, mode: 'fit',
  setMode(m) { if (this.mode !== m) { this.mode = m; this.resize(); } },
  init(canvas) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    const fit = () => this.resize();
    window.addEventListener('resize', fit);
    window.addEventListener('orientationchange', () => setTimeout(fit, 200));
    if (window.visualViewport) window.visualViewport.addEventListener('resize', fit);
    fit();
  },
  resize() {
    const vw = window.visualViewport ? window.visualViewport.width : window.innerWidth;
    const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    this.cssW = vw; this.cssH = vh;
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.canvas.style.width = vw + 'px'; this.canvas.style.height = vh + 'px';
    this.canvas.width = Math.round(vw * this.dpr); this.canvas.height = Math.round(vh * this.dpr);
    this.scale = Math.min(vw / W, vh / H);
    if (this.mode === 'css') { this.sx = this.sy = 1; this.ox = this.oy = 0; } else {
      if (this.mode === 'fill') { this.sx = vw / W; this.sy = vh / H; } else this.sx = this.sy = this.scale;
      this.ox = (vw - W * this.sx) / 2; this.oy = (vh - H * this.sy) / 2;
    }
    for (const f of resizeHooks) f();
  },
  // Stage coordinates -> CSS pixels and back.
  toCss(x, y) { return [this.ox + x * this.sx, this.oy + y * this.sy]; },
  toStage(cx, cy) { return [(cx - this.ox) / this.sx, (cy - this.oy) / this.sy]; },
  // backdrop: an image laid over the whole display (beyond the 800×600 picture) first.
  begin(backdrop = null) {
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = '#061633'; c.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (backdrop) {
      const k = Math.max(this.canvas.width / backdrop.width, this.canvas.height / backdrop.height);
      c.drawImage(backdrop, (this.canvas.width - backdrop.width * k) / 2, (this.canvas.height - backdrop.height * k) / 2, backdrop.width * k, backdrop.height * k);
    }
    c.setTransform(this.sx * this.dpr, 0, 0, this.sy * this.dpr, this.ox * this.dpr, this.oy * this.dpr);
    c.imageSmoothingEnabled = Math.min(this.sx, this.sy) * this.dpr < 1.5;
    return c;
  },
};
const resizeHooks = [];
export const onResize = (f) => { resizeHooks.push(f); };

// Places a DOM element over a stage rectangle (inputs, scrolling chat).
export function place(el, x, y, w, h, fontPx = 12) {
  const [cx, cy] = stage.toCss(x, y);
  Object.assign(el.style, { left: cx + 'px', top: cy + 'px', width: w * stage.sx + 'px', height: h * stage.sy + 'px', fontSize: fontPx * stage.sy + 'px' });
}

export const ui = {
  regions: [], pointer: null, down: null, tapped: null, hoverId: null,
  init(canvas) {
    const pos = (e) => stage.toStage(e.clientX, e.clientY);
    canvas.addEventListener('pointerdown', (e) => {
      const [x, y] = pos(e); this.pointer = { x, y };
      const r = this.hit(x, y); this.down = r ? r.id : null;
      if (r && r.onDown) r.onDown(x, y);
    });
    canvas.addEventListener('pointermove', (e) => { const [x, y] = pos(e); this.pointer = { x, y }; const r = this.hit(x, y); this.hoverId = r ? r.id : null; });
    window.addEventListener('pointerup', (e) => {
      const [x, y] = pos(e); const r = this.hit(x, y);
      if (r && r.id === this.down) this.tapped = { id: r.id, x, y };
      this.down = null;
    });
    canvas.addEventListener('pointercancel', () => { this.down = null; });
  },
  hit(x, y) { for (let i = this.regions.length - 1; i >= 0; i--) { const r = this.regions[i]; if (x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h) return r; } return null; },
  begin() { this.prevRegions = this.regions; this.regions = []; },
  end() { this.tapped = null; },
  // Registers a tappable rectangle; returns true on the frame it is tapped.
  area(id, x, y, w, h, opts = {}) {
    this.regions.push({ id, x, y, w, h, ...opts });
    return !opts.disabled && this.tapped && this.tapped.id === id;
  },
  state(id) { return this.down === id ? 'down' : this.hoverId === id ? 'over' : 'up'; },
  // A sprite button. Frames: 0 normal, 1 over, 2 down, 3 disabled (fewer frames fall back).
  button(id, sprite, x, y, opts = {}) {
    const [w, h] = A.size(sprite);
    const n = A.frames(sprite);
    const st = opts.disabled ? 3 : this.state(id) === 'down' ? 2 : this.state(id) === 'over' ? 1 : 0;
    const f = opts.frame ?? (n > st ? st : st === 3 ? 0 : Math.min(n - 1, st));
    const ok = A.drawAt(stage.ctx, sprite, f, x, y);
    if (!ok) fallbackButton(x, y, opts.w || 100, opts.h || 30, opts.label || id, st);
    return this.area(id, x, y, ok ? w : opts.w || 100, ok ? h : opts.h || 30, opts);
  },
};

function fallbackButton(x, y, w, h, label, st) {
  const c = stage.ctx;
  c.fillStyle = st === 3 ? '#557' : st === 2 ? '#0a5bd8' : st === 1 ? '#3aa0ff' : '#1d7cf2';
  roundRect(c, x, y, w, h, 6); c.fill();
  c.strokeStyle = '#bfe6ff'; c.lineWidth = 2; c.stroke();
  text(label, x + w / 2, y + h / 2 + 5, { size: 13, color: '#fff', align: 'center', bold: true, shadow: '#02306b' });
}

export function roundRect(c, x, y, w, h, r) {
  c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}

// Text in the client's look: small Gulim-like Korean with an optional outline.
export function text(str, x, y, { size = 12, color = '#fff', align = 'left', bold = false, shadow = null, maxW } = {}) {
  const c = stage.ctx;
  c.font = `${bold ? 'bold ' : ''}${size}px ${FONT}`;
  c.textAlign = align; c.textBaseline = 'alphabetic';
  if (shadow) {
    c.strokeStyle = shadow; c.lineWidth = Math.max(2, size / 5); c.lineJoin = 'round';
    c.strokeText(str, x, y, maxW);
  }
  c.fillStyle = color; c.fillText(str, x, y, maxW);
}
