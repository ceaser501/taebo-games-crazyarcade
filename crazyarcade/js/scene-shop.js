// The shop, on the client's last shop screen (Shop/StageNew + Shop/ShopMainBG): goods on the
// left, the character wearing them on the right, lucci at the bottom. Characters, hats and hair,
// balloon skins and pets, bought with lucci from games (see wallet.js).
import * as A from './assets.js';
import { stage, ui, text, roundRect } from './stage.js';
import { playMusic, sfx } from './audio.js';
import { CHARACTERS, charById } from './shared/const.js';
import * as W from './wallet.js';

const click = () => sfx('Bt_c_Pop', 0.6);
const TABS = [
  { id: 'char', sprite: 'Shop/S_TabChar', label: '캐릭터' },
  { id: 'item', sprite: 'Shop/S_TabItem', label: '아이템' },
  { id: 'pet', sprite: 'Shop/S_TabSpecial', label: '스페셜' },
];
const COLS = 7, ROWS = 4, PER = COLS * ROWS;
const DIRS = ['Down', 'Left', 'Up', 'Right'];
const KIND_NAME = { char: '캐릭터', hat: '머리장식', bomb: '물풍선', pet: '펫' };

export class ShopScene {
  constructor(app, back, char) {
    Object.assign(this, { app, back });
    this.tab = 'item'; this.sub = 'hat'; this.page = 0; this.sel = null; this.confirm = null;
    this.char = char && charById(char).id === char ? char : CHARACTERS[0].id;
    this.cat = { hats: [], bombs: [], pets: [] };
    Promise.all([A.loadBg('shop'), A.loadGroup('shop'), A.loadGroup('ui'), A.loadGroup('game'), W.deco().then((c) => { this.cat = c; })])
      .then(() => playMusic('StageChannel'));
    for (const g of ['icons_hat', 'icons_bomb', 'icons_pet']) A.loadGroup(g);
    for (const ch of CHARACTERS) A.loadGroup(`char_${ch.id}`);
    this.preview = W.look();
    W.loadLook(this.preview);
  }

  kind() { return this.tab === 'char' ? 'char' : this.tab === 'pet' ? 'pet' : this.sub; }
  list() {
    const k = this.kind();
    if (k === 'char') return CHARACTERS.filter((c) => !W.FREE_CHARS.includes(c.id)).map((c) => c.id);
    return { hat: this.cat.hats, bomb: this.cat.bombs, pet: this.cat.pets }[k] || [];
  }
  name(kind, id) {
    if (kind === 'char') return charById(id).name;
    const i = this.list().indexOf(id);
    return `${KIND_NAME[kind]} ${i + 1}호`;
  }
  icon(c, kind, id, x, y, size) {
    if (kind === 'char') {
      c.save(); c.beginPath(); c.rect(x, y, size, size); c.clip();
      A.drawChar(c, id, 'Portrait', 0, x + (size - 45) / 2, y + (size - 43) / 2, 0);
      c.restore(); return;
    }
    const sprite = kind === 'hat' ? `Icon/CharDeco_${id}icon` : kind === 'bomb' ? `Icon/${id}icon` : `Pet/${id}_WalkingDown`;
    const [w, h] = A.size(sprite);
    if (!w) return;
    const s = Math.min(1.4, size / Math.max(w, h));
    A.drawAt(c, sprite, 0, x + (size - w * s) / 2, y + (size - h * s) / 2, w * s, h * s);
  }

  select(kind, id) {
    this.sel = { kind, id };
    if (kind === 'char') this.char = id;
    else { this.preview = { ...this.preview, [kind]: id }; W.loadLook(this.preview); }
  }

