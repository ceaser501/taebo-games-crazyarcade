// The screens before the game, built like the other taebo games (worms, puyo puyo): an intro to
// tap through (which also unlocks sound), a one-time nickname on the first visit (that is the
// whole sign-up; the name stays on this phone), and the home card with my character, record
// and lucci, from which "게임하러 가기" opens the lobby.
import * as A from './assets.js';
import { playMusic, sfx, toggleMusic, musicOn } from './audio.js';
import { CHARACTERS, charById } from './shared/const.js';
import * as W from './wallet.js';

const $ = (id) => document.getElementById(id);
const INTRO_CHARS = ['C00', 'C06', 'C01', 'C04', 'C05'];
let anim = 0;

// Draws a character (and the hat it wears) onto a small canvas, anchored bottom-centre.
function figure(cv, id, action, frame, scale, look = null) {
  const c = cv.getContext('2d');
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, cv.width, cv.height);
  c.imageSmoothingEnabled = false;
  c.setTransform(scale, 0, 0, scale, 0, 0);
  const ax = cv.width / scale / 2 - 20, ay = cv.height / scale - 4;
  c.fillStyle = 'rgba(0,0,0,0.25)'; c.beginPath(); c.ellipse(ax + 20, ay - 2, 15, 4.5, 0, 0, Math.PI * 2); c.fill();
  if (look?.pet && A.frames(`Pet/${look.pet}_WalkingDown`)) A.draw(c, `Pet/${look.pet}_WalkingDown`, frame, ax + 30, ay + 2);
  A.drawChar(c, id, action, frame, ax, ay, 0);
  if (look?.hat && action.startsWith('Walk') && A.frames(`CharDeco/CharDeco_${look.hat}Down`)) A.draw(c, `CharDeco/CharDeco_${look.hat}Down`, frame, ax, ay);
}

// ---- intro
export function showIntro() {
  $('intro').hidden = false;
  const cv = $('intro-chars');
  const loop = (now) => {
    if ($('intro').hidden) return;
    const c = cv.getContext('2d');
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, cv.width, cv.height); c.imageSmoothingEnabled = false;
    // Five characters bounce in a row, each a beat after the other, with balloons between them.
    INTRO_CHARS.forEach((id, i) => {
      const t = now / 1000 - i * 0.18;
      const hop = Math.max(0, Math.sin(t * 4.2)) * 16;
      const x = 20 + i * 80, y = 140 - hop;
      c.save(); c.translate(x, y); c.scale(1.6, 1.6);
      const n = A.charFrames(id, 'Hurrah');
      A.drawChar(c, id, n ? 'Hurrah' : 'WalkDown', Math.floor(now / 140) % Math.max(1, n || 1), -8, 0, i);
      c.restore();
      if (i < 4) A.draw(c, 'Bomb/Bomb00', Math.floor(now / 140) % Math.max(1, A.frames('Bomb/Bomb00')), x + 48, 146);
    });
    anim = requestAnimationFrame(loop);
  };
  anim = requestAnimationFrame(loop);
}
export function introReady(onTap) {
  $('intro-tap').textContent = '화면을 터치해서 시작';
  $('intro').classList.add('ready');
  let done = false;
  const go = () => {
    if (done) return;
    done = true; cancelAnimationFrame(anim);
    $('intro').hidden = true;
    onTap();
  };
  $('intro').addEventListener('click', go); // click, not pointerup: a pointerup would let the same tap's click land on the home screen's buttons
  window.addEventListener('keydown', (e) => { if (!$('intro').hidden && (e.key === 'Enter' || e.key === ' ')) go(); });
}

// ---- first visit: a nickname
export function askName(onDone) {
  $('signup').hidden = false;
  const input = $('signup-name');
  setTimeout(() => input.focus(), 50);
  $('signup-form').onsubmit = (e) => {
    e.preventDefault();
    const name = input.value.trim().slice(0, 10);
    if (!name) { input.focus(); return; }
    $('signup').hidden = true;
    sfx('Bt_c_Success', 0.7);
    onDone(name);
  };
}

// ---- home
export function showHome(app) {
  $('home').hidden = false;
  playMusic('StageLogin');
  const ch = W.myChar();
  $('home-name').value = app.name;
  $('home-charname').textContent = charById(ch).name;
  const st = W.stats();
  $('home-lucci').textContent = `${W.lucci().toLocaleString()}`;
  $('home-record').textContent = st.games ? `${st.wins}승 ${st.games - st.wins - st.draws}패${st.draws ? ` ${st.draws}무` : ''}` : '아직 없음';
  $('home-rate').textContent = st.games ? `${Math.round((st.wins / st.games) * 100)}%` : '-';
  $('home-kills').textContent = `${st.kills}`;
  const look = W.look();
  Promise.all([A.loadGroup(`char_${ch}`), W.loadLook(look)]).then(() => {
    const cv = $('home-char');
    const loop = (now) => {
      if ($('home').hidden) return;
      const n = A.charFrames(ch, 'WalkDown');
      figure(cv, ch, 'WalkDown', n > 1 ? 1 + (Math.floor(now / 160) % (n - 1)) : 0, 2.5, look);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
  $('home-name').onchange = () => {
    const name = $('home-name').value.trim().slice(0, 10);
    if (name) app.setName(name); else $('home-name').value = app.name;
  };
  $('home-play').onclick = () => { sfx('Bt_c_Pop', 0.6); app.toMenu(); };
  $('home-shop').onclick = () => { sfx('Bt_c_Pop', 0.6); app.toShop('home'); };
  $('home-chars').onclick = $('home-figure').onclick = () => pickChar(app, () => showHome(app));
  const music = () => { $('home-music').textContent = musicOn() ? '♪ 배경음악 켜짐' : '♪ 배경음악 꺼짐'; $('home-music').classList.toggle('off', !musicOn()); };
  music();
  $('home-music').onclick = () => { toggleMusic(); music(); };
}
export function hideHome() { $('home').hidden = true; $('char-pick').hidden = true; }
export const isHomeShown = () => !$('home').hidden;

// Character choice; done() runs after a pick.
export function pickChar(app, done) {
  sfx('Bt_c_Pop', 0.6);
  const grid = $('char-grid');
  grid.textContent = '';
  for (const ch of CHARACTERS) {
    const owned = W.owns('char', ch.id);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = (ch.id === W.myChar() ? 'sel ' : '') + (owned ? '' : 'locked');
    const cv = document.createElement('canvas');
    cv.width = 56; cv.height = 54;
    b.append(cv, document.createTextNode(owned ? ch.name : `🔒 ${ch.name}`));
    A.loadGroup(`char_${ch.id}`).then(() => {
      const c = cv.getContext('2d'); c.imageSmoothingEnabled = false;
      A.drawChar(c, ch.id, 'Portrait', 0, 5, 5, 0);
    });
    b.onclick = () => {
      if (!owned) { app.toast(`${ch.name}은(는) 상점에서 살 수 있어요.`); return; }
      sfx('Bt_c_Pop', 0.6);
      W.setChar(ch.id);
      $('char-pick').hidden = true;
      done(ch.id);
    };
    grid.append(b);
  }
  $('char-close').onclick = () => { $('char-pick').hidden = true; };
  $('char-pick').hidden = false;
}
