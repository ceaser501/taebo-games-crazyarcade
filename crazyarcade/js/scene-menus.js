// The screens before a round, on the PC client's own backgrounds and parts:
// the lobby (room list) and the waiting room (seats, character, team, map).
import * as A from './assets.js';
import { stage, ui, text, roundRect, place } from './stage.js';
import { playMusic, sfx } from './audio.js';
import { CHARACTERS, TEAMS, charById, banner, MAX_PLAYERS } from './shared/const.js';
import { MAPS } from './shared/maps.js';
import * as W from './wallet.js';

const $ = (id) => document.getElementById(id);
const click = () => sfx('Bt_c_Pop', 0.6);

function bgOr(c, name, color) {
  const img = A.bg(name);
  if (img) c.drawImage(img, 0, 0); else { c.fillStyle = color; c.fillRect(0, 0, 800, 600); }
}

// ---------------------------------------------------------------- lobby
export class LobbyScene {
  constructor(app) {
    this.app = app; this.rooms = []; this.page = 0; this.onlyWaiting = false; this.status = '방 목록을 불러오는 중…';
    Promise.all([A.loadBg('lobby'), A.loadGroup('ui')]).then(() => playMusic('StageChannel'));
    this.refresh();
    this.timer = setInterval(() => this.refresh(), 3000);
    this.codeInput = $('code-input'); this.codeInput.hidden = false; this.codeInput.value = '';
    this.codeInput.onkeydown = (e) => { if (e.key === 'Enter') this.joinCode(); };
  }
  async refresh() {
    try {
      this.rooms = await this.app.listRooms();
      this.status = this.rooms.length ? '' : '열린 방이 없습니다. 방을 만들어 보세요!';
    } catch { this.status = '서버에 연결할 수 없습니다. (혼자놀기는 됩니다)'; }
  }
  joinCode() { const v = this.codeInput.value.trim(); if (/^\d{4}$/.test(v)) { this.app.joinRoom(v); } else this.app.toast('방 번호 4자리를 입력하세요.'); }
  layout() { place(this.codeInput, 600, 524, 110, 24, 14); }
  draw(now) {
    const c = stage.begin();
    bgOr(c, 'lobby', '#2c9be8');
    ui.begin();
    text('대전 모드', 305, 57, { size: 12, bold: true, color: '#ffe95a', align: 'center' });
    text(this.app.name, 102, 161, { size: 12, bold: true, color: '#fff', align: 'center' });
    text('레벨 1   크아 초보', 95, 214, { size: 11, color: '#e6f4ff', align: 'center' });
    text('혼자놀기 · 방만들기 · 바로시작', 95, 240, { size: 10, color: '#bfe2ff', align: 'center' });
    text(`${W.lucci().toLocaleString()} 루찌`, 95, 268, { size: 12, bold: true, color: '#ffe95a', align: 'center', shadow: '#03306e' });
    if (ui.button('shop', 'GlobalUI/BtShop', 64, 278, { label: '상점', w: 63, h: 24 })) { click(); this.app.toShop(); }
    if (ui.button('create', 'Lobby/LB_Bt_T_CreateRenew', 216, 56, { label: '방만들기' })) { click(); this.app.createRoom(); }
    if (ui.button('quick', 'Lobby/LB_Bt_T_QuickJoinRenew', 354, 56, { label: '바로시작' })) { click(); this.quick(); }
    if (ui.button('practice', 'Lobby/LB_Bt_T_PracticeRenew', 480, 63, { label: '혼자놀기' })) { click(); this.app.practice(); }
    if (ui.button('wait', this.onlyWaiting ? 'Lobby/LB_Bt_T_ShowAllRenew' : 'Lobby/LB_Bt_T_WaitRoomRenew', 580, 63, { label: this.onlyWaiting ? '모든방보기' : '대기방보기' })) { this.onlyWaiting = !this.onlyWaiting; this.page = 0; }
    if (ui.area('back', 683, 63, 85, 47)) { this.app.toHome(); }
    text('← 처음 화면', 725, 92, { size: 12, bold: true, color: '#fff', align: 'center', shadow: '#03306e' });
    const list = this.rooms.filter((r) => !this.onlyWaiting || !r.playing);
    const pages = Math.max(1, Math.ceil(list.length / 6));
    this.page = Math.min(this.page, pages - 1);
    const boxes = [[214, 122], [495, 122], [214, 209], [495, 209], [214, 294], [495, 294]];
    list.slice(this.page * 6, this.page * 6 + 6).forEach((r, i) => {
      const [x, y] = boxes[i];
      const over = ui.state('room' + r.code) !== 'up';
      if (over) { c.fillStyle = 'rgba(120,200,255,0.25)'; c.fillRect(x, y, 274, 80); }
      text(String(r.code), x + 30, y + 24, { size: 16, bold: true, color: '#9fd9ff', align: 'center' });
      text(r.title, x + 60, y + 24, { size: 13, bold: true, color: '#fff', maxW: 205 });
      const map = MAPS.find((m) => m.id === r.map);
      text(`${map ? map.name : r.map}  ·  ${r.mode === 'team' ? '팀전' : '개인전'}`, x + 60, y + 46, { size: 11, color: '#cfe9ff' });
      text(`${r.players} / ${r.seats}`, x + 60, y + 66, { size: 11, color: '#fff' });
      text(r.playing ? '게임중' : '대기중', x + 262, y + 66, { size: 12, bold: true, color: r.playing ? '#ff9a5a' : '#7dff8a', align: 'right' });
      if (ui.area('room' + r.code, x, y, 274, 80, { disabled: r.playing })) { click(); this.app.joinRoom(r.code); }
    });
    if (this.status) text(this.status, 492, 250, { size: 13, color: '#dff1ff', align: 'center' });
    if (pages > 1) {
      if (ui.button('prev', 'Lobby/LB_Bt_Left01', 445, 380, { label: '<', w: 40, h: 20 })) this.page = (this.page + pages - 1) % pages;
      text(`${this.page + 1} / ${pages}`, 492, 395, { size: 12, color: '#fff', align: 'center' });
      if (ui.button('next', 'Lobby/LB_Bt_Right01', 515, 380, { label: '>', w: 40, h: 20 })) this.page = (this.page + 1) % pages;
    }
    const lines = ['크레이지 아케이드에 오신 것을 환영합니다!', '방을 만들고 친구에게 방 번호(4자리)를 알려 주세요.',
      '팀전: 팀 색을 같게 맞추면 같은 편 (1:1, 2:2, 4:4 …)  ·  개인전: 모두가 적', '휴대폰은 가로로 돌려서 하세요. 왼쪽 조이스틱으로 이동, 오른쪽 버튼으로 물풍선!'];
    lines.forEach((l, i) => text(l, 222, 442 + i * 19, { size: 12, color: i ? '#e2f2ff' : '#ffe76a', maxW: 515 }));
    text('방 번호로 입장', 300, 541, { size: 12, bold: true, color: '#fff', align: 'center' });
    if (ui.area('joincode', 716, 522, 54, 28)) this.joinCode();
    text('입장', 743, 541, { size: 12, bold: true, color: '#ffe95a', align: 'center' });
    ui.end();
  }
  quick() {
    const open = this.rooms.find((r) => !r.playing && r.players < r.seats);
    if (open) this.app.joinRoom(open.code); else this.app.createRoom();
  }
  leave() { clearInterval(this.timer); this.codeInput.hidden = true; this.codeInput.onkeydown = null; }
}

