// Rank icons (16×14, put together from the client's parts) and the level-up celebration.
import * as A from './assets.js';
import { sfx } from './audio.js';
import { rankParts } from './shared/level.js';

export const RANK_W = 16, RANK_H = 14;

// Draws the icon for a level with its top-left at (x, y), `scale` times its size.
export function drawRank(c, level, x, y, scale = 1) {
  if (!level) return false;
  c.save();
  c.translate(x, y); c.scale(scale, scale);
  c.imageSmoothingEnabled = false;
  const parts = rankParts(level);
  const ok = parts ? parts.every((f) => A.draw(c, 'Etc/LevelIcons', f, 0, 0)) : A.draw(c, 'Level/Novice_LevelIcon', 0, 0, 0);
  c.restore();
  return ok;
}

// A small canvas showing a level's icon (for the DOM screens).
export function rankCanvas(level, scale = 2) {
  const cv = document.createElement('canvas');
  cv.width = RANK_W * scale; cv.height = RANK_H * scale;
  cv.className = 'rank';
  cv.title = `Lv.${level}`;
  A.loadGroup('rank').then(() => drawRank(cv.getContext('2d'), level, 0, 0, scale));
  return cv;
}

// The sunburst is drawn on black; its brightness becomes its opacity so it glows over anything.
let burst = null;
function sunburst() {
  if (burst) return burst;
  const [w, h] = A.size('UXMatching/LevelUp');
  if (!w) return null;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const c = cv.getContext('2d');
  A.drawAt(c, 'UXMatching/LevelUp', 0, 0, 0);
  const img = c.getImageData(0, 0, w, h), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const m = Math.max(d[i], d[i + 1], d[i + 2]);
    d[i + 3] = (d[i + 3] * m) / 255;
    if (m) { d[i] = (d[i] * 255) / m; d[i + 1] = (d[i + 1] * 255) / m; d[i + 2] = (d[i + 2] * 255) / m; }
  }
  c.putImageData(img, 0, 0);
  return (burst = cv);
}

// Level up: the client's LEVEL UP badge drops in over a turning sunburst, then the new rank
// icon and level; a tap (or a few seconds) closes it.
export function celebrate(from, to) {
  const box = document.getElementById('levelup');
  const cv = document.getElementById('levelup-canvas');
  A.loadGroup('rank').then(() => {
    box.hidden = false;
    sfx('RPG_LevelUp');
    const t0 = performance.now();
    let done = false;
    const close = () => { if (done) return; done = true; box.hidden = true; };
    box.onclick = close;
    setTimeout(close, 6000);
    const loop = (now) => {
      if (done) return;
      const t = (now - t0) / 1000;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = cv.clientWidth, h = cv.clientHeight;
      if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
      const c = cv.getContext('2d');
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, w, h);
      c.imageSmoothingEnabled = false;
      const cx = w / 2, s = Math.min(1.3, (h * 0.58) / 371, (w * 0.8) / 302);
      // The sunburst, turning slowly behind everything.
      const sun = sunburst();
      if (sun) {
        c.save();
        c.translate(cx, h * 0.4); c.rotate(t * 0.6);
        const sb = s * 2.4 * Math.min(1, t * 3);
        c.globalAlpha = 0.85;
        c.drawImage(sun, -113 * sb, -113 * sb, 226 * sb, 226 * sb);
        c.restore();
      }
      // The badge drops in with a bounce.
      const k = Math.min(1, t / 0.45), bounce = k < 1 ? 1 - Math.pow(1 - k, 3) * Math.cos(k * 9) : 1;
      const bs = s * (0.4 + 0.6 * bounce);
      A.drawAt(c, 'Dialog/LayerPopUp_LevelUp', 0, cx - 151 * bs, h * 0.4 - 185 * bs, 302 * bs, 371 * bs);
      // The new rank and level side by side below the badge, once it has landed.
      if (t > 0.5) {
        c.globalAlpha = Math.min(1, (t - 0.5) * 3);
        c.font = `900 ${Math.round(24 * Math.max(0.8, s))}px "Nanum Gothic", sans-serif`;
        c.textAlign = 'left';
        const txt = `Lv.${from} → Lv.${to}`, tw = c.measureText(txt).width;
        const is = Math.max(3, Math.round(s * 3.5)), iw = RANK_W * is, ih = RANK_H * is;
        const left = cx - (iw + 12 + tw) / 2, base = h * 0.9;
        drawRank(c, to, left, base - ih * 0.8, is);
        c.lineWidth = 5; c.strokeStyle = '#0b2f78'; c.fillStyle = '#ffe95a';
        c.strokeText(txt, left + iw + 12, base); c.fillText(txt, left + iw + 12, base);
        c.globalAlpha = 1;
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
}
