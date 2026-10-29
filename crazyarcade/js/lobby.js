// The menu and the waiting room, built like the worms ones: practice against the computer, or
// make a room, send the invite link and wait for friends; the host picks team or solo play and
// the map, everyone picks a side, and the host starts. The room itself is RoomCore (online in
// a Durable Object, in the page for practice); this file only draws it and sends choices.
import * as A from './assets.js';
import { sfx } from './audio.js';
import { TEAMS, CHARACTERS, charById } from './shared/const.js';
import { MAPS } from './shared/maps.js';
import { RED, BLUE, RANDOM_MAP } from './shared/room.js';
import * as W from './wallet.js';
import { pickChar } from './home.js';
import { mapButton, pickMap, mapById } from './map-pick.js';
import { rankCanvas } from './rank.js';
import * as Chat from './chat.js';

const $ = (id) => document.getElementById(id);
const click = () => sfx('Bt_c_Pop', 0.6);
let practiceMap = 'Village10';

// ---- menu
const SIZES = [
  ['team', 1, '팀전 1:1'], ['team', 3, '팀전 2:2'], ['team', 5, '팀전 3:3'], ['team', 7, '팀전 4:4'],
  ['solo', 1, '개인전 2명'], ['solo', 2, '개인전 3명'], ['solo', 3, '개인전 4명'], ['solo', 5, '개인전 6명'], ['solo', 7, '개인전 8명'],
];
export function showMenu(app, status = '') {
  $('menu').hidden = false;
  const size = $('practice-size');
  if (!size.options.length) SIZES.forEach(([, , label], i) => size.add(new Option(label, String(i))));
  const need = () => SIZES[Number(size.value)][1] + 1;
  const drawMap = () => mapButton($('practice-map'), practiceMap, () => pickMap(practiceMap, need(), (id) => { practiceMap = id; drawMap(); }));
  drawMap();
  $('net-status').textContent = status;
  $('practice-start').onclick = () => {
    const [mode, bots] = SIZES[Number(size.value)];
    const map = mapById(practiceMap);
    if (practiceMap !== RANDOM_MAP && bots + 1 > map.spawns.length) { app.toast(`${map.name}은(는) ${map.spawns.length}명까지 하는 맵이에요.`); return; }
    click(); hideMenu(); app.practice({ mode, bots, rule: $('practice-rule').value, map: practiceMap === RANDOM_MAP ? RANDOM_MAP : map.id });
  };
  $('host').onclick = () => { click(); app.hostRoom(); };
  const join = () => {
    const code = $('join-code').value.replace(/\D/g, '');
    if (code.length !== 4) { $('net-status').textContent = '방 번호 4자리를 입력해 주세요.'; $('join-code').focus(); return; }
    click(); app.joinRoom(code);
  };
  $('join').onclick = join;
  $('join-code').onkeydown = (e) => { if (e.key === 'Enter') join(); };
  $('menu-home').onclick = () => { click(); app.toHome(); };
  $('menu-shop').onclick = () => { click(); app.toShop('menu'); };
}
export function hideMenu() { $('menu').hidden = true; }

// ---- waiting room
// Wide screens (a PC) get the bigger layout: rows of four seats, a side column, the chat panel.
const WIDE = matchMedia('(min-width: 1100px) and (min-height: 640px)');
let lobbyApp = null;
WIDE.addEventListener?.('change', () => { if (lobbyApp) renderLobby(lobbyApp); });
export function showLobby(app) { lobbyApp = app; $('lobby').hidden = false; setupChat(app); renderLobby(app); }
export function hideLobby() { $('lobby').hidden = true; $('lobby-chat').classList.remove('open'); }
export const lobbyShown = () => !$('lobby').hidden;
export function lobbyStatus(text) { $('lobby-status').textContent = text; }

