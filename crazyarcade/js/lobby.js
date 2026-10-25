// The menu and the waiting room, built like the worms ones: practice against the computer, or
// make a room, send the invite link and wait for friends; the host picks team or solo play and
// the map, everyone picks a side, and the host starts. The room itself is RoomCore (online in
// a Durable Object, in the page for practice); this file only draws it and sends choices.
import * as A from './assets.js';
import { sfx } from './audio.js';
import { TEAMS, charById } from './shared/const.js';
import { MAPS } from './shared/maps.js';
import { RED, BLUE } from './shared/room.js';
import * as W from './wallet.js';
import { pickChar } from './home.js';
import { mapButton, pickMap, mapById } from './map-pick.js';

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
    if (bots + 1 > map.spawns.length) { app.toast(`${map.name}은(는) ${map.spawns.length}명까지 하는 맵이에요.`); return; }
    click(); hideMenu(); app.practice({ mode, bots, map: map.id });
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
export function showLobby(app) { $('lobby').hidden = false; renderLobby(app); }
export function hideLobby() { $('lobby').hidden = true; }
export const lobbyShown = () => !$('lobby').hidden;
export function lobbyStatus(text) { $('lobby-status').textContent = text; }

function portrait(cv, m) {
  A.loadGroup(`char_${m.char}`).then(() => {
    const c = cv.getContext('2d');
    c.clearRect(0, 0, cv.width, cv.height); c.imageSmoothingEnabled = false;
    A.drawChar(c, m.char, 'Portrait', 0, 0, 0, m.color);
  });
}

export function renderLobby(app) {
  const room = app.room;
  if (!room || $('lobby').hidden) return;
  const host = room.host === app.me;
  $('lobby-code').textContent = room.code;
  for (const b of document.querySelectorAll('#lobby-mode button')) {
    b.classList.toggle('on', b.dataset.mode === room.mode);
    b.disabled = !host;
    b.onclick = () => { if (host && room.mode !== b.dataset.mode) { click(); app.send({ t: 'settings', mode: b.dataset.mode }); } };
  }
  const seats = $('seats');
  seats.className = room.mode;
  const seat = (m, color) => {
    const el = document.createElement('div');
    el.className = 'seat';
    el.style.setProperty('--c', TEAMS[m ? m.color : color].css);
    if (m) {
      el.classList.add('taken');
      el.classList.toggle('me', m.id === app.me);
      const cv = document.createElement('canvas');
      cv.width = 45; cv.height = 43;
      portrait(cv, m);
      const who = document.createElement('div');
      who.className = 'who';
      who.append(Object.assign(document.createElement('b'), { textContent: m.name }), Object.assign(document.createElement('small'), { textContent: charById(m.char).name }));
      el.append(cv, who);
      const tag = m.id === room.host ? '방장' : m.id === app.me ? '나' : m.bot ? '컴퓨터' : '';
      if (tag) el.append(Object.assign(document.createElement('em'), { textContent: tag }));
      if (host && m.id !== app.me) {
        const k = Object.assign(document.createElement('button'), { type: 'button', className: 'kick', textContent: m.bot ? '빼기' : '내보내기' });
        k.onclick = () => { click(); app.send({ t: 'kick', id: m.id }); };
        el.append(k);
      }
    } else {
      // An empty place: move there (team play), or the host puts a computer in it.
      const mine = room.members.find((x) => x.id === app.me);
      if (room.mode === 'team' && mine && mine.color !== color) {
        const mv = Object.assign(document.createElement('button'), { type: 'button', className: 'seat-btn', textContent: '+ 여기로 이동' });
        mv.style.cssText = 'all:unset;cursor:pointer;flex:1';
        mv.onclick = () => { click(); app.send({ t: 'set', color }); };
        el.append(mv);
      }
      if (host) {
        const add = Object.assign(document.createElement('button'), { type: 'button', className: 'add', textContent: '+ 컴퓨터' });
        add.style.cssText = 'all:unset;cursor:pointer;color:#ffe95a;font-weight:800';
        add.onclick = () => { click(); app.send({ t: 'bot', color: room.mode === 'team' ? color : undefined }); };
        el.append(add);
      }
      if (!el.children.length) el.textContent = '빈 자리';
    }
    return el;
  };
  const members = [...room.members].sort((a, b) => a.slot - b.slot);
  if (room.mode === 'team') {
    const col = (color, name) => {
      const list = members.filter((m) => m.color === color);
      const box = document.createElement('div');
      box.className = 'team-col';
      box.style.setProperty('--c', TEAMS[color].css);
      box.append(Object.assign(document.createElement('h3'), { innerHTML: `${name}<b>${list.length}/4</b>` }));
      for (let i = 0; i < 4; i++) box.append(seat(list[i], color));
      return box;
    };
    seats.replaceChildren(col(RED, '빨강팀'), Object.assign(document.createElement('div'), { className: 'vs', textContent: 'VS' }), col(BLUE, '파랑팀'));
  } else {
    const list = members.slice(0, 8);
    seats.replaceChildren(...Array.from({ length: 8 }, (_, i) => seat(list[i], 0)));
  }
  // Map: the host chooses, everyone sees it.
  mapButton($('lobby-map'), room.map, host ? () => pickMap(room.map, room.members.length, (id) => app.send({ t: 'settings', map: id })) : null);
  const mine = room.members.find((x) => x.id === app.me);
  if (mine) portrait($('lobby-char').querySelector('canvas'), mine);
  $('lobby-char').onclick = () => pickChar(app, (id) => app.send({ t: 'set', char: id }));
  $('lobby-shop').onclick = () => { click(); app.toShop('lobby'); };
  $('lobby-leave').onclick = () => { click(); app.leaveRoom(); };
  $('share-link').onclick = () => share(room.code);
  // Start: the host, once the room is ready.
  const why = whyNot(room);
  $('lobby-start').hidden = !host;
  $('lobby-start').disabled = !!why;
  $('lobby-start').onclick = () => { if (!why) { sfx('Bt_c_GameStart'); app.send({ t: 'start' }); } };
  lobbyStatus(why || (host ? '준비됐어요. 게임 시작을 누르세요!' : '방장이 게임을 시작하길 기다리는 중…'));
}

// The same checks the room makes, to explain before pressing.
function whyNot(room) {
  const n = room.members.length;
  if (n < 2) return '초대 링크를 보내 친구를 부르거나, 컴퓨터를 넣어 주세요.';
  const map = MAPS.find((m) => m.id === room.map) || MAPS[0];
  if (n > map.spawns.length) return `${map.name}은(는) ${map.spawns.length}명까지예요. 맵을 바꿔 주세요.`;
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
