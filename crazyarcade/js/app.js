// Crazy Arcade for phones: screens, connection and the frame loop.
import * as A from './assets.js';
import { stage, ui, onResize } from './stage.js';
import * as input from './input.js';
import { unlock, preload, stopMusic } from './audio.js';
import { LobbyScene, RoomScene } from './scene-menus.js';
import { showIntro, introReady, askName, showHome, hideHome } from './home.js';
import { GameScene } from './scene-game.js';
import { ShopScene } from './scene-shop.js';
import * as W from './wallet.js';
import { Online, Practice, listRooms, randomCode } from './net.js';

// `SITE_PASSWORD=... npm run build` puts a simple password screen in front (hash only).
/* global PASSWORD_HASH */
const HASH = typeof PASSWORD_HASH !== 'undefined' ? PASSWORD_HASH : '';

const $ = (id) => document.getElementById(id);

const app = {
  scene: null, conn: null, room: null, me: null, name: '', roomTitle: '', practiceMode: false,

  setScene(s) {
    if (this.scene && this.scene.leave) this.scene.leave();
    this.scene = s;
    // The 800×600 canvas screens want the phone sideways; the home screen works either way.
    document.body.classList.toggle('canvas-mode', !(s instanceof HomeBackdrop));
    if (!(s instanceof HomeBackdrop)) { hideHome(); landscape(); }
    if (s.layout) s.layout();
  },
  setName(n) { this.name = n.slice(0, 10); try { localStorage.setItem('ca-name', this.name); } catch { /* ignore */ } },
  toast(msg) {
    const t = $('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(this.toastTimer); this.toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  },
  isHost() { return this.room && this.room.host === this.me; },

  toHome() { this.disconnect(); this.setScene(new HomeBackdrop()); showHome(this); },
  // The shop opens over the home screen, the lobby or the waiting room and goes back to it.
  toShop() {
    const from = this.conn ? 'room' : this.scene instanceof LobbyScene ? 'lobby' : 'home';
    const back = () => (from === 'room' && this.conn ? this.setScene(new RoomScene(this)) : from === 'lobby' ? this.toLobby() : this.toHome());
    this.setScene(new ShopScene(this, back, W.myChar()));
  },
  lookChanged() { if (this.conn) this.send({ t: 'set', look: W.look() }); },
  toLobby() { this.disconnect(); this.setScene(new LobbyScene(this)); },
  listRooms() { return listRooms(); },

  async createRoom() {
    let rooms = [];
    try { rooms = await listRooms(); } catch { /* server unreachable: still try */ }
    let code;
    for (let i = 0; i < 20; i++) { code = randomCode(); if (!rooms.some((r) => r.code === code)) break; }
    this.joinRoom(code);
  },
  joinRoom(code) { this.connect(new Online(code, this.name), false); },
  practice() { this.connect(new Practice(this.name || '나'), true); },

  connect(conn, practice) {
    this.disconnect();
    this.conn = conn; this.practiceMode = practice; this.room = null; this.me = null;
    conn.on((m) => this.onMessage(m));
    this.setScene(new RoomScene(this));
  },
  disconnect() {
    if (this.conn) this.conn.close();
    this.conn = null; this.room = null; this.me = null;
    $('chat-log').textContent = '';
  },
  leaveRoom() {
    const practice = this.practiceMode;
    this.disconnect();
    stopMusic();
    if (practice) this.toHome(); else this.toLobby();
  },
  send(m) { if (this.conn) this.conn.send(m); },

  onMessage(m) {
    switch (m.t) {
      case 'welcome': {
        this.me = m.you; this.room = m.room; this.roomTitle = m.room.title;
        // Wear our decorations; trade a character we do not own for a free one.
        const mine = m.room.members.find((x) => x.id === m.you);
        const set = { t: 'set', look: W.look(), char: W.myChar() };
        this.send(set);
        break;
      }
      case 'room':
        this.room = m.room; this.roomTitle = m.room.title;
        break;
      case 'start':
        if (this.scene instanceof ShopScene) this.toast('게임이 시작됐어요!');
        this.setScene(new GameScene(this, this.conn, m, this.me));
        break;
      case 'back':
        this.setScene(new RoomScene(this));
        break;
      case 's':
        if (this.scene instanceof GameScene) this.scene.onMessage(m);
        break;
      case 'chat': {
        const log = $('chat-log');
        const line = document.createElement('div');
        if (m.name) { const b = document.createElement('b'); b.textContent = m.name + ' : '; line.append(b); } else line.className = 'sys';
        line.append(document.createTextNode(m.text));
        log.append(line);
        while (log.children.length > 40) log.firstChild.remove();
        log.scrollTop = log.scrollHeight;
        break;
      }
      case 'notice': this.toast(m.text); break;
      case 'error': this.toast(m.text === 'full' ? '방이 꽉 찼습니다.' : m.text === 'playing' ? '게임 중인 방입니다.' : m.text); this.toLobby(); break;
      case 'kicked': this.toast('방장이 내보냈습니다.'); this.toLobby(); break;
      case 'lost': this.toast('서버와 연결이 끊겼습니다.'); this.toLobby(); break;
    }
  },
};
window.caApp = app;

// What the canvas shows behind the home screen (a DOM overlay).
class HomeBackdrop { draw() { const c = stage.begin(); c.fillStyle = '#0b3f8f'; c.fillRect(0, 0, 800, 600); } }

// On phones, going into the canvas screens asks for full screen held sideways.
function landscape() {
  if (!matchMedia('(pointer: coarse)').matches || !document.documentElement.requestFullscreen || document.fullscreenElement) return;
  document.documentElement.requestFullscreen({ navigationUI: 'hide' }).then(() => screen.orientation?.lock?.('landscape').catch(() => {})).catch(() => {});
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
  app.setScene(new HomeBackdrop());
  requestAnimationFrame(frame);
  showIntro();
  await A.loadManifest();
  if (!A.ready) app.toast('에셋이 변환되지 않았습니다 (npm run ca:assets).');
  await Promise.all([A.loadGroup('game'), A.loadGroup('ui'), ...['C00', 'C06', 'C01', 'C04', 'C05'].map((c) => A.loadGroup(`char_${c}`))]);
  // ?room=1234 in a shared link opens that room directly (after the nickname on a first visit).
  const code = new URLSearchParams(location.search).get('room');
  introReady(() => {
    first();
    const go = () => (code ? app.joinRoom(code) : app.toHome());
    if (app.name) go(); else askName((name) => { app.setName(name); go(); });
  });
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('/sw.js').catch(() => {});
}

main();
