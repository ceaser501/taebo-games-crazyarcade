// The shop as a phone screen: tabs for characters, hats and hair, balloon skins and pets, a
// grid of goods, and the character wearing the one picked, turning round. Bought with lucci
// from games (wallet.js); the goods' pictures come from the client's CharTE and fx packs.
import * as A from './assets.js';
import { sfx, playMusic } from './audio.js';
import { CHARACTERS, charById } from './shared/const.js';
import * as W from './wallet.js';
import * as Account from './account.js';

const $ = (id) => document.getElementById(id);
const PER = 40;
const KIND_NAME = { char: '캐릭터', hat: '머리장식', bomb: '물풍선', pet: '펫' };
const DIRS = ['Down', 'Left', 'Up', 'Right'];
let st = null; // { app, back, kind, page, sel, preview, char, cat }

export async function showShop(app, back) {
  st = { app, back, kind: 'hat', page: 0, sel: null, preview: W.look(), char: W.myChar(), cat: await W.deco() };
  $('shop').hidden = false;
  playMusic('StageChannel');
  for (const g of ['icons_hat', 'icons_bomb', 'icons_pet', 'game']) A.loadGroup(g);
  W.loadLook(st.preview);
  for (const b of document.querySelectorAll('#shop-tabs button')) b.onclick = () => { sfx('Bt_c_Pop', 0.6); st.kind = b.dataset.kind; st.page = 0; render(); };
  $('shop-close').onclick = () => { sfx('Bt_c_Pop', 0.6); hideShop(); back(); };
  $('shop-prev').onclick = () => { st.page = (st.page + pages() - 1) % pages(); render(); };
  $('shop-next').onclick = () => { st.page = (st.page + 1) % pages(); render(); };
  render();
  animate();
}
export function hideShop() { $('shop').hidden = true; st = null; }

const list = () => (st.kind === 'char' ? CHARACTERS.filter((c) => !W.FREE_CHARS.includes(c.id)).map((c) => c.id)
  : { hat: st.cat.hats, bomb: st.cat.bombs, pet: st.cat.pets }[st.kind] || []);
const pages = () => Math.max(1, Math.ceil(list().length / PER));
const nameOf = (kind, id) => (kind === 'char' ? charById(id).name : `${KIND_NAME[kind]} ${(st.kind === kind ? list() : []).indexOf(id) + 1}호`);

function icon(cv, kind, id) {
  const c = cv.getContext('2d');
  c.clearRect(0, 0, cv.width, cv.height); c.imageSmoothingEnabled = false;
  if (kind === 'char') { A.loadGroup(`char_${id}`).then(() => A.drawChar(c, id, 'Portrait', 0, 5, 6, 0)); return; }
  const sprite = kind === 'hat' ? `Icon/CharDeco_${id}icon` : kind === 'bomb' ? `Icon/${id}icon` : `Pet/${id}_WalkingDown`;
  const draw = () => {
    const [w, h] = A.size(sprite);
    if (!w) return false;
    const s = Math.min(1.5, cv.width / Math.max(w, h));
    A.drawAt(c, sprite, 0, (cv.width - w * s) / 2, (cv.height - h * s) / 2, w * s, h * s);
    return true;
  };
  if (!draw()) A.loadGroup(`icons_${kind}`).then(draw);
}

function render() {
  if (!st) return;
  $('shop-lucci').textContent = W.lucci().toLocaleString();
  for (const b of document.querySelectorAll('#shop-tabs button')) b.classList.toggle('on', b.dataset.kind === st.kind);
  const items = list(), grid = $('shop-grid');
  grid.textContent = '';
  if (!items.length) grid.textContent = '꾸미기 그림이 아직 변환되지 않았어요.';
  for (const id of items.slice(st.page * PER, st.page * PER + PER)) {
    const b = document.createElement('button');
    b.type = 'button';
    const owned = W.owns(st.kind, id);
    b.className = [st.sel?.id === id ? 'sel' : '', owned ? 'owned' : '', st.kind !== 'char' && W.wearing(st.kind) === id ? 'worn' : ''].join(' ');
    const cv = document.createElement('canvas');
    cv.width = 56; cv.height = 56;
    icon(cv, st.kind, id);
    b.append(cv, Object.assign(document.createElement('span'), { textContent: owned ? '보유' : W.price(st.kind, id).toLocaleString() }));
    b.onclick = () => { sfx('Bt_c_Pop', 0.6); select(st.kind, id); };
    grid.append(b);
  }
  $('shop-page').textContent = `${st.page + 1} / ${pages()}`;
  side();
}

