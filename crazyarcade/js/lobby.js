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
import { mapButton, mapThumb, mapChips, pickMap, mapById } from './map-pick.js';
import { rankCanvas } from './rank.js';
import * as Chat from './chat.js';
import { aboveKeyboard } from './channel.js';

const $ = (id) => document.getElementById(id);
const click = () => sfx('Bt_c_Pop', 0.6);
let practiceMap = 'Village10';

// ---- menu
const SIZES = [
  ['team', 1, '팀전 1:1'], ['team', 3, '팀전 2:2'], ['team', 5, '팀전 3:3'], ['team', 7, '팀전 4:4'],
  ['solo', 1, '개인전 2명'], ['solo', 2, '개인전 3명'], ['solo', 3, '개인전 4명'], ['solo', 5, '개인전 6명'], ['solo', 7, '개인전 8명'],
];
// 혼자놀기: the practice options in a popup over the 대기실.
export function showPractice(app) {
  $('menu').hidden = false;
  const size = $('practice-size');
  if (!size.options.length) SIZES.forEach(([, , label], i) => size.add(new Option(label, String(i))));
  const need = () => SIZES[Number(size.value)][1] + 1;
  const drawMap = () => mapButton($('practice-map'), practiceMap, () => pickMap(practiceMap, need(), (id) => { practiceMap = id; drawMap(); }));
  drawMap();
  $('practice-start').onclick = () => {
    const [mode, bots] = SIZES[Number(size.value)];
    const map = mapById(practiceMap);
    if (practiceMap !== RANDOM_MAP && bots + 1 > map.spawns.length) { app.toast(`${map.name}은(는) ${map.spawns.length}명까지 하는 맵이에요.`); return; }
    click(); hideMenu(); app.practice({ mode, bots, rule: $('practice-rule').value, map: practiceMap === RANDOM_MAP ? RANDOM_MAP : map.id });
  };
  $('menu-close').onclick = () => { click(); hideMenu(); };
  $('menu').onclick = (e) => { if (e.target === $('menu')) hideMenu(); };
}
export function hideMenu() { $('menu').hidden = true; }