function portrait(cv, m) {
  A.loadGroup(`char_${m.char}`).then(() => {
    const c = cv.getContext('2d');
    c.clearRect(0, 0, cv.width, cv.height); c.imageSmoothingEnabled = false;
    A.drawChar(c, m.char, 'Portrait', 0, 0, 0, m.color);
  });
}
// The whole character standing (a seat alone on its team has room for it).
function figure(cv, m) {
  A.loadGroup(`char_${m.char}`).then(() => {
    const c = cv.getContext('2d');
    c.clearRect(0, 0, cv.width, cv.height); c.imageSmoothingEnabled = false;
    c.fillStyle = 'rgba(0,0,0,0.3)'; c.beginPath(); c.ellipse(30, 64, 16, 4, 0, 0, Math.PI * 2); c.fill();
    A.drawChar(c, m.char, 'WalkDown', 0, 10, 66, m.color);
  });
}
const el = (tag, cls, text) => Object.assign(document.createElement(tag), cls ? { className: cls } : {}, text != null ? { textContent: text } : {});

// Seats open as people come: team play shows as many per team as the players need (1:1 for one
// or two, 2:2 for three or four…), or more when the host asks; solo shows one free seat more.
export function seatsPerTeam(room) {
  const ms = room.members, red = ms.filter((m) => m.color === RED).length, blue = ms.filter((m) => m.color === BLUE).length;
  return Math.min(4, Math.max(room.size || 1, Math.ceil(ms.length / 2), red, blue));
}