function select(kind, id) {
  st.sel = { kind, id };
  if (kind === 'char') st.char = id;
  else { st.preview = { ...st.preview, [kind]: id }; W.loadLook(st.preview); }
  render();
}

// The picked item's name, price and the buy / wear button.
function side() {
  const act = $('shop-act');
  if (!st.sel) { $('shop-name').textContent = '물건을 고르세요'; $('shop-price').textContent = ''; act.hidden = true; return; }
  const { kind, id } = st.sel;
  $('shop-name').textContent = nameOf(kind, id);
  act.hidden = false;
  if (!W.owns(kind, id)) {
    const p = W.price(kind, id), lv = W.needLevel(kind, id), mine = Account.signedIn() ? Account.rank().level : 0;
    $('shop-price').textContent = `${p.toLocaleString()} 루찌${lv ? ` · Lv.${lv}부터` : ''}`;
    const short = lv && mine < lv;
    act.textContent = short ? (Account.signedIn() ? `Lv.${lv}부터 살 수 있어요` : '계정이 있어야 살 수 있어요') : W.lucci() >= p ? '구매' : '루찌 부족';
    act.disabled = short || W.lucci() < p;
    act.onclick = () => {
      if (W.buy(kind, id) !== 'ok') return;
      sfx('Bt_c_Buy');
      st.app.toast(`${nameOf(kind, id)}을(를) 샀어요!`);
      if (kind === 'char') W.setChar(id);
      st.preview = W.look();
      st.app.lookChanged();
      render();
    };
  } else if (kind === 'char') {
    $('shop-price').textContent = '보유 중';
    const mine = W.myChar() === id;
    act.textContent = mine ? '사용 중' : '이 캐릭터로 하기';
    act.disabled = mine;
    act.onclick = () => { W.setChar(id); st.app.send({ t: 'set', char: id }); render(); };
  } else {
    const worn = W.wearing(kind) === id;
    $('shop-price').textContent = '보유 중';
    act.textContent = worn ? '벗기' : '착용';
    act.disabled = false;
    act.onclick = () => { W.wear(kind, worn ? null : id); st.preview = W.look(); W.loadLook(st.preview); st.app.lookChanged(); render(); };
  }
}

// The character wearing the selection, turning round, with the pet and the balloon beside it.
function animate() {
  const cv = $('shop-preview');
  const loop = (now) => {
    if (!st) return;
    const c = cv.getContext('2d');
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, cv.width, cv.height); c.imageSmoothingEnabled = false;
    c.setTransform(1.8, 0, 0, 1.8, 0, 0);
    const dir = DIRS[Math.floor(now / 1500) % 4];
    const action = 'Walk' + dir, n = Math.max(1, A.charFrames(st.char, action));
    const frame = 1 + (Math.floor(now / 120) % Math.max(1, n - 1));
    const ax = 36, ay = 92;
    c.fillStyle = 'rgba(0,0,0,0.25)'; c.beginPath(); c.ellipse(ax + 20, ay - 2, 14, 4, 0, 0, Math.PI * 2); c.fill();
    const p = st.preview;
    if (p.pet && A.frames(`Pet/${p.pet}_Walking${dir}`)) A.draw(c, `Pet/${p.pet}_Walking${dir}`, Math.floor(now / 110), ax + 40, ay + 4);
    A.drawChar(c, st.char, action, frame, ax, ay, 0);
    if (p.hat && A.frames(`CharDeco/CharDeco_${p.hat}${dir}`)) A.draw(c, `CharDeco/CharDeco_${p.hat}${dir}`, (frame - 1) % A.frames(`CharDeco/CharDeco_${p.hat}${dir}`), ax, ay);
    if (p.bomb && A.frames(`BombDeco/${p.bomb}`)) A.draw(c, `BombDeco/${p.bomb}`, Math.floor(now / 140), 2, 104);
    requestAnimationFrame(loop);
  };
  A.loadGroup(`char_${st.char}`).then(() => requestAnimationFrame(loop));
  for (const ch of CHARACTERS) A.loadGroup(`char_${ch.id}`);
}
