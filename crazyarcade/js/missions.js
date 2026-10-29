// The 일일미션 popup from the home screen: today's missions and the challenges, each with its
// progress and a 보상받기 button for the 행운 열쇠 it has earned, and the 행운룰렛 a key spins.
// The accounts server keeps and checks all of it (shared/rewards.js); this only shows it.
import * as A from './assets.js';
import { sfx } from './audio.js';
import * as Account from './account.js';
import * as W from './wallet.js';
import { PRIZES } from './shared/rewards.js';
import { fanfareSound } from './fanfare.js';
import { drawRank } from './rank.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => Object.assign(document.createElement(tag), cls ? { className: cls } : {}, html != null ? { innerHTML: html } : {});
const click = () => sfx('Bt_c_Pop', 0.6);
const KEY = 'Item/ItemLuckyKey05';

let st = null, tab = 'list', app = null, spinning = false, last = null;

// The badge on the home screen's button: rows with keys to take.
export async function missionBadge() {
  const n = $('home-missions-n');
  if (!Account.signedIn()) { n.hidden = true; return; }
  const r = await Account.missions('missions');
  if (r && !r.error) { st = r; n.textContent = r.rows; n.hidden = !r.rows; }
}

export async function showMissions(a) {
  app = a;
  if (!Account.signedIn()) { app.toast('닉네임으로 들어오면 일일미션을 할 수 있어요.'); return; }
  click();
  tab = 'list'; last = null;
  $('missions').hidden = false;
  A.loadGroup('game').then(() => { const c = $('ms-key').getContext('2d'); c.imageSmoothingEnabled = false; c.clearRect(0, 0, 26, 26); A.drawAt(c, KEY, 0, 0, 0, 26, 26); });
  for (const g of ['icons_hat', 'icons_bomb', 'icons_pet']) A.loadGroup(g);
  $('ms-close').onclick = () => { click(); close(); };
  $('missions').onclick = (e) => { if (e.target === $('missions')) close(); };
  for (const b of document.querySelectorAll('.ms-tabs button')) b.onclick = () => { if (spinning) return; click(); tab = b.dataset.tab; last = null; render(); };
  if (st) render();
  const r = await Account.missions('missions');
  if (!r) { app.toast('서버에 연결할 수 없어요.'); close(); return; }
  st = r; render();
}
function close() { if (spinning) return; $('missions').hidden = true; $('ms-odds').hidden = true; missionBadge(); }

function render() {
  $('ms-nkeys').textContent = st.keys;
  $('ms-tab-n').textContent = st.rows; $('ms-tab-n').hidden = !st.rows;
  for (const b of document.querySelectorAll('.ms-tabs button')) b.classList.toggle('on', b.dataset.tab === tab);
  $('ms-odds').hidden = true;
  if (tab === 'list') renderList(); else if (tab === 'roulette') renderRoulette(); else if (tab === 'titles') renderTitles(); else renderRanking();
}

const gauge = (have, need) => `<span class="ms-gauge"><i style="width:${Math.round(Math.min(1, have / need) * 100)}%"></i></span>`;
function row(icon, title, sub, gaugeHtml, right, done) {
  const r = el('div', `ms-m${done ? ' done' : ''}`);
  r.innerHTML = `<span class="ic">${icon}</span><span class="t"><b>${title}</b><small>${sub}</small>${gaugeHtml}</span><span class="act"></span>`;
  if (typeof right === 'string') r.querySelector('.act').innerHTML = right; else r.querySelector('.act').append(...right);
  return r;
}
function getButton(id, n) {
  const b = el('button', 'ms-get', '보상받기'); b.type = 'button';
  b.onclick = () => take(id, b);
  return [el('span', 'ms-plus', `+${n}`), b];
}

