// The 대기실 (channel), as in the client: the open rooms as cards (tap one to go in), 바로시작 /
// 방만들기 / 혼자놀기, who is on, and the lobby chat. The Lobby server keeps it live (LobbyFeed);
// my own character and records at the left are drawn by home.js.
import * as A from './assets.js';
import { sfx } from './audio.js';
import * as Account from './account.js';
import { LobbyFeed, randomCode } from './net.js';
import { drawRank } from './rank.js';
import { RANDOM_MAP } from './shared/room.js';
import { mapById, mapThumb } from './map-pick.js';
import { showPractice } from './lobby.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => Object.assign(document.createElement(tag), cls ? { className: cls } : {}, text != null ? { textContent: text } : {});
const click = () => sfx('Bt_c_Pop', 0.6);
const PER = 6; // cards on a page
const BUTTONS = { 'ch-quick': 'Lobby/LB_Bt_T_QuickJoinRenew', 'ch-create': 'Lobby/LB_Bt_T_CreateRenew', 'ch-practice': 'Lobby/LB_Bt_T_PracticeRenew' };

let app = null, feed = null, tab = 'all', page = 0, wired = false;
let rooms = [], users = [], lines = [];

export function showChannel(a) {
  app = a;
  A.loadGroup('ui').then(() => {
    for (const [id, sprite] of Object.entries(BUTTONS)) {
      const cv = $(id).querySelector('canvas'), c = cv.getContext('2d');
      c.clearRect(0, 0, cv.width, cv.height); A.drawAt(c, sprite, 0, 0, 0);
    }
  });
  wire();
  if (!feed) {
    feed = new LobbyFeed(app.name, Account.token());
    feed.on(onFeed);
  }
  renderRooms(); renderUsers(); renderChat();
}
export function hideChannel() {
  if (feed) { feed.close(); feed = null; }
  $('ch-chat').classList.remove('open');
}
export const channelRooms = () => rooms;

function onFeed(m) {
  if (m.t === 'hello') { rooms = m.rooms || []; users = m.users || []; lines = m.chat || []; renderRooms(); renderUsers(); renderChat(); }
  if (m.t === 'rooms') { rooms = m.rooms || []; if (m.users) users = m.users; renderRooms(); renderUsers(); }
  if (m.t === 'users') { users = m.users || []; renderUsers(); }
  if (m.t === 'chat') { lines.push({ name: m.name, text: m.text }); if (lines.length > 60) lines.shift(); renderChat(true); }
  if (m.t === 'notice' && app) app.toast(m.text);
}

// ---- the room cards
const shown = () => rooms.filter((r) => (tab === 'wait' ? !r.playing && r.players < r.seats : tab === 'duel' ? r.rule === 'duel' : true));
function renderRooms() {
  const list = shown(), pages = Math.max(1, Math.ceil(list.length / PER));
  page = Math.min(page, pages - 1);
  for (const p of document.querySelectorAll('.ch-page')) p.textContent = `${page + 1} / ${pages}`;
  for (const b of document.querySelectorAll('.ch-prev')) b.disabled = page <= 0;
  for (const b of document.querySelectorAll('.ch-next')) b.disabled = page >= pages - 1;
  $('ch-count').textContent = `방 ${rooms.length}개 · 접속 ${users.length}명`;
  const grid = $('ch-grid');
  if (!list.length) {
    grid.replaceChildren(el('p', 'ch-empty', tab === 'all' ? '아직 열린 방이 없어요. 방만들기로 첫 방을 열어 보세요!' : '이 조건에 맞는 방이 없어요.'));
    return;
  }
  grid.replaceChildren(...list.slice(page * PER, page * PER + PER).map(card));
}
function card(r) {
  const full = r.players >= r.seats, b = el('button', `ch-card${r.playing ? ' play' : full ? ' full' : ''}`);
  b.type = 'button';
  const cv = el('canvas', 'mm'); cv.width = 150; cv.height = 130;
  mapThumb(cv, r.map);
  const info = el('div', 'info');
  info.append(el('span', 'no', `No.${r.code}`), el('b', 'tt', r.title || '즐거운 크레이지아케이드'));
  const chips = el('div', 'chips');
  chips.append(el('span', null, r.mode === 'solo' ? '개인전' : '팀전'));
  if (r.rule === 'duel') chips.append(el('span', 'd', '무한 결투'));
  chips.append(el('span', null, r.map === RANDOM_MAP ? '전체 랜덤' : mapById(r.map).name));
  const who = el('div', 'who');
  for (const ch of (r.faces || []).slice(0, 8)) {
    const f = el('canvas'); f.width = 45; f.height = 43;
    A.loadGroup(`char_${ch}`).then(() => { const c = f.getContext('2d'); c.imageSmoothingEnabled = false; A.drawChar(c, ch, 'Portrait', 0, 0, 0, 0); });
    who.append(f);
  }
  who.append(el('b', null, `${r.players}/${r.seats}`));
  info.append(chips, who);
  b.append(cv, info, el('span', `st ${r.playing ? 'play' : full ? 'full' : 'wait'}`, r.playing ? '게임 중' : full ? '꽉 참' : '대기 중'));
  if (r.locked) b.append(el('span', 'lock', '🔒'));
  b.onclick = () => {
    if (r.playing) { app.toast('게임 중인 방이에요. 끝나면 들어갈 수 있어요.'); return; }
    if (full) { app.toast('방이 꽉 찼어요.'); return; }
    click();
    if (r.locked) askPassword(r.code); else app.joinRoom(r.code);
  };
  return b;
}