  draw(now) {
    const bg = A.bg('shop');
    const c = stage.begin(bg);
    if (!bg) { c.fillStyle = '#0d47b0'; c.fillRect(0, 0, 800, 600); }
    A.drawAt(c, 'Shop/ShopMainBG', 0, 0, 0);
    ui.begin();
    if (this.confirm) ui.area('modal', 0, 0, 800, 600);

    // Tabs over the goods panel.
    TABS.forEach((t, i) => {
      const sel = this.tab === t.id;
      if (ui.button('tab' + t.id, t.sprite, 14 + i * 86, 64 + (sel ? 0 : 2), { frame: sel ? 2 : undefined, label: t.label, w: 82, h: 30 })) {
        click(); this.tab = t.id; this.page = 0;
      }
    });
    text('상점', 400, 30, { size: 18, bold: true, color: '#fff', align: 'center', shadow: '#03306e' });

    // Goods: a grid over the banner and the slot area.
    c.fillStyle = 'rgba(4,40,110,0.92)'; roundRect(c, 20, 102, 490, 450, 8); c.fill();
    const kind = this.kind();
    if (this.tab === 'item') {
      for (const [k, label, x] of [['hat', '머리장식', 30], ['bomb', '물풍선', 120]]) {
        const on = this.sub === k;
        c.fillStyle = on ? '#ffd23a' : 'rgba(255,255,255,0.15)'; roundRect(c, x, 108, 84, 24, 6); c.fill();
        text(label, x + 42, 125, { size: 12, bold: true, color: on ? '#4a2a00' : '#fff', align: 'center' });
        if (ui.area('sub' + k, x, 108, 84, 24)) { click(); this.sub = k; this.page = 0; }
      }
    }
    const list = this.list();
    const pages = Math.max(1, Math.ceil(list.length / PER));
    this.page = Math.min(this.page, pages - 1);
    if (!list.length) text(kind === 'char' ? '' : '꾸미기 그림이 아직 변환되지 않았어요 (fetch-extra)', 265, 320, { size: 13, color: '#cfe8ff', align: 'center' });
    list.slice(this.page * PER, this.page * PER + PER).forEach((id, k) => {
      const x = 30 + (k % COLS) * 68, y = 140 + Math.floor(k / COLS) * 96;
      const sel = this.sel && this.sel.kind === kind && this.sel.id === id;
      const owned = W.owns(kind, id), worn = kind !== 'char' && W.wearing(kind) === id;
      if (!A.drawAt(c, 'Shop/S_ItemBack', sel ? 1 : 0, x, y)) { c.fillStyle = sel ? '#5ab8ff' : '#2f7fe0'; roundRect(c, x, y, 62, 68, 6); c.fill(); }
      this.icon(c, kind, id, x + 4, y + 4, 54);
      if (worn) text('착용중', x + 31, y + 64, { size: 10, bold: true, color: '#ffe95a', align: 'center', shadow: '#03306e' });
      text(owned ? '보유' : `${W.price(kind, id).toLocaleString()}`, x + 31, y + 84, { size: 11, bold: owned, color: owned ? '#7dff8a' : '#fff', align: 'center' });
      if (ui.area(`g${kind}${id}`, x, y, 62, 88)) { click(); this.select(kind, id); }
    });
    if (pages > 1) {
      if (ui.area('prev', 30, 524, 90, 24)) this.page = (this.page + pages - 1) % pages;
      text('◀ 이전', 75, 541, { size: 13, bold: true, color: '#ffe95a', align: 'center' });
      text(`${this.page + 1} / ${pages}`, 265, 541, { size: 12, color: '#fff', align: 'center' });
      if (ui.area('next', 410, 524, 90, 24)) this.page = (this.page + 1) % pages;
      text('다음 ▶', 455, 541, { size: 13, bold: true, color: '#ffe95a', align: 'center' });
    }

    // The character wearing the selection, turning round on the lego floor.
    const dir = DIRS[Math.floor(now / 1500) % 4];
    const action = 'Walk' + dir, n = Math.max(1, A.charFrames(this.char, action));
    const frame = 1 + (Math.floor(now / 120) % Math.max(1, n - 1));
    const ax = 643, ay = 430;
    c.fillStyle = 'rgba(0,0,0,0.25)'; c.beginPath(); c.ellipse(ax + 20, ay - 3, 16, 5, 0, 0, Math.PI * 2); c.fill();
    if (this.preview.pet) {
      const ps = `Pet/${this.preview.pet}_Walking${dir}`;
      if (A.frames(ps)) A.draw(c, ps, Math.floor(now / 110) % A.frames(ps), ax + 52, ay + 30);
    }
    A.drawChar(c, this.char, action, frame, ax, ay, 0);
    if (this.preview.hat) {
      const hat = `CharDeco/CharDeco_${this.preview.hat}${dir}`;
      if (A.frames(hat)) A.draw(c, hat, (frame - 1) % A.frames(hat), ax, ay);
    }
    if (this.preview.bomb) {
      const b = `BombDeco/${this.preview.bomb}`;
      if (A.frames(b)) A.draw(c, b, Math.floor(now / 140) % A.frames(b), 560, 488);
    }

    // The selected item: icon, name, price, buy / wear.
    if (this.sel) {
      const { kind: k, id } = this.sel;
      this.icon(c, k, id, 556, 200, 82);
      text(this.name(k, id), 715, 217, { size: 12, bold: true, color: '#fff', align: 'center', maxW: 118 });
      const owned = W.owns(k, id);
      if (!owned) {
        text(`${W.price(k, id).toLocaleString()} 루찌`, 715, 244, { size: 13, bold: true, color: '#ffe95a', align: 'center' });
        if (this.button('buy', 668, 254, 94, 26, '구매')) { click(); this.confirm = this.sel; }
      } else if (k === 'char') {
        text('보유 중 · 대기방에서 고르세요', 715, 250, { size: 11, color: '#7dff8a', align: 'center' });
      } else {
        const worn = W.wearing(k) === id;
        if (this.button('wear', 668, 254, 94, 26, worn ? '벗기' : '착용')) {
          click(); W.wear(k, worn ? null : id); this.preview = W.look(); W.loadLook(this.preview); this.app.lookChanged();
        }
      }
    } else text('왼쪽에서 물건을 고르세요', 715, 230, { size: 11, color: '#cfe8ff', align: 'center' });

    // Lucci.
    if (!A.drawAt(c, 'Shop/BG_LucciAmount', 0, 556, 518)) { c.fillStyle = '#0a3a8a'; roundRect(c, 556, 518, 214, 39, 6); c.fill(); }
    text(`${W.lucci().toLocaleString()}`, 760, 542, { size: 15, bold: true, color: '#ffe95a', align: 'right' });
    text('루찌', 586, 542, { size: 12, bold: true, color: '#03306e', align: 'center' });

    if (this.button('exit', 20, 562, 120, 30, '← 나가기')) { click(); this.back(); }

    if (this.confirm) this.drawConfirm(c);
    ui.end();
  }

