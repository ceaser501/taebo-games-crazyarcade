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

// Level up: the player's own character cheers on a spot with rays turning behind it, the old
// rank on the left and the new one popping in on the right; a tap (or a few seconds) closes it.
// info: { from, to, char, color, name, next } (next: experience still needed for the level after).
export function celebrate(info) {
  const { from, to, char, color = 0, name = '', next = 0 } = info;
  const box = document.getElementById('levelup');
  const cv = document.getElementById('levelup-canvas');
  Promise.all([A.loadGroup('rank'), A.loadGroup(`char_${char}`)]).then(() => {
    box.hidden = false;
    sfx('RPG_LevelUp');
    const t0 = performance.now();
    let done = false;
    const close = () => { if (done) return; done = true; box.hidden = true; };
    box.onclick = close;
    setTimeout(close, 7000);
    const hurrah = Math.max(1, A.charFrames(char, 'Hurrah'));
    const stars = Array.from({ length: 10 }, (_, i) => ({ x: (i * 0.137 + 0.08) % 1, y: ((i * 0.29) % 0.8) + 0.08, r: 7 + (i % 4) * 3, c: ['#ffd23a', '#ff7ab6', '#7fe0ff', '#9cff7a', '#ffffff'][i % 5], p: i }));
    const star = (c, x, y, r) => { c.beginPath(); for (let i = 0; i < 10; i++) { const a = (i * Math.PI) / 5 - Math.PI / 2, rr = i % 2 ? r * 0.45 : r; c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } c.fill(); };
    const loop = (now) => {
      if (done) return;
      const t = (now - t0) / 1000;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = cv.clientWidth, h = cv.clientHeight;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
      const c = cv.getContext('2d');
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, w, h);
      c.imageSmoothingEnabled = false;
      const u = Math.min(w / 844, h / 390) || 1, cx = w / 2;
      // Rays turning slowly.
      c.save(); c.translate(cx, h * 0.55); c.rotate(t * 0.25);
      for (let i = 0; i < 18; i++) { c.rotate(Math.PI / 9); c.fillStyle = i % 2 ? 'rgba(255,240,150,.16)' : 'rgba(255,255,255,.07)'; c.beginPath(); c.moveTo(0, 0); c.lineTo(w, -w * 0.12); c.lineTo(w, w * 0.12); c.fill(); }
      c.restore();
      // Twinkling stars.
      for (const s of stars) { c.globalAlpha = 0.45 + 0.55 * Math.abs(Math.sin(t * 2 + s.p)); c.fillStyle = s.c; star(c, s.x * w, s.y * h, s.r * u); }
      c.globalAlpha = 1;
      // LEVEL UP! drops in.
      const k = Math.min(1, t / 0.5), drop = (1 - Math.pow(1 - k, 3)) * (k < 1 ? 1 : 1 + 0.03 * Math.sin(t * 5));
      c.save(); c.translate(cx, h * 0.18); c.scale(drop, drop);
      c.font = `900 ${Math.round(54 * u)}px "Nanum Gothic", sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.lineJoin = 'round'; c.lineWidth = 12 * u; c.strokeStyle = '#0b2f78'; c.strokeText('LEVEL UP!', 0, 0);
      const gr = c.createLinearGradient(0, -24 * u, 0, 24 * u); gr.addColorStop(0, '#fff6a0'); gr.addColorStop(1, '#ff9a00');
      c.fillStyle = gr; c.fillText('LEVEL UP!', 0, 0);
      c.restore();
      c.font = `800 ${Math.round(15 * u)}px "Nanum Gothic", sans-serif`; c.textAlign = 'center'; c.fillStyle = '#fff';
      c.fillText(`${name ? `${name}님 ` : ''}축하해요!${next ? ` 다음 계급까지 경험치 ${next}` : ''}`, cx, h * 0.29);
      // The character cheering on a glowing spot.
      const cs = 2.7 * u;
      c.fillStyle = 'rgba(255,240,150,.35)'; c.beginPath(); c.ellipse(cx, h * 0.8, 70 * u, 15 * u, 0, 0, Math.PI * 2); c.fill();
      c.save(); c.translate(cx - 20 * cs, h * 0.81 - Math.abs(Math.sin(t * 4)) * 6 * u); c.scale(cs, cs);
      A.drawChar(c, char, 'Hurrah', Math.floor(t * 7) % hurrah, 0, 0, color);
      c.restore();
      // Old rank -> new rank.
      const plate = (x, y, lv, big, a, sc) => {
        c.save(); c.globalAlpha = a; c.translate(x, y); c.scale(sc, sc);
        const s = (big ? 4 : 3) * u, pw = 100 * u, ph = 92 * u;
        c.fillStyle = big ? 'rgba(255,233,90,.22)' : 'rgba(0,0,0,.35)'; c.beginPath(); c.roundRect(-pw / 2, -ph / 2, pw, ph, 14 * u); c.fill();
        if (big) { c.strokeStyle = '#ffe95a'; c.lineWidth = 3 * u; c.stroke(); }
        drawRank(c, lv, -8 * s, -7 * s - 10 * u, s);
        c.font = `900 ${Math.round(18 * u)}px "Nanum Gothic", sans-serif`; c.textAlign = 'center'; c.textBaseline = 'alphabetic';
        c.lineWidth = 5 * u; c.strokeStyle = '#0b2f78'; c.strokeText(`Lv.${lv}`, 0, 36 * u); c.fillStyle = big ? '#ffe95a' : '#cfe8ff'; c.fillText(`Lv.${lv}`, 0, 36 * u);
        c.restore();
      };
      const pop = t < 0.7 ? 0 : Math.min(1, (t - 0.7) / 0.35), bounce = pop < 1 ? 0.3 + 0.7 * pop + Math.sin(pop * Math.PI) * 0.25 : 1;
      plate(cx - 210 * u, h * 0.58, from, false, Math.min(1, t * 3), 1);
      c.font = `900 ${Math.round(30 * u)}px sans-serif`; c.fillStyle = '#ffe95a'; c.textAlign = 'center';
      c.globalAlpha = Math.min(1, t * 2); c.fillText('➜', cx - 120 * u, h * 0.6); c.globalAlpha = pop; c.fillText('➜', cx + 120 * u, h * 0.6); c.globalAlpha = 1;
      if (pop > 0) plate(cx + 210 * u, h * 0.58, to, true, Math.min(1, pop * 2), bounce);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
}