// ---- waiting room
// Wide screens (a PC) get the bigger layout: rows of four seats, a side column, the chat panel.
const WIDE = matchMedia('(min-width: 1100px) and (min-height: 640px)');
let lobbyApp = null;
WIDE.addEventListener?.('change', () => { if (lobbyApp) renderLobby(lobbyApp); });
export function showLobby(app) { lobbyApp = app; $('lobby').hidden = false; setupChat(app); renderLobby(app); }
export function hideLobby() { $('lobby').hidden = true; $('lobby-chat').classList.remove('open'); $('room-edit').hidden = true; }
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
  $('lobby-lock').hidden = !room.locked;
  // 방 설정: the host changes the title and the password.
  $('room-edit-btn').hidden = !host;
  $('room-edit-btn').onclick = () => {
    click();
    $('edit-title').value = room.title || '';
    $('edit-pw').value = app.roomPw || '';
    $('room-edit').hidden = false;
  };
  $('edit-close').onclick = () => { $('room-edit').hidden = true; };
  $('room-edit').onclick = (e) => { if (e.target === $('room-edit')) $('room-edit').hidden = true; };
  $('edit-form').onsubmit = (e) => {
    e.preventDefault();
    $('room-edit').hidden = true;
    sfx('Bt_c_Success', 0.6);
    const pw = $('edit-pw').value.trim();
    app.send({ t: 'settings', title: $('edit-title').value.trim() || room.title, password: pw });
    app.toast(pw ? '방 설정을 바꿨어요. 🔒 비밀번호 방이에요.' : '방 설정을 바꿨어요. 누구나 들어올 수 있어요.');
  };
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
  $('lobby-title').textContent = room.title || '';
  $('lobby-leave').onclick = () => { click(); app.leaveRoom(); };
  $('share-link').onclick = () => share(room.code);
  // A player's seat: the whole character, the client's 방장 / 준비 band across it, the name.
  const player = (m) => {
    const s = el('div', `s p${m.id === app.me ? ' me' : ''}`);
    s.style.setProperty('--c', TEAMS[m.color].css);
    const fig = el('div', 'fig');
    const body = el('canvas', 'body'); body.width = 60; body.height = 70; figure(body, m);
    const band = el('canvas', 'band'); band.width = 94; band.height = 16;
    A.loadGroup('ui').then(() => { const c = band.getContext('2d'); c.imageSmoothingEnabled = false; A.drawAt(c, 'Prepare/PRE_Img', m.id === room.host ? 2 : m.ready || m.bot ? 1 : 0, 0, 0); });
    fig.append(body, band);
    const nm = el('div', 'nm'), n = el('div', 'n');
    if (m.lv) n.append(rankCanvas(m.lv, 1));
    n.append(el('span', 'nw', m.name));
    if (m.title) n.append(el('span', 'ttl-badge', m.title));
    nm.append(n, el('small', null, m.lv ? `Lv.${m.lv} · ${charById(m.char).name}` : charById(m.char).name));
    s.append(fig, nm);
    if (m.bot) s.append(el('span', 'tag', '컴퓨터'));
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
    return s;
  };
  // A seat not open yet: the host opens the seats up to it.
  const closed = (i) => {
    const b = el('button', `s x${host ? ' open' : ''}`); b.type = 'button';
    const d = el('div', null, '✕'); d.append(el('small', null, host ? '눌러서 열기' : '닫힌 자리')); b.append(d);
    b.disabled = !host;
    b.onclick = () => { if (host) { click(); app.send({ t: 'settings', size: i + 1 }); } };
    return b;
  };
  const head = (color, name, text) => {
    const h = el('div', 'th'), i = el('i'); i.style.background = TEAMS[color].css;
    h.append(i, name, el('b', null, text));
    return h;
  };
  const seats = $('rm-seats');
  seats.className = `rm-panel ${room.mode}`;
  const members = [...room.members].sort((a, b) => a.slot - b.slot);
  if (room.mode === 'team') {
    const n = seatsPerTeam(room);
    const out = [];
    for (const [color, name] of [[RED, '빨강팀'], [BLUE, '파랑팀']]) {
      const list = members.filter((m) => m.color === color);
      const row = el('div', 'row');
      for (let i = 0; i < 4; i++) row.append(list[i] ? player(list[i]) : i < n ? empty(color) : closed(i));
      out.push(head(color, name, `${list.length} / ${n}`), row);
    }
    seats.replaceChildren(...out);
  } else {
    const h = el('div', 'th'); h.append('개인전', el('b', null, `${members.length} / 8`));
    const rows = [el('div', 'row'), el('div', 'row')];
    for (let i = 0; i < 8; i++) rows[i >> 2].append(members[i] ? player(members[i]) : empty(0));
    seats.replaceChildren(h, ...rows);
  }
  // My character (the ones I own, 전체 for the whole list) and my team.
  quickChars(app, mine);
  $('rm-team-box').hidden = room.mode !== 'team';
  if (room.mode === 'team') {
    $('rm-teams').replaceChildren(...[[RED, '빨강팀', `Prepare/PRE_SelTeam-Basic0${RED}`], [BLUE, '파랑팀', `Prepare/PRE_SelTeam-Basic0${BLUE}`]].map(([color, name, spr]) => {
      const b = el('button', mine && mine.color === color ? 'on' : ''); b.type = 'button';
      const cv = el('canvas'); cv.width = 35; cv.height = 37;
      A.loadGroup('ui').then(() => A.drawAt(cv.getContext('2d'), spr, 0, 0, 0));
      b.append(cv, name);
      b.onclick = () => { if (mine && mine.color !== color) { click(); app.send({ t: 'set', color }); } };
      return b;
    }));
  }
  // The map (the host chooses). Its pictures load while waiting, so the round opens with them ready.
  if (room.map !== RANDOM_MAP) for (const t of mapById(room.map).sets) A.loadGroup(`tile_${t}`);
  mapThumb($('rm-mm'), room.map);
  const rnd = room.map === RANDOM_MAP, mp = mapById(room.map);
  $('rm-mapname').textContent = rnd ? '전체 랜덤' : mp.name;
  $('rm-mapinfo').textContent = rnd ? '시작할 때 정해져요' : `최대 ${mp.spawns.length}명`;
  $('rm-mapchips').replaceChildren(...(rnd ? ['모든 테마'] : mapChips(mp).slice(1)).map((t) => el('span', null, t)));
  $('rm-maphint').textContent = host ? '' : '방장이 바꿔요';
  const selMap = $('lobby-map');
  selMap.hidden = !host;
  A.loadGroup('ui').then(() => { const c = selMap.querySelector('canvas').getContext('2d'); c.clearRect(0, 0, 123, 48); A.drawAt(c, 'Prepare/PRE_Bt_Selectmap', 0, 0, 0); });
  selMap.onclick = () => { if (host) { click(); pickMap(room.map, room.members.length, (id) => app.send({ t: 'settings', map: id })); } };
  // 상점 and 시작 / 준비.
  drawShop($('lobby-shop').querySelector('canvas'));
  $('lobby-shop').onclick = () => { click(); app.toShop('lobby'); };
  const why = whyNot(room);
  const start = $('lobby-start'), sc = start.querySelector('canvas');
  clearInterval(shineTimer);
  const paint = (name, f) => A.loadGroup('ui').then(() => { const c = sc.getContext('2d'); c.imageSmoothingEnabled = false; c.clearRect(0, 0, sc.width, sc.height); A.drawAt(c, name, f, 0, 0); });
  start.classList.toggle('shine', host && !why);
  if (host) {
    // 시작 stays dim until everyone is ready, then shines (the client's frames 3-5 in turn).
    if (why) paint('Prepare/PRE_Bt_Start', 2);
    else { let f = 0; paint('Prepare/PRE_Bt_Start', 3); shineTimer = setInterval(() => { f = (f + 1) % 3; paint('Prepare/PRE_Bt_Start', 3 + f); }, 180); }
    start.setAttribute('aria-label', '시작');
    start.onclick = () => { if (!why) { sfx('Bt_c_GameStart'); app.send({ t: 'start' }); } else { sfx('Bt_c_Pop', 0.4); app.toast(why); } };
  } else {
    const ready = !!(mine && mine.ready);
    paint('Prepare/PRE_Bt_Ready', ready ? 1 : 0);
    start.setAttribute('aria-label', ready ? '준비 취소' : '준비');
    start.onclick = () => { click(); app.send({ t: 'ready', on: !ready }); };
  }
  lobbyStatus(host ? why || '모두 준비됐어요! 시작을 눌러 주세요'
    : mine && mine.ready ? '준비 완료! 방장이 시작하길 기다리는 중…' : '준비를 누르면 방장이 시작할 수 있어요');
}
let shineTimer = 0;