export function renderLobby(app) {
  const room = app.room;
  if (!room || $('lobby').hidden) return;
  const host = room.host === app.me;
  const mine = room.members.find((x) => x.id === app.me);
  $('lobby-code').textContent = room.code;
  for (const b of document.querySelectorAll('#lobby-rule button')) {
    b.classList.toggle('on', b.dataset.rule === (room.rule || 'normal'));
    b.disabled = !host;
    b.onclick = () => { if (host && room.rule !== b.dataset.rule) { click(); app.send({ t: 'settings', rule: b.dataset.rule }); } };
  }
  for (const b of document.querySelectorAll('#lobby-mode button')) {
    b.classList.toggle('on', b.dataset.mode === room.mode);
    b.disabled = !host;
    b.onclick = () => { if (host && room.mode !== b.dataset.mode) { click(); app.send({ t: 'settings', mode: b.dataset.mode }); } };
  }
  const player = (m, big) => {
    const s = el('div', `s p${big ? ' big' : ''}${m.id === app.me ? ' me' : ''}`);
    s.style.setProperty('--c', TEAMS[m.color].css);
    const cv = el('canvas', big ? 'fig' : 'face');
    if (big) { cv.width = 60; cv.height = 70; figure(cv, m); } else { cv.width = 45; cv.height = 43; portrait(cv, m); }
    const nm = el('div', 'nm'), b = el('b', null, m.name);
    if (m.lv) b.prepend(rankCanvas(m.lv, 1));
    nm.append(b, el('small', null, m.lv ? `Lv.${m.lv} · ${charById(m.char).name}` : charById(m.char).name));
    s.append(cv, nm);
    const tag = m.id === room.host ? '방장' : m.bot ? '컴퓨터' : m.id === app.me ? '나' : '';
    if (tag) s.append(el('span', 'tag', tag));
    if (host && m.id !== app.me) {
      const k = el('button', 'kick', m.bot ? '빼기' : '내보내기');
      k.type = 'button'; k.onclick = () => { click(); app.send({ t: 'kick', id: m.id }); };
      s.append(k);
    }
    return s;
  };
  // An empty place: move there (team play), or the host puts a computer in it.
  const empty = (color) => {
    const s = el('div', 's e');
    if (room.mode === 'team' && mine && mine.color !== color) {
      const mv = el('button', null, '여기로 이동'); mv.type = 'button';
      mv.onclick = () => { click(); app.send({ t: 'set', color }); };
      s.append(mv);
    }
    if (host) {
      const add = el('button', 'cpu', '+ 컴퓨터'); add.type = 'button';
      add.onclick = () => { click(); app.send({ t: 'bot', color: room.mode === 'team' ? color : undefined }); };
      s.append(add);
    }
    if (!s.children.length) s.textContent = '친구를 기다리는 중…';
    return s;
  };
  const wide = WIDE.matches;
  $('lobby').classList.toggle('wide', wide);
  $('lobby-title').textContent = room.title || '';
  // A seat not open yet (wide layout): the host opens the seats up to it.
  const closed = (i) => {
    const b = el('button', 's closed', host ? '+ 자리 열기' : '닫힌 자리'); b.type = 'button';
    b.disabled = !host;
    b.onclick = () => { if (host) { click(); app.send({ t: 'settings', size: i + 1 }); } };
    return b;
  };
  const seats = $('seats');
  seats.className = room.mode;
  const members = [...room.members].sort((a, b) => a.slot - b.slot);
  if (room.mode === 'team') {
    const n = seatsPerTeam(room);
    const team = (color, name) => {
      const list = members.filter((m) => m.color === color);
      const box = el('div', 'tm');
      box.style.setProperty('--c', TEAMS[color].css);
      const h = el('h3', null, name); h.append(el('b', null, `${list.length}/${n}`));
      const g = el('div', 'seatsg'); g.style.gridTemplateRows = `repeat(${n}, minmax(0, 1fr))`;
      for (let i = 0; i < (wide ? 4 : n); i++) g.append(list[i] ? player(list[i], wide || n === 1) : i < n ? empty(color) : closed(i));
      box.append(h, g);
      return box;
    };
    const vs = el('div', 'vs');
    vs.append(el('b', null, 'VS'), el('span', 'size', `${n}:${n}`));
    if (host && n < 4) {
      const grow = el('button', 'addrow'); grow.type = 'button'; grow.innerHTML = '+ 자리<br>늘리기';
      grow.onclick = () => { click(); app.send({ t: 'settings', size: n + 1 }); };
      vs.append(grow);
    }
    seats.replaceChildren(team(RED, '빨강팀'), vs, team(BLUE, '파랑팀'));
  } else {
    const n = wide ? 8 : Math.min(8, Math.max(2, members.length + 1));
    seats.replaceChildren(...Array.from({ length: n }, (_, i) => (members[i] ? player(members[i], wide) : empty(0))));
  }
  // The room's map pictures load while waiting, so the round opens with them ready.
  if (room.map !== RANDOM_MAP) for (const t of mapById(room.map).sets) A.loadGroup(`tile_${t}`);
  // Map (the host chooses), my character, the shop.
  mapButton($('lobby-map'), room.map, host ? () => pickMap(room.map, room.members.length, (id) => app.send({ t: 'settings', map: id })) : null);
  if (mine) {
    portrait($('lobby-char').querySelector('canvas'), mine);
    $('lobby-char').querySelector('b').textContent = charById(mine.char).name;
  }
  $('lobby-char').onclick = () => pickChar(app, (id) => app.send({ t: 'set', char: id }));
  if (wide) quickChars(app, mine);
  $('lobby-shop').onclick = () => { click(); app.toShop('lobby'); };
  $('lobby-leave').onclick = () => { click(); app.leaveRoom(); };
  $('share-link').onclick = () => share(room.code);
  // Start: the host, once the room is ready.
  const why = whyNot(room);
  const start = $('lobby-start');
  start.classList.toggle('wait', !host);
  start.textContent = host ? '게임 시작' : '방장이 시작해요';
  start.disabled = !host || !!why;
  start.onclick = () => { if (host && !why) { sfx('Bt_c_GameStart'); app.send({ t: 'start' }); } };
  lobbyStatus(why || (host ? '준비됐어요. 게임 시작을 누르세요!' : '방장이 게임을 시작하길 기다리는 중…'));
}