  button(id, x, y, w, h, label) {
    const st = ui.state(id);
    c2(st, x, y, w, h);
    text(label, x + w / 2, y + h / 2 + 5, { size: 13, bold: true, color: '#fff', align: 'center', shadow: '#03306e' });
    return ui.area(id, x, y, w, h);
  }

  drawConfirm(c) {
    const { kind: k, id } = this.confirm;
    c.fillStyle = 'rgba(0,0,0,0.5)'; c.fillRect(0, 0, 800, 600);
    const x = 204, y = 140;
    if (!A.drawAt(c, 'Shop/S_DlgBuy', 0, x, y)) { c.fillStyle = '#1d7cf2'; roundRect(c, x, y, 393, 349, 12); c.fill(); }
    text('구매하기', x + 196, y + 34, { size: 16, bold: true, color: '#fff', align: 'center', shadow: '#03306e' });
    this.icon(c, k, id, x + 156, y + 70, 82);
    text(this.name(k, id), x + 196, y + 180, { size: 14, bold: true, color: '#fff', align: 'center', shadow: '#03306e' });
    const p = W.price(k, id), left = W.lucci() - p;
    text(`가격 ${p.toLocaleString()} 루찌`, x + 196, y + 210, { size: 13, color: '#ffe95a', align: 'center', shadow: '#03306e' });
    text(left >= 0 ? `남는 루찌 ${left.toLocaleString()}` : `루찌가 ${(-left).toLocaleString()} 모자라요`, x + 196, y + 234, { size: 12, color: left >= 0 ? '#e2f2ff' : '#ff9a9a', align: 'center', shadow: '#03306e' });
    if (left >= 0 && this.button('ok', x + 86, y + 280, 100, 32, '구매')) {
      const r = W.buy(k, id);
      if (r === 'ok') { sfx('Bt_c_Buy'); this.app.toast(`${this.name(k, id)}을(를) 샀어요!`); if (k !== 'char') { this.preview = W.look(); this.app.lookChanged(); } }
      this.confirm = null;
    }
    if (this.button('cancel', x + 206, y + 280, 100, 32, '취소')) { click(); this.confirm = null; }
  }
}

function c2(st, x, y, w, h) {
  const c = stage.ctx;
  c.fillStyle = st === 'down' ? '#0a5bd8' : st === 'over' ? '#3aa0ff' : '#1d7cf2';
  roundRect(c, x, y, w, h, 6); c.fill();
  c.strokeStyle = '#bfe6ff'; c.lineWidth = 2; c.stroke();
}
