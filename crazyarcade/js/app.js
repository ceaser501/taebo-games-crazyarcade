// Crazy Arcade for phones: screens, connection and the frame loop.
import * as A from './assets.js';
import { stage, ui, onResize } from './stage.js';
import * as input from './input.js';
import { unlock, preload, stopMusic } from './audio.js';
import { showIntro, introReady, askName, showHome, hideHome, isHomeShown, homeRank } from './home.js';
import { showMenu, hideMenu, showLobby, hideLobby, renderLobby, lobbyShown, lobbyStatus } from './lobby.js';
import { GameScene } from './scene-game.js';
import { showShop, hideShop } from './shop.js';
import * as W from './wallet.js';
import { Online, Practice, listRooms, randomCode } from './net.js';
import * as Account from './account.js';
import { celebrate } from './rank.js';

// `SITE_PASSWORD=... npm run build` puts a simple password screen in front (hash only).
/* global PASSWORD_HASH */
const HASH = typeof PASSWORD_HASH !== 'undefined' ? PASSWORD_HASH : '';

const $ = (id) => document.getElementById(id);

// Screens: the DOM ones (home, menu, waiting room) over a plain canvas, and the canvas ones
// (game, shop). Only the game wants the phone sideways with room for the touch controls.
const app = {
  scene: null, conn: null, room: null, me: null, name: '', roomTitle: '', practiceMode: false,

  setScene(s) {
    if (this.scene && this.scene.leave) this.scene.leave();
    this.scene = s;
    const canvas = !(s instanceof Backdrop);
    document.body.classList.toggle('canvas-mode', canvas);
    stage.setMode(s instanceof GameScene ? 'css' : 'fit');
    if (canvas) { hideHome(); hideMenu(); hideLobby(); hideShop(); }
    if (s instanceof GameScene) landscape();
    if (s.layout) s.layout();
  },
  setName(n) { this.name = n.slice(0, 10); try { localStorage.setItem('ca-name', this.name); } catch { /* ignore */ } },
  toast(msg) {
    const t = $('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(this.toastTimer); this.toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  },
  isHost() { return this.room && this.room.host === this.me; },
  dom(show) { this.setScene(new Backdrop()); hideHome(); hideMenu(); hideLobby(); hideShop(); show(); },

  toHome() { this.disconnect(); this.dom(() => showHome(this)); },
  toMenu(status) { this.disconnect(); this.dom(() => showMenu(this, status)); },
  // The shop opens over the home screen, the menu or the waiting room and goes back to it.
  toShop(from) {
    const back = () => (from === 'lobby' && this.conn ? this.dom(() => showLobby(this)) : from === 'menu' ? this.toMenu() : this.toHome());
    this.dom(() => showShop(this, back));
  },
  lookChanged() { if (this.conn) this.send({ t: 'set', look: W.look() }); },

  // A new room number nobody is using.
  async hostRoom() {
    let rooms = [];
    try { rooms = await listRooms(); } catch { /* server unreachable: still try */ }
    let code;
    for (let i = 0; i < 20; i++) { code = randomCode(); if (!rooms.some((r) => r.code === code)) break; }
    this.joinRoom(code);
  },
  joinRoom(code) {
    this.connect(new Online(code, this.name, Account.token()), false);
    this.dom(() => showLobby(this));
    lobbyStatus('방에 연결하는 중…');
  },
  // Practice: a room in this page with computer players, started at once.
  practice(opts) { this.connect(new Practice(this.name || '나', { ...opts, exp: Account.signedIn() ? Account.exp() : null }), true); },

  connect(conn, practice) {
    this.disconnect();
    this.conn = conn; this.practiceMode = practice; this.room = null; this.me = null;
    conn.on((m) => this.onMessage(m));
  },
  disconnect() {
    if (this.conn) this.conn.close();
    this.conn = null; this.room = null; this.me = null;
  },
  leaveRoom() { stopMusic(); this.toMenu(); this.showLevelUp(); },
  // A level reached during a round is celebrated once back out of it.
  showLevelUp() {
    if (!this.levelUp || this.scene instanceof GameScene) return;
    const { from, to } = this.levelUp;
    this.levelUp = null;
    const r = Account.rank(), me = this.room?.members?.find((m) => m.id === this.me);
    setTimeout(() => celebrate({ from, to, char: W.myChar(), color: me ? me.color : 0, name: Account.name(), next: r.need ? r.need - r.into : 0 }), 300);
  },
  send(m) { if (this.conn) this.conn.send(m); },

  onMessage(m) {
    switch (m.t) {
      case 'welcome':
        this.me = m.you; this.room = m.room; this.roomTitle = m.room.title;
        // Our character and decorations.
        this.send({ t: 'set', look: W.look(), char: W.myChar() });
        renderLobby(this);
        break;
      case 'room':
        this.room = m.room; this.roomTitle = m.room.title;
        renderLobby(this);
        break;
      case 'start':
        if (!document.getElementById('shop').hidden) this.toast('게임이 시작됐어요!');
        this.setScene(new GameScene(this, this.conn, m, this.me));
        break;
      case 'back':
        // After a round: friends go back to the waiting room, practice back to the menu.
        if (this.practiceMode) this.toMenu(); else this.dom(() => showLobby(this));
        this.showLevelUp();
        break;
      case 'exp':
        // Experience the room server gave for the round.
        Account.gotExp(m);
        if (this.scene instanceof GameScene) { this.scene.expGained = m.gained; this.scene.paid = m.lucci; }
        break;
      case 's':
        if (this.scene instanceof GameScene) this.scene.onMessage(m);
        break;
      case 'chat':
        // Joins and leaves show briefly in the waiting room.
        if (!m.name && lobbyShown()) lobbyStatus(m.text);
        break;
      case 'notice': this.toast(m.text); break;
      case 'error': this.toMenu(m.text === 'full' ? '방이 꽉 찼어요.' : m.text === 'playing' ? '게임 중인 방이에요. 끝나면 다시 들어와 주세요.' : m.text); break;
      case 'kicked': this.toMenu('방장이 내보냈어요.'); break;
      case 'lost': this.toMenu('서버와 연결이 끊겼어요.'); break;
    }
  },
};
window.caApp = app;

// What the canvas shows behind the DOM screens.
class Backdrop { draw() { const c = stage.begin(); c.fillStyle = '#0b3f8f'; c.fillRect(0, 0, 800, 600); } }

// Phones play full screen held sideways from the intro tap on, as in the other taebo games, and
// ask again on the next button press if they dropped out of it. iPhones cannot do that from a
// page: opened from a home screen icon (Share → 홈 화면에 추가) they already are full screen.
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || navigator.standalone === true;
const canFullscreen = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
async function landscape() {
  if (!matchMedia('(pointer: coarse)').matches || !canFullscreen || standalone || document.fullscreenElement || document.webkitFullscreenElement) return;
  const el = document.documentElement;
  try {
    await (el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : el.webkitRequestFullscreen());
    await screen.orientation?.lock?.('landscape');
  } catch { /* the browser said no; play on as is */ }
}

// Installing: Android browsers offer a prompt opened from a button; iPhones need Share → 홈 화면에 추가.
function installing() {
  let prompt = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); prompt = e; $('install').hidden = false; });
  $('install').onclick = async () => {
    if (!prompt) return;
    prompt.prompt();
    await prompt.userChoice.catch(() => null);
    prompt = null;
    $('install').hidden = true;
  };
  window.addEventListener('appinstalled', () => { $('install').hidden = true; });
  if (isIOS && !standalone) {
    $('ios-add').hidden = false;
    $('ios-add').onclick = () => { $('ios-guide').hidden = false; };
    $('ios-close').onclick = () => { $('ios-guide').hidden = true; };
  }
}