function renderList() {
  const body = $('ms-body');
  const left = midnight();
  const daily = el('div', 'ms-grid'), chal = el('div', 'ms-grid');
  for (const m of st.daily) {
    const right = m.taken ? '<span class="ms-got">✓ 받음</span>' : m.done ? getButton(m.id, 1) : `<span>${m.have}/${m.need}</span>`;
    daily.append(row(m.icon, m.name, m.taken ? '받았어요' : `오늘 ${m.have} / ${m.need}${m.unit}`, gauge(m.have, m.need), right, m.taken));
  }
  for (const c of st.challenges) {
    let sub = c.sub || '', g = '';
    if (c.id === 'multi') sub = '한 판에 혼자 3명 이상 가두면';
    if (c.id === 'streak') { sub = `지금 ${c.progress.have}연승 · 다음 ${c.progress.next}연승`; g = gauge(c.progress.have, c.progress.next); }
    if (c.id === 'level') { sub = `Lv.${c.progress.have} · 다음 Lv.${c.progress.next}`; g = gauge(c.progress.have % 10, 10); }
    const right = c.ready ? getButton(c.id, c.ready) : c.id === 'streak' ? `<span>${c.progress.have}/${c.progress.next}</span>` : c.id === 'level' ? `<span>Lv.${c.progress.have}/${c.progress.next}</span>` : '';
    chal.append(row(c.icon, c.name, sub, g, right, false));
  }
  body.replaceChildren(
    el('div', 'ms-sec', `오늘의 미션 <small>하루 1번씩 · 자정에 초기화 (${left} 남음)</small>`), daily,
    el('div', 'ms-sec', '도전 보상 <small>달성할 때마다</small>'), chal);
  const foot = $('ms-foot');
  foot.innerHTML = `<span class="info">받을 수 있는 행운 열쇠 <b>${st.ready}개</b></span><span class="mid"></span><span></span>`;
  const all = el('button', 'ms-btn2', '모두받기'); all.type = 'button'; all.disabled = !st.ready; all.onclick = () => take('all', all);
  const go = el('button', 'ms-btn3', '행운룰렛 돌리기'); go.type = 'button'; go.onclick = () => { click(); tab = 'roulette'; render(); };
  foot.querySelector('.mid').append(all, go);
}

async function take(id, b) {
  b.disabled = true;
  const r = await Account.missions('claim', { id });
  if (!r || r.error) { app.toast('잠시 뒤에 다시 해 주세요.'); b.disabled = false; return; }
  sfx('Itm_TakeCoin', 0.8);
  if (r.taken) app.toast(`행운 열쇠 ${r.taken}개를 받았어요!`);
  st = r; render();
}

// Midnight in Korea, as "7시간 12분".
function midnight() {
  const now = Date.now(), k = new Date(now + 9 * 3600 * 1000);
  const ms = 86400000 - ((k.getUTCHours() * 60 + k.getUTCMinutes()) * 60000 + k.getUTCSeconds() * 1000);
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
  return h ? `${h}시간 ${m}분` : `${m}분`;
}