// [상 점] rebuilt from the client's button at the height of 시작: the frame's ends and its
// middle stretched (nine pieces, the thin top highlight kept thin), the two letters at the
// same scale but closer together.
const PHONE = matchMedia('(max-height: 520px) and (orientation: landscape)');
let shopDrawn = null;
function drawShop(cv) {
  const key = PHONE.matches ? 'p' : 'w';
  if (shopDrawn === key) return;
  A.loadGroup('ui').then(() => {
    const [sw0, sh0] = A.size('GlobalUI/BtShop');
    if (!sw0) return;
    const img = document.createElement('canvas'); img.width = sw0; img.height = sh0;
    const ic = img.getContext('2d'); A.drawAt(ic, 'GlobalUI/BtShop', 0, 0, 0);
    const c = cv.getContext('2d'), W = cv.width, H = cv.height, k = H / sh0;
    c.imageSmoothingEnabled = false; c.clearRect(0, 0, W, H);
    const e = 1.8, T = 6, B = 5, L = 4, R = 4, mid = sw0 >> 1;
    const sx = [0, L, sw0 - R, sw0], dx = [0, L * e, W - R * e, W];
    const sy = [0, T, sh0 - B, sh0], dy = [0, T * 0.9, H - B * e, H];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      const sxa = i === 1 ? mid : sx[i], sw = i === 1 ? 1 : sx[i + 1] - sx[i];
      c.drawImage(img, sxa, sy[j], sw, sy[j + 1] - sy[j], dx[i], dy[j], dx[i + 1] - dx[i], dy[j + 1] - dy[j]);
    }
    // The letters alone: pixels that differ from the button's plain middle on the same row.
    const id = ic.getImageData(0, 0, sw0, sh0), d = id.data;
    for (let y = 0; y < sh0; y++) {
      const b = (y * sw0 + mid) * 4;
      for (let x = 0; x < sw0; x++) {
        const i = (y * sw0 + x) * 4;
        if (Math.abs(d[i] - d[b]) + Math.abs(d[i + 1] - d[b + 1]) + Math.abs(d[i + 2] - d[b + 2]) < 40) d[i + 3] = 0;
      }
    }
    ic.putImageData(id, 0, 0);
    const g = k * (PHONE.matches ? 0.6 : 0.72), gw = 14 * g, gh = 16 * g, gap = 8, gy = Math.round((H - gh) / 2 + 1);
    c.drawImage(img, 12, 4, 14, 16, Math.round(W / 2 - gap / 2 - gw), gy, gw, gh);
    c.drawImage(img, 36, 4, 14, 16, Math.round(W / 2 + gap / 2), gy, gw, gh);
    shopDrawn = key;
  });
}

// The characters I own to switch with one click, and 전체 for the whole list.
function quickChars(app, mine) {
  const cur = mine ? mine.char : W.myChar();
  $('rm-charname').textContent = charById(cur).name;
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
  $('lobby-chars').replaceChildren(...bs, all);
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
  aboveKeyboard(box);
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
  const waiting = room.members.filter((m) => !m.bot && m.id !== room.host && !m.ready);
  if (waiting.length) return waiting.length === 1 ? `${waiting[0].name}님이 아직 준비 안 했어요` : `${waiting.length}명이 아직 준비 안 했어요`;
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
    $('share-link').textContent = '복사됨!';
    setTimeout(() => { $('share-link').textContent = '초대 링크'; }, 2000);
  } catch { lobbyStatus(`이 링크를 보내 주세요: ${url}`); }
}