function frame(now) {
  if (app.scene) app.scene.draw(now);
  requestAnimationFrame(frame);
}

function kakaoEscape() {
  // KakaoTalk's in-app browser cannot go full screen; hand the page to the real browser.
  if (/KAKAOTALK/i.test(navigator.userAgent)) location.href = 'kakaotalk://web/openExternal?url=' + encodeURIComponent(location.href);
}

async function sha256(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

async function gate() {
  if (!HASH) return;
  try { if (localStorage.getItem('ca-pass') === HASH) return; } catch { /* ignore */ }
  const box = $('gate'); box.hidden = false;
  await new Promise((resolve) => {
    $('gate-form').onsubmit = async (e) => {
      e.preventDefault();
      if ((await sha256($('gate-pass').value)) === HASH) { try { localStorage.setItem('ca-pass', HASH); } catch { /* ignore */ } box.hidden = true; resolve(); }
      else $('gate-pass').value = '';
    };
  });
}

async function main() {
  kakaoEscape();
  await gate();
  try { app.name = localStorage.getItem('ca-name') || ''; } catch { /* ignore */ }
  if (Account.signedIn()) app.name = Account.name();
  Account.onChange(({ before, after, quiet }) => {
    if (Account.signedIn()) app.name = Account.name();
    if (isHomeShown()) homeRank(app);
    if (!quiet && after > before) { app.levelUp = { from: app.levelUp ? app.levelUp.from : before, to: after }; app.showLevelUp(); }
  });
  const canvas = $('game');
  stage.init(canvas);
  input.attach(canvas);
  ui.init(canvas);
  onResize(() => app.scene && app.scene.layout && app.scene.layout());
  const first = () => {
    unlock();
    preload(['Cha_BombIgnite', 'Cha_BombExplode', 'Cha_LockedIn', 'Cha_Die', 'Cha_Release', 'Itm_ItemEaten', 'Bt_c_Pop']);
  };
  window.addEventListener('pointerdown', first);
  window.addEventListener('keydown', first);
  app.setScene(new Backdrop());
  requestAnimationFrame(frame);
  showIntro();
  await A.loadManifest();
  if (!A.ready) app.toast('에셋이 변환되지 않았습니다 (npm run ca:assets).');
  await Promise.all([A.loadGroup('game'), A.loadGroup('ui'), ...['C00', 'C06', 'C01', 'C04', 'C05'].map((c) => A.loadGroup(`char_${c}`))]);
  // ?room=1234 in a shared link opens that room directly (after the nickname on a first visit).
  const code = new URLSearchParams(location.search).get('room');
  installing();
  if (matchMedia('(pointer: coarse)').matches) {
    for (const id of ['home-play', 'practice-start', 'host', 'join', 'lobby-start']) $(id).addEventListener('click', landscape);
  }
  introReady(() => {
    landscape();
    first();
    const go = () => { document.body.classList.add('sideways'); return code ? app.joinRoom(code) : app.toHome(); };
    // Signed in: straight on (the account is read again in the background). Otherwise the
    // nickname and PIN, filled in with the name used on this phone before accounts.
    const signUp = () => askName(app.name, (offline, created) => {
      if (offline) { const n = $('signup-name').value.trim().slice(0, 10) || app.name || '플레이어'; app.setName(n); } else app.setName(Account.name());
      if (!offline && created) W.bringIn(); // a new account keeps what this phone had
      go();
    });
    if (Account.signedIn()) {
      go();
      Account.refresh().then((r) => { if (r === 'gone') { Account.signOut(); signUp(); } });
    } else signUp();
  });
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('/sw.js').catch(() => {});
}

main();