// ---- the roulette
function prizeCanvas(p, item) {
  const cv = el('canvas'); cv.width = 52; cv.height = 52;
  const c = cv.getContext('2d'); c.imageSmoothingEnabled = false;
  const fit = (sprite) => { const [w, h] = A.size(sprite, 0); if (!w) return false; const s = Math.min(48 / w, 48 / h); A.drawAt(c, sprite, 0, (52 - w * s) / 2, (52 - h * s) / 2, w * s, h * s); return true; };
  const sample = { hat: 'A0024', bomb: 'Bomb003', pet: 'Pet003' };
  const draw = () => {
    c.clearRect(0, 0, 52, 52);
    if (p.sprite) return fit(p.sprite);
    const id = item || sample[p.kind];
    if (p.kind === 'hat') return fit(`Icon/CharDeco_${id}icon`);
    if (p.kind === 'bomb') return fit(`Icon/${id}icon`);
    if (p.kind === 'pet') return fit(`Pet/${id}_WalkingDown`);
    c.font = '900 20px "Nanum Gothic", sans-serif'; c.textAlign = 'center'; c.fillStyle = '#7fe0ff'; c.strokeStyle = '#02306b'; c.lineWidth = 4;
    c.strokeText('EXP', 26, 33); c.fillText('EXP', 26, 33); return true;
  };
  if (!draw()) Promise.all(['game', `icons_${p.kind}`].map((g) => A.loadGroup(g).catch(() => null))).then(draw);
  return cv;
}
function slot(p, mid, item) {
  const d = el('div', `ms-slot${mid ? ' mid' : ''}${p.jackpot ? ' jack' : ''}`);
  const name = p.jackpot ? '잭팟<br>10,000 루찌' : p.kind === 'hat' || p.kind === 'bomb' ? p.name.replace(' ', '<br>') : p.name;
  d.append(prizeCanvas(p, item), el('b', null, name));
  return d;
}
let reelIdx = [7, 8, 0, 1, 2, 3, 4];
function renderRoulette() {
  const body = $('ms-body');
  const reel = el('div', `ms-reel${last ? ' won' : ''}`);
  reel.append(...reelIdx.map((k, i) => slot(PRIZES[k], i === 3, i === 3 && last ? last.item : null)));
  const res = el('div', 'ms-result', last ? resultText(last) : '행운 열쇠 1개로 한 번 돌려요');
  const box = el('div', 'ms-rl'); box.append(reel, res);
  body.replaceChildren(box);
  const foot = $('ms-foot');
  foot.innerHTML = `<span class="info">내 행운 열쇠 <b>${st.keys}개</b></span><span class="mid"></span><span></span>`;
  const odds = el('button', 'ms-btn2', '확률표'); odds.type = 'button'; odds.onclick = () => { click(); toggleOdds(); };
  const go = el('button', 'ms-btn3', '행운룰렛 돌리기'); go.type = 'button'; go.disabled = st.keys < 1;
  go.onclick = () => spin(reel, res, go);
  foot.querySelector('.mid').append(odds, go);
}
function resultText(r) {
  const p = PRIZES.find((x) => x.id === r.prize);
  if (r.item) return `🎉 <b>${p.name.replace('랜덤 ', '')}</b> 당첨! 상점에서 바로 착용할 수 있어요`;
  if (p.kind !== 'lucci' && r.lucci) return `🎉 <b>${p.name}</b> 당첨! 모두 가진 종류라 <b>${r.lucci.toLocaleString()} 루찌</b>로 드려요`;
  return `🎉 <b>${p.name}</b> 당첨!`;
}
function toggleOdds() {
  const o = $('ms-odds');
  if (!o.hidden) { o.hidden = true; return; }
  o.innerHTML = `<div class="oh"><b>확률표</b><button type="button" class="ms-x" aria-label="닫기">✕</button></div><div class="og">${PRIZES.map((p) => `<div${p.jackpot ? ' class="j"' : ''}><span>${p.name}</span><span>${p.w / 10}%</span></div>`).join('')}</div>`;
  o.querySelector('button').onclick = () => { click(); o.hidden = true; };
  o.hidden = false;
}

async function spin(reel, res, go) {
  if (spinning || st.keys < 1) return;
  spinning = true; go.disabled = true; $('ms-odds').hidden = true;
  click();
  const deco = await W.deco();
  const ask = Account.missions('spin', { pool: { hat: deco.hats, bomb: deco.bombs, pet: deco.pets } });
  reel.classList.remove('won'); res.innerHTML = '두구두구…';
  // The reel runs fast and slows down; the server's prize arrives in the middle on the last turn.
  const rnd = () => Math.floor(Math.random() * PRIZES.length);
  let n = 0, wait = 45;
  const r = await new Promise((done) => {
    let answer = null; ask.then((x) => { answer = x || { error: 'net' }; });
    const step = () => {
      const landing = answer && n >= 22;
      const win = landing && !answer.error ? PRIZES.findIndex((p) => p.id === answer.spin.prize) : -1;
      reelIdx = [...reelIdx.slice(1), rnd()];
      if (landing && win >= 0) reelIdx[3] = win;
      reel.replaceChildren(...reelIdx.map((k, i) => slot(PRIZES[k], i === 3, landing && i === 3 && answer.spin ? answer.spin.item : null)));
      sfx('Bt_c_Pop', 0.25);
      if (landing) { done(answer); return; }
      n++; if (n > 10) wait *= 1.09;
      setTimeout(step, Math.min(wait, 260));
    };
    step();
  });
  spinning = false;
  if (r.error) { app.toast(r.error === 'keys' ? '행운 열쇠가 없어요.' : '서버에 연결할 수 없어요.'); if (!r.error.startsWith('net')) st = r; render(); return; }
  st = r; last = r.spin;
  const p = PRIZES.find((x) => x.id === r.spin.prize);
  if (p.jackpot) fanfareSound(); else sfx('Bt_c_Success', 0.7);
  render();
}