// ---------------------------------------------------------------- waiting room
const SLOT_X = [28, 134, 240, 346], SLOT_Y = [95, 240];
export class RoomScene {
  constructor(app) {
    this.app = app; this.mapDialog = false; this.mapPage = 0; this.charPage = 0;
    this.chat = $('chat-input'); this.chat.hidden = false; this.chat.value = '';
    this.chat.onkeydown = (e) => { if (e.key === 'Enter' && this.chat.value.trim()) { app.send({ t: 'chat', text: this.chat.value.trim() }); this.chat.value = ''; } };
    const log = $('chat-log'); log.hidden = false;
    Promise.all([A.loadBg('room'), A.loadGroup('ui'), A.loadGroup('maps')]).then(() => playMusic('Prepare'));
    for (const ch of CHARACTERS) A.loadGroup(`char_${ch.id}`);
  }
  layout() { place(this.chat, 142, 522, 252, 24, 12); place($('chat-log'), 24, 408, 400, 106, 12); }
  draw(now) {
    const app = this.app, room = app.room;
    const c = stage.begin();
    bgOr(c, 'room', '#1b6fd0');
    ui.begin();
    if (!room) { text('방에 들어가는 중…', 400, 300, { size: 18, align: 'center' }); ui.end(); return; }
    const me = room.members.find((m) => m.id === app.me);
    const host = room.host === app.me;
    text(`${room.code}   ${room.title}`, 388, 20, { size: 14, bold: true, color: '#fff', align: 'center', shadow: '#022a5e' });
    if (ui.button('shop', 'GlobalUI/BtShop', 716, 8, { label: '상점', w: 63, h: 24 })) { click(); app.toShop(); }
    // Mode button at the small tab in the top-left.
    if (ui.area('mode', 24, 62, 120, 22, { disabled: !host })) { click(); app.send({ t: 'settings', mode: room.mode === 'team' ? 'solo' : 'team' }); }
    text(room.mode === 'team' ? '팀전' : '개인전', 49, 77, { size: 12, bold: true, color: '#ffe95a', align: 'center' });
    if (host) text('← 눌러서 바꾸기', 105, 77, { size: 10, color: '#cfe9ff', align: 'center' });

    for (let i = 0; i < MAX_PLAYERS; i++) {
      const x = SLOT_X[i % 4], y = SLOT_Y[(i / 4) | 0];
      const s = room.slots[i];
      const m = s.id ? room.members.find((q) => q.id === s.id) : null;
      if (!s.open) {
        A.drawAt(c, 'Prepare/PRE_Bt_Slot-Close', 0, x, y);
        if (ui.area('slot' + i, x, y, 96, 96, { disabled: !host })) app.send({ t: 'slot', i });
        continue;
      }
      if (!m) {
        if (host) {
          text('+ 컴퓨터', x + 48, y + 52, { size: 12, bold: true, color: '#0b4a9a', align: 'center' });
          if (ui.area('slot' + i, x, y, 96, 72)) { click(); app.send({ t: 'bot', i }); }
          if (ui.area('close' + i, x, y + 72, 96, 24)) app.send({ t: 'slot', i });
          text('닫기', x + 48, y + 89, { size: 10, color: '#2a6ab5', align: 'center' });
        }
        continue;
      }
      // The seated character, idling like in the client.
      const ch = charById(m.char);
      const frame = Math.floor(now / 160) % Math.max(1, A.charFrames(ch.id, 'Blink') || 1);
      if (!A.drawChar(c, ch.id, A.charFrames(ch.id, 'Blink') ? 'Blink' : 'WalkDown', frame, x + 28, y + 86, m.color)) {
        c.fillStyle = TEAMS[m.color].css; c.beginPath(); c.arc(x + 48, y + 50, 26, 0, Math.PI * 2); c.fill();
      }
      c.fillStyle = TEAMS[m.color].css; c.fillRect(x + 4, y + 104, 10, 10);
      text(m.name, x + 54, y + 114, { size: 11, bold: m.id === app.me, color: m.id === app.me ? '#ffe95a' : '#fff', align: 'center', maxW: 76 });
      const label = room.host === m.id ? 2 : m.ready ? 1 : 0;
      if (label || !m.bot) A.drawAt(c, 'Prepare/PRE_Img', label, x + 1, y + 120);
      if (host && m.id !== app.me && ui.area('slot' + i, x, y, 96, 96)) { click(); app.send({ t: 'kick', id: m.id }); }
      if (host && m.id !== app.me) text(m.bot ? '빼기' : '강퇴', x + 88, y + 12, { size: 10, color: '#ff8080', align: 'right' });
    }

    // Character choice: the chosen one's banner, then a grid of faces.
    const mine = charById(me?.char);
    if (!A.drawAt(c, banner(mine.id), 0, 490, 63)) text(mine.name, 630, 90, { size: 16, bold: true, align: 'center' });
    // 6×3 grid: 16 faces, then "random" and "next page".
    const per = 16, pages = Math.ceil(CHARACTERS.length / per);
    const cells = CHARACTERS.slice(this.charPage * per, this.charPage * per + per).map((ch) => ({ ch }));
    cells.push({ special: 'random' });
    if (pages > 1) cells.push({ special: 'next' });
    cells.forEach((cell, k) => {
      const x = 486 + (k % 6) * 48, y = 117 + Math.floor(k / 6) * 46;
      const id = cell.ch ? 'ch' + cell.ch.id : cell.special;
      const sel = cell.ch && me && me.char === cell.ch.id;
      c.fillStyle = sel ? 'rgba(255,230,80,0.6)' : ui.state(id) === 'over' ? 'rgba(160,220,255,0.35)' : 'rgba(10,50,120,0.35)';
      roundRect(c, x, y, 45, 43, 5); c.fill();
      if (cell.ch) {
        c.save(); c.beginPath(); c.rect(x, y, 45, 43); c.clip();
        A.drawChar(c, cell.ch.id, 'Portrait', 0, x + 1, y + 1, me ? me.color : 0);
        c.restore();
        text(cell.ch.name.replace('럭셔리', '럭').replace('슈퍼', '슈'), x + 22, y + 41, { size: 9, color: '#fff', align: 'center', maxW: 44, shadow: '#022a5e' });
        const owned = W.owns('char', cell.ch.id);
        if (!owned) { c.fillStyle = 'rgba(0,10,40,0.55)'; roundRect(c, x, y, 45, 43, 5); c.fill(); text('🔒', x + 22, y + 26, { size: 14, align: 'center' }); }
        if (ui.area(id, x, y, 45, 43)) {
          click();
          if (owned) { W.setChar(cell.ch.id); app.send({ t: 'set', char: cell.ch.id }); } else app.toast(`${cell.ch.name}은(는) 상점에서 살 수 있어요.`);
        }
      } else if (cell.special === 'random') {
        text('랜덤', x + 22, y + 27, { size: 12, bold: true, color: '#ffe95a', align: 'center' });
        if (ui.area(id, x, y, 45, 43)) { const mine = CHARACTERS.filter((ch) => W.owns('char', ch.id)); const r = mine[Math.floor(Math.random() * mine.length)]; app.send({ t: 'set', char: r.id }); }
      } else {
        text(`${this.charPage + 1}/${pages}▶`, x + 22, y + 27, { size: 11, bold: true, color: '#ffe95a', align: 'center' });
        if (ui.area(id, x, y, 45, 43)) this.charPage = (this.charPage + 1) % pages;
      }
    });

    // Team colours.
    TEAMS.forEach((t, k) => {
      const x = 490 + k * 36, y = 282;
      const sel = me && me.color === k;
      if (ui.button('team' + k, `Prepare/PRE_SelTeam-Basic0${k}`, x, y, { frame: sel ? 3 : undefined, w: 32, h: 32, label: '' })) { click(); app.send({ t: 'set', color: k }); }
    });

    // Map.
    const map = MAPS.find((m) => m.id === room.map) || MAPS[0];
    if (!A.drawAt(c, `Etc/${map.id}_mm`, 0, 488, 350, 148, 128)) { c.fillStyle = '#0c3f86'; c.fillRect(488, 350, 148, 128); }
    text(map.name, 707, 366, { size: 12, bold: true, color: '#fff', align: 'center' });
    text(room.mode === 'team' ? '팀전' : '개인전', 707, 384, { size: 11, color: '#cfe9ff', align: 'center' });
    text(`${room.members.length}명`, 707, 402, { size: 11, color: '#cfe9ff', align: 'center' });
    if (host && ui.button('selmap', 'Prepare/PRE_Bt_Selectmap', 646, 428, { label: '맵선택' })) { click(); this.mapDialog = true; }

    // Start / ready.
    if (host) { if (ui.button('start', 'Prepare/PRE_Bt_Start', 505, 492, { label: '시작' })) { sfx('Bt_c_GameStart'); app.send({ t: 'start' }); } }
    else if (ui.button('ready', 'Prepare/PRE_Bt_Ready', 505, 492, { frame: me && me.ready ? 2 : undefined, label: '준비' })) { sfx(me && me.ready ? 'Bt_c_GameReadyOff' : 'Bt_c_GameReadyOn'); app.send({ t: 'ready', on: !(me && me.ready) }); }
    if (ui.area('leave', 28, 520, 106, 27)) { click(); app.leaveRoom(); }
    text('나가기', 81, 539, { size: 13, bold: true, color: '#fff', align: 'center' });

    if (this.mapDialog) this.drawMapDialog(c, room);
    ui.end();
  }

