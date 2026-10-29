// Loads the converted PC assets (assets/ca/): sprite groups (PNG sheets + frame tables),
// JPEG backgrounds and sounds, and draws sprite frames by their anchor point.
// A frame is [sheet, sx, sy, w, h, dx, dy]: the image's top-left is (dx, dy) from the anchor,
// and the anchor is the bottom-left corner of the 40×40 cell the thing stands on.
import { TEAMS } from './shared/const.js';

const BASE = 'assets/ca/';
export const sprites = new Map(); // name -> [{ img, sx, sy, w, h, dx, dy }]
const groups = new Map(); // name -> Promise
const bgs = new Map();
export let manifest = { groups: [], bg: [], bgm: [], sfx: [], audio: 'ogg' };
export let ready = false;

function image(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`image ${src}`));
    img.src = src;
  });
}

export async function loadManifest() {
  try {
    const r = await fetch(BASE + 'manifest.json', { cache: 'no-cache' });
    if (r.ok) { manifest = { ...manifest, ...(await r.json()) }; ready = true; }
  } catch { /* no converted assets: the game still runs with plain shapes */ }
  return ready;
}

export function loadGroup(name) {
  if (!ready || !manifest.groups.includes(name)) return Promise.resolve(false);
  if (!groups.has(name)) {
    groups.set(name, (async () => {
      const j = await (await fetch(`${BASE}${name}.json`)).json();
      const imgs = await Promise.all(j.sheets.map((f) => image(BASE + f)));
      for (const [sp, frames] of Object.entries(j.sprites))
        sprites.set(sp, frames.map(([s, sx, sy, w, h, dx, dy]) => ({ img: s >= 0 ? imgs[s] : null, sx, sy, w, h, dx, dy })));
      return true;
    })().catch((e) => { console.warn(e); return false; }));
  }
  return groups.get(name);
}

export function loadBg(name) {
  if (!ready || !manifest.bg.includes(name)) return Promise.resolve(null);
  if (!bgs.has(name)) bgs.set(name, image(`${BASE}bg/${name}.jpg`).then((img) => { bgs.set(name, img); return img; }).catch(() => null));
  const v = bgs.get(name);
  return v instanceof Promise ? v : Promise.resolve(v);
}
export const bg = (name) => { const v = bgs.get(name); return v instanceof Promise ? null : v || null; };

export const has = (name) => sprites.has(name);
export const frames = (name) => sprites.get(name)?.length || 0;
export function frameOf(name, i) {
  const f = sprites.get(name);
  return f ? f[((i % f.length) + f.length) % f.length] : null;
}

// Draws frame i of a sprite with its anchor at (x, y).
export function draw(ctx, name, i, x, y, alpha = 1) {
  const f = frameOf(name, i);
  if (!f || !f.img) return false;
  if (alpha !== 1) ctx.globalAlpha = alpha;
  ctx.drawImage(f.img, f.sx, f.sy, f.w, f.h, Math.round(x + f.dx), Math.round(y + f.dy), f.w, f.h);
  if (alpha !== 1) ctx.globalAlpha = 1;
  return true;
}

// Draws with the frame's top-left at (x, y) (UI pieces placed by their corner).
export function drawAt(ctx, name, i, x, y, w, h) {
  const f = frameOf(name, i);
  if (!f || !f.img) return false;
  ctx.drawImage(f.img, f.sx, f.sy, f.w, f.h, Math.round(x), Math.round(y), w ?? f.w, h ?? f.h);
  return true;
}
export const size = (name, i = 0) => { const f = frameOf(name, i); return f ? [f.w, f.h] : [0, 0]; };

// Team colour: the red "LayerAdjust" parts of a character are recoloured to the team's hue.
// Each recoloured frame is cached as its own small canvas.
const tinted = new Map();
function rgbToHsv(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) {
    if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return [h, mx ? d / mx : 0, mx / 255];
}
function hsvToRgb(h, s, v) {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}
function tintFrame(f, team) {
  const t = TEAMS[team] || TEAMS[0];
  const cv = document.createElement('canvas');
  cv.width = f.w; cv.height = f.h;
  const c = cv.getContext('2d');
  c.drawImage(f.img, f.sx, f.sy, f.w, f.h, 0, 0, f.w, f.h);
  if (t.hue === 0) return cv;
  const id = c.getImageData(0, 0, f.w, f.h), d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    const [h, s, v] = rgbToHsv(d[i], d[i + 1], d[i + 2]);
    // Only reddish pixels belong to the team colour; skin, outlines and highlights stay.
    if (s < 0.25 || (h > 25 && h < 335)) continue;
    let nh = (h + t.hue + 360) % 360, ns = s, nv = v;
    if (team === 1) nv = Math.min(1, v * 1.08); // yellow reads darker than red at the same value
    const [r, g, b] = hsvToRgb(nh, ns, nv);
    d[i] = r; d[i + 1] = g; d[i + 2] = b;
  }
  c.putImageData(id, 0, 0);
  return cv;
}
export function drawTinted(ctx, name, i, x, y, team, alpha = 1) {
  const fr = sprites.get(name);
  if (!fr) return false;
  const k = ((i % fr.length) + fr.length) % fr.length;
  const f = fr[k];
  if (!f.img) return false;
  const key = `${name}#${k}#${team}`;
  let cv = tinted.get(key);
  if (!cv) { cv = tintFrame(f, team); tinted.set(key, cv); }
  if (alpha !== 1) ctx.globalAlpha = alpha;
  ctx.drawImage(cv, Math.round(x + f.dx), Math.round(y + f.dy));
  if (alpha !== 1) ctx.globalAlpha = 1;
  return true;
}

// Character layers in drawing order for an action, e.g. ('C05', 'WalkDown').
const layerCache = new Map();
export function charLayers(id, action) {
  const key = `${id}-${action}`;
  if (layerCache.has(key) && layerCache.get(key).length) return layerCache.get(key);
  const out = [];
  for (const L of ['_C', '_B', '_A', '']) for (const k of ['LayerAdjust', 'LayerStatic']) {
    const n = `Character/${id}-${action}${L}${k}`;
    if (sprites.has(n)) out.push({ name: n, adjust: k === 'LayerAdjust' });
  }
  layerCache.set(key, out);
  return out;
}
// A shop decoration's frame now: it plays its own animation all the time (the client's object
// table gives every frame four ticks), whatever the character is doing.
export const decoFrame = (name, now) => Math.floor(now / 120) % Math.max(1, frames(name));
export function drawChar(ctx, id, action, i, x, y, team, alpha = 1) {
  const ls = charLayers(id, action);
  for (const l of ls) {
    const n = frames(l.name);
    const k = Math.min(i, n - 1);
    if (l.adjust) drawTinted(ctx, l.name, k, x, y, team, alpha); else draw(ctx, l.name, k, x, y, alpha);
  }
  return ls.length > 0;
}
export const charFrames = (id, action) => Math.max(0, ...charLayers(id, action).map((l) => frames(l.name)));