// ---- titles: each with how far along it is; one earned title can be shown under the name.
function renderTitles() {
  const grid = el('div', 'ms-grid');
  for (const t of st.titles || []) {
    const shown = st.title === t.id;
    let right;
    if (shown) {
      const b = el('button', 'ms-got ms-wearing', '✓ 다는 중'); b.type = 'button'; b.title = '누르면 떼요';
      b.onclick = () => pickTitle(null, b);
      right = [b];
    } else if (t.earned) {
      const b = el('button', 'ms-get', '달기'); b.type = 'button'; b.onclick = () => pickTitle(t.id, b);
      right = [b];
    } else right = t.need > 1 ? `<span>${t.have}/${t.need}</span>` : '<span>🔒</span>';
    const g = t.need > 1 && !t.earned ? gauge(t.have, t.need) : '';
    grid.append(row(t.earned ? '🏅' : '🔒', t.name, t.desc, g, right, false));
  }
  $('ms-body').replaceChildren(el('div', 'ms-sec', '칭호 <small>얻은 칭호 하나를 골라 대기실과 킬/데스 현황판에서 이름 아래에 달아요</small>'), grid);
  const got = (st.titles || []).filter((t) => t.earned).length;
  $('ms-foot').innerHTML = `<span class="info">얻은 칭호 <b>${got}개</b> / ${(st.titles || []).length}개</span><span class="mid"></span><span></span>`;
}
async function pickTitle(id, b) {
  b.disabled = true;
  const r = await Account.missions('title', { id });
  if (!r || r.error) { app.toast('잠시 뒤에 다시 해 주세요.'); b.disabled = false; return; }
  sfx('Bt_c_Success', 0.6);
  app.toast(id ? '칭호를 달았어요. 다음에 들어가는 방부터 보여요.' : '칭호를 뗐어요.');
  st = r; render();
}

// ---- the weekly ranking: experience gained this week, the top ten and my place.
function renderRanking() {
  const rk = st.ranking || { top: [], mine: null, week: '' };
  const list = el('div', 'ms-rank');
  if (!rk.top.length) list.append(el('div', 'ms-empty', '이번 주에는 아직 아무도 경험치를 얻지 않았어요. 첫 번째가 되어 보세요!'));
  for (const e of rk.top) {
    const r = el('div', `ms-rrow${e.me ? ' me' : ''}${e.rank <= 3 ? ` top${e.rank}` : ''}`);
    const cv = el('canvas', 'rk'); cv.width = 16; cv.height = 14;
    A.loadGroup('rank').then(() => drawRank(cv.getContext('2d'), e.level, 0, 0));
    r.append(el('span', 'no', e.rank <= 3 ? ['🥇', '🥈', '🥉'][e.rank - 1] : String(e.rank)), cv, el('b', null, ''), el('span', 'lv', `Lv.${e.level}`), el('span', 'xp', `${e.exp.toLocaleString()} 경험치`));
    r.querySelector('b').textContent = e.name;
    list.append(r);
  }
  const end = new Date(Date.parse(rk.week) + 7 * 86400000);
  $('ms-body').replaceChildren(el('div', 'ms-sec', `주간 랭킹 TOP 10 <small>이번 주(${rk.week.slice(5).replace('-', '/')}~) 얻은 경험치 · 매주 월요일 0시에 새로 시작</small>`), list,
    el('div', 'ms-note', `🏅 이번 주 1위는 다음 주 일주일 동안 <b>주간 1위</b> 칭호를 달 수 있어요 (${end.getUTCMonth() + 1}/${end.getUTCDate()} 0시에 결정)`));
  $('ms-foot').innerHTML = `<span class="info">${rk.mine ? `내 순위 <b>${rk.mine.rank}위</b> · ${rk.mine.exp.toLocaleString()} 경험치` : '이번 주 내 기록이 아직 없어요'}</span><span class="mid"></span><span></span>`;
}