// Wide layout: the characters I own to switch with one click, and 전체 for the whole list.
function quickChars(app, mine) {
  const cur = mine ? mine.char : W.myChar();
  $('lobby-chars').querySelector('h3 span').textContent = charById(cur).name;
  const owned = CHARACTERS.filter((c) => W.owns('char', c.id)).slice(0, 14);
  const pick = (id) => { if (id === cur) return; click(); W.setChar(id); app.send({ t: 'set', char: id }); };
  const bs = owned.map((c) => {
    const b = el('button', c.id === cur ? 'sel' : ''); b.type = 'button'; b.title = c.name;
    const cv = el('canvas'); cv.width = 45; cv.height = 43; b.append(cv);
    portrait(cv, { char: c.id, color: mine ? mine.color : 0 });
    b.onclick = () => pick(c.id);
    return b;
  });
  const all = el('button', 'all', '전체 ›'); all.type = 'button';
  all.onclick = () => pickChar(app, (id) => app.send({ t: 'set', char: id }));
  $('lobby-chars').querySelector('.cgrid').replaceChildren(...bs, all);
}

// Chat: a panel on wide screens (Enter anywhere starts typing), a popup from 💬 on phones with
// a dot while there are lines not seen.
let chatReady = false;
function chatLine(l) {
  const d = el('div', l.name ? '' : 'sys');
  if (l.name) d.append(el('b', null, l.name));
  d.append(document.createTextNode(l.text));
  return d;
}
function setupChat(app) {
  lobbyApp = app;
  const log = $('chat-log'), box = $('lobby-chat');
  const fill = () => { log.replaceChildren(...Chat.lines.map(chatLine)); log.scrollTop = log.scrollHeight; };
  fill();
  if (chatReady) return;
  chatReady = true;
  Chat.onLine((l) => {
    if (!l) { fill(); return; }
    log.append(chatLine(l));
    while (log.children.length > 60) log.firstChild.remove();
    log.scrollTop = log.scrollHeight;
    if (!WIDE.matches && !box.classList.contains('open') && l.name && !$('lobby').hidden) $('chat-open').querySelector('i').hidden = false;
  });
  const open = (on) => {
    box.classList.toggle('open', on);
    if (on) { $('chat-open').querySelector('i').hidden = true; log.scrollTop = log.scrollHeight; $('chat-input').focus(); }
  };
  $('chat-open').onclick = () => { click(); open(!box.classList.contains('open')); };
  $('chat-close').onclick = () => open(false);
  $('chat-form').onsubmit = (e) => {
    e.preventDefault();
    const text = $('chat-input').value.trim();
    if (text) lobbyApp.send({ t: 'chat', text });
    $('chat-input').value = '';
  };
  $('chat-input').onkeydown = (e) => { if (e.key === 'Escape') { $('chat-input').blur(); open(false); } };
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || $('lobby').hidden || !WIDE.matches || e.target.tagName === 'INPUT' || !$('char-pick').hidden || !$('map-pick').hidden) return;
    e.preventDefault(); $('chat-input').focus();
  });
}

// The same checks the room makes, to explain before pressing.
function whyNot(room) {
  const n = room.members.length;
  if (n < 2) return '초대 링크를 보내 친구를 부르거나, 컴퓨터를 넣어 주세요.';
  const map = MAPS.find((m) => m.id === room.map) || MAPS[0];
  if (room.map !== RANDOM_MAP && n > map.spawns.length) return `${map.name}은(는) ${map.spawns.length}명까지예요. 맵을 바꿔 주세요.`;
  if (room.mode === 'team') {
    const r = room.members.filter((m) => m.color === RED).length, b = room.members.filter((m) => m.color === BLUE).length;
    if (r !== b) return `팀 인원을 맞춰 주세요. (지금 ${r}:${b})`;
  }
  return null;
}

async function share(code) {
  const url = `${location.origin}${location.pathname}?room=${code}`;
  const text = `크레이지 아케이드 같이 하자! 방 번호 ${code}`;
  try {
    if (navigator.share) { await navigator.share({ title: '크레이지 아케이드', text, url }); return; }
  } catch (err) { if (err?.name === 'AbortError') return; }
  try {
    await navigator.clipboard.writeText(`${text}\n${url}`);
    $('share-link').textContent = '복사됨! 카톡에 붙여넣기';
    setTimeout(() => { $('share-link').textContent = '초대 링크 보내기'; }, 2000);
  } catch { lobbyStatus(`이 링크를 보내 주세요: ${url}`); }
}
