// Crazy Arcade for phones: screens, connection and the frame loop.
import * as A from './assets.js';
import { stage, ui, onResize } from './stage.js';
import * as input from './input.js';
import { unlock, preload, stopMusic } from './audio.js';
import { LoginScene, LobbyScene, RoomScene } from './scene-menus.js';
import { GameScene } from './scene-game.js';
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
    if (s.layout) s.layout();
  },
  setName(n) { this.name = n.slice(0, 10); try { localStorage.setItem('ca-name', this.name); } catch { /* ignore */ } },
  toast(msg) {
    const t = $('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(this.toastTimer); this.toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  },
  isHost() { return this.room && this.room.host === this.me; },

  toLogin() { this.disconnect(); this.setScene(new LoginScene(this)); },
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
    if (practice) this.toLogin(); else this.toLobby();
  },
  send(m) { if (this.conn) this.conn.send(m); },

  onMessage(m) {
    switch (m.t) {
      case 'welcome': this.me = m.you; this.room = m.room; this.roomTitle = m.room.title; break;
      case 'room':
        this.room = m.room; this.roomTitle = m.room.title;
        break;
      case 'start':
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
    if (matchMedia('(pointer: coarse)').matches && document.documentElement.requestFullscreen && !document.fullscreenElement) {
      document.documentElement.requestFullscreen({ navigationUI: 'hide' }).then(() => screen.orientation?.lock?.('landscape').catch(() => {})).catch(() => {});
    }
  };
  window.addEventListener('pointerdown', first);
  window.addEventListener('keydown', first);
  await A.loadManifest();
  if (!A.ready) app.toast('에셋이 변환되지 않았습니다 (npm run ca:assets).');
  // ?room=1234 in a shared link opens that room directly.
  const code = new URLSearchParams(location.search).get('room');
  app.setScene(new LoginScene(app));
  if (code && app.name) app.joinRoom(code);
  requestAnimationFrame(frame);
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('/sw.js').catch(() => {});
}

main();