  drawMapDialog(c, room) {
    c.fillStyle = 'rgba(0,0,0,0.45)'; c.fillRect(0, 0, 800, 600);
    ui.area('modal', 0, 0, 800, 600);
    const x = 168, y = 54;
    if (!A.drawAt(c, 'Prepare/Dlg_PRE-SelMap', 0, x, y)) { c.fillStyle = '#18c8ff'; roundRect(c, x, y, 463, 492, 10); c.fill(); }
    const per = 12, pages = Math.ceil(MAPS.length / per);
    const list = MAPS.slice(this.mapPage * per, this.mapPage * per + per);
    list.forEach((m, k) => {
      const yy = y + 72 + k * 25;
      const sel = m.id === room.map;
      c.fillStyle = sel ? 'rgba(255,230,80,0.6)' : ui.state('map' + m.id) === 'over' ? 'rgba(150,220,255,0.5)' : 'rgba(0,40,110,0.0)';
      c.fillRect(x + 192, yy - 4, 240, 23);
      text(m.name, x + 202, yy + 13, { size: 13, bold: sel, color: '#fff' });
      text(`${m.spawns.length}명`, x + 424, yy + 13, { size: 11, color: '#bfe8ff', align: 'right' });
      if (ui.area('map' + m.id, x + 192, yy - 4, 240, 23)) { click(); this.app.send({ t: 'settings', map: m.id }); }
    });
    const cur = MAPS.find((m) => m.id === room.map) || MAPS[0];
    A.drawAt(c, `Etc/${cur.id}_mm`, 0, x + 26, y + 92, 148, 128);
    text(cur.name, x + 100, y + 250, { size: 14, bold: true, color: '#fff', align: 'center' });
    if (pages > 1) {
      if (ui.area('mprev', x + 192, y + 390, 60, 26)) this.mapPage = (this.mapPage + pages - 1) % pages;
      text('◀ 이전', x + 222, y + 408, { size: 12, bold: true, color: '#ffe95a', align: 'center' });
      text(`${this.mapPage + 1} / ${pages}`, x + 312, y + 408, { size: 12, color: '#fff', align: 'center' });
      if (ui.area('mnext', x + 372, y + 390, 60, 26)) this.mapPage = (this.mapPage + 1) % pages;
      text('다음 ▶', x + 402, y + 408, { size: 12, bold: true, color: '#ffe95a', align: 'center' });
    }
    if (ui.area('mok', x + 124, y + 445, 108, 38)) this.mapDialog = false;
    text('확인', x + 178, y + 470, { size: 14, bold: true, color: '#fff', align: 'center', shadow: '#03306e' });
    if (ui.area('mrandom', x + 240, y + 445, 108, 38)) {
      const fit = MAPS.filter((m) => m.spawns.length >= Math.max(2, room.members.length));
      const m = fit[Math.floor(Math.random() * fit.length)] || MAPS[0];
      this.app.send({ t: 'settings', map: m.id }); }
    text('랜덤', x + 294, y + 470, { size: 14, bold: true, color: '#fff', align: 'center', shadow: '#03306e' });
  }

  leave() { this.chat.hidden = true; this.chat.onkeydown = null; $('chat-log').hidden = true; }
}