// ---- who is on
function renderUsers() {
  $('ch-ucount').textContent = `${users.length}명`;
  $('ch-users').replaceChildren(...users.map((u) => {
    const d = el('div', 'u');
    const cv = el('canvas'); cv.width = 16; cv.height = 14;
    if (u.lv) A.loadGroup('rank').then(() => drawRank(cv.getContext('2d'), u.lv, 0, 0));
    const at = u.at === 'lobby' ? '로비' : u.at === 'game' ? '게임 중' : `${u.at}방`;
    d.append(cv, el('b', null, u.name), el('small', u.at === 'lobby' ? '' : u.at === 'game' ? 'g' : 'r', at));
    return d;
  }));
}

// ---- the lobby chat
function chatLine(l) {
  const d = el('div');
  d.append(el('b', null, l.name), document.createTextNode(l.text));
  return d;
}
function renderChat(one = false) {
  const log = $('ch-log');
  if (one && lines.length) log.append(chatLine(lines[lines.length - 1])); else log.replaceChildren(...lines.map(chatLine));
  while (log.children.length > 60) log.firstChild.remove();
  log.scrollTop = log.scrollHeight;
}

// ---- buttons
function wire() {
  if (wired) return;
  wired = true;
  $('ch-quick').onclick = () => {
    click();
    const open = rooms.filter((r) => !r.playing && !r.locked && r.players < r.seats && (tab !== 'duel' || r.rule === 'duel'));
    if (open.length) app.joinRoom(open[Math.floor(Math.random() * open.length)].code);
    else { app.toast('들어갈 방이 없어서 새 방을 만들었어요.'); hostRoom({ title: `${app.name}님의 방`, mode: 'team', rule: tab === 'duel' ? 'duel' : 'normal' }); }
  };
  $('ch-create').onclick = () => { click(); openCreate(); };
  $('ch-practice').onclick = () => { click(); showPractice(app); };
  for (const b of document.querySelectorAll('#ch-tabs button')) {
    b.onclick = () => {
      click(); tab = b.dataset.tab; page = 0;
      for (const x of document.querySelectorAll('#ch-tabs button')) x.classList.toggle('on', x === b);
      renderRooms();
    };
  }
  for (const b of document.querySelectorAll('.ch-prev')) b.onclick = () => { click(); page = Math.max(0, page - 1); renderRooms(); };
  for (const b of document.querySelectorAll('.ch-next')) b.onclick = () => { click(); page += 1; renderRooms(); };
  const join = () => {
    const code = $('join-code').value.replace(/\D/g, '');
    if (code.length !== 4) { app.toast('방 번호 4자리를 입력해 주세요.'); $('join-code').focus(); return; }
    click(); app.joinRoom(code);
  };
  $('join').onclick = join;
  $('join-code').onkeydown = (e) => { if (e.key === 'Enter') join(); };
  // Chat: a panel on wide screens, a popup from 💬 on phones.
  $('ch-form').onsubmit = (e) => {
    e.preventDefault();
    const t = $('ch-input').value.trim();
    if (t && feed) feed.send({ t: 'chat', text: t });
    $('ch-input').value = '';
  };
  $('ch-chat-open').onclick = () => { click(); $('ch-chat').classList.add('open'); $('ch-input').focus(); renderChat(); };
  $('ch-chat-close').onclick = () => { $('ch-chat').classList.remove('open'); };
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || $('home').hidden || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (document.querySelector('.popup:not([hidden]), #char-pick:not([hidden]), #missions:not([hidden]), #settings:not([hidden])')) return;
    e.preventDefault(); $('ch-input').focus();
  });
  // 방만들기
  const pick = (id) => { for (const b of document.querySelectorAll(`#${id} button`)) b.onclick = () => { click(); for (const x of document.querySelectorAll(`#${id} button`)) x.classList.toggle('on', x === b); }; };
  pick('create-mode'); pick('create-rule');
  $('create-close').onclick = () => { $('create-room').hidden = true; };
  $('create-room').onclick = (e) => { if (e.target === $('create-room')) $('create-room').hidden = true; };
  $('create-form').onsubmit = (e) => {
    e.preventDefault();
    const val = (id) => document.querySelector(`#${id} button.on`).dataset.v;
    $('create-room').hidden = true;
    sfx('Bt_c_Success', 0.6);
    hostRoom({ title: $('create-title').value.trim() || `${app.name}님의 방`, mode: val('create-mode'), rule: val('create-rule'), password: $('create-pw').value.trim() });
  };
}
function openCreate() {
  $('create-title').value = `${app.name}님의 방`;
  $('create-pw').value = '';
  $('create-room').hidden = false;
}
// A room under a number nobody is using, set up as asked once we are its host.
function hostRoom(opts) {
  let code;
  for (let i = 0; i < 30; i++) { code = randomCode(); if (!rooms.some((r) => r.code === code)) break; }
  app.hostRoom(code, opts);
}

// A locked room: its password first (wrong: asked again with a word on it).
export function askPassword(code, wrong = false) {
  $('pw-msg').textContent = wrong ? '비밀번호가 맞지 않아요. 다시 입력해 주세요.' : `${code}번 방은 비밀번호가 있어요.`;
  $('pw-msg').classList.toggle('bad', wrong);
  $('pw-input').value = '';
  $('room-pw').hidden = false;
  setTimeout(() => $('pw-input').focus(), 50);
  $('pw-close').onclick = () => { $('room-pw').hidden = true; };
  $('room-pw').onclick = (e) => { if (e.target === $('room-pw')) $('room-pw').hidden = true; };
  $('pw-form').onsubmit = (e) => {
    e.preventDefault();
    const pw = $('pw-input').value.trim();
    if (!pw) { $('pw-input').focus(); return; }
    $('room-pw').hidden = true;
    click(); app.joinRoom(code, pw);
  };
}
