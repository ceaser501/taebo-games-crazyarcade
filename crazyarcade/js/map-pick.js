// Map choice as the client's 맵 선택하기 dialog: theme tabs, the maps of a theme as small
// pictures, a big picture of the one picked with how many can play on it, and 확인 / 랜덤.
// Also draws the current map onto the .map-btn buttons that open it.
import * as A from './assets.js';
import { sfx } from './audio.js';
import { MAPS } from './shared/maps.js';

const $ = (id) => document.getElementById(id);
const click = () => sfx('Bt_c_Pop', 0.6);
const THEMES = [
  ['Village', '빌리지'], ['Patrit', '해적'], ['Camp', '캠프'], ['Factory', '공장'], ['Forest', '숲'], ['Tomb', '묘지'],
  ['Ice', '아이스'], ['Desert', '사막'], ['Cookie', '쿠키'], ['Mine', '광산'], ['Ocean', '바다'], ['Xmas', '크리스마스'],
  ['Space', '우주'], ['Aqua', '아쿠아'], ['Cemetery', '공동묘지'], ['Retro', '레트로'], ['PangLand', '팡랜드'], ['Island', '섬'],
  ['DarkCastle', '다크캐슬'], ['BlackLucy', '블랙루시'], ['Hamster', '햄스터'], ['Rabbit', '토끼'], ['SnowyFields', '설원'],
  ['LovelyRoom', '러블리룸'], ['NewXmas', '뉴크리스마스'], ['Wriggle', '꿈틀이'], ['Clover', '클로버'], ['Bula', '불라'],
  ['Balansa', '발란사'], ['Baram', '바람'], ['Zzolman', '쫄맨'], ['Kfg', 'KFG'], ['GoldButterfly', '황금나비'], ['WhiteAngel', '화이트엔젤'],
  ['MagNest', '마그네스트'], ['Hiphopclub', '힙합클럽'],
];
const themeOf = (id) => (THEMES.find(([p]) => id.toLowerCase().startsWith(p.toLowerCase())) || THEMES[0])[0];
export const mapById = (id) => MAPS.find((m) => m.id === id) || MAPS[0];

function thumb(cv, id) {
  A.loadGroup('maps').then(() => {
    const c = cv.getContext('2d');
    c.imageSmoothingEnabled = false;
    c.clearRect(0, 0, cv.width, cv.height);
    A.drawAt(c, `Etc/${id}_mm`, 0, 0, 0, cv.width, cv.height);
  });
}

// The button showing the current map; enabled when the player may change it.
export function mapButton(btn, id, onClick) {
  const m = mapById(id);
  thumb(btn.querySelector('canvas'), m.id);
  const sub = btn.querySelector('.sub');
  btn.querySelector('b').textContent = sub ? m.name : `${m.name} (최대 ${m.spawns.length}명)`;
  if (sub) sub.textContent = `최대 ${m.spawns.length}명`;
  const chips = btn.querySelector('.chips');
  if (chips) chips.replaceChildren(...mapChips(m).map((t) => Object.assign(document.createElement('span'), { textContent: t })));
  btn.disabled = !onClick;
  btn.onclick = onClick ? () => { click(); onClick(); } : null;
}

// A line about each theme for the info card.
const THEME_DESC = {
  Village: '나무상자와 집이 많은 빌리지 맵이에요.', Patrit: '배와 나무통 사이로 싸우는 해적 맵이에요.', Camp: '텐트와 모닥불이 있는 캠프 맵이에요.',
  Factory: '기계와 상자가 가득한 공장 맵이에요.', Forest: '나무와 덤불 사이에 숨을 수 있는 숲 맵이에요.', Tomb: '비석 사이를 누비는 으스스한 묘지 맵이에요.',
  Ice: '얼음 블록으로 가득한 아이스 맵이에요.', Desert: '선인장과 모래 언덕이 있는 사막 맵이에요.', Cookie: '과자와 사탕으로 만든 쿠키 맵이에요.',
  Mine: '광석과 수레가 있는 광산 맵이에요.', Ocean: '물속 바위와 산호 사이의 바다 맵이에요.', Xmas: '눈과 선물 상자가 쌓인 크리스마스 맵이에요.',
  Space: '우주 기지 블록 사이를 누비는 우주 맵이에요.', Aqua: '물방울 기둥이 있는 아쿠아 맵이에요.',
};
// The short facts shown as chips: players, modes, theme, what is special.
function mapChips(m) {
  const name = (THEMES.find(([p]) => p === themeOf(m.id)) || THEMES[0])[1];
  return [`최대 ${m.spawns.length}명`, m.spawns.length >= 4 ? '팀전·개인전' : '1:1 · 개인전', name, ...features(m)];
}
// What sets a map apart, for its info card.
function features(m) {
  const out = [];
  const pushable = new Set(m.tiles.map((t, i) => (Array.isArray(t) && t[5] === 1 ? i : -1)).filter((i) => i >= 0));
  if (m.objs.some((t) => pushable.has(t))) out.push('밀 수 있는 상자');
  if (m.conv && m.conv.some(Boolean)) out.push('움직이는 바닥');
  return out;
}

// Opens the dialog on `current`: themes, the maps of one, and a card with the map tapped
// (big picture, players, what is special) to take it. onPick(id); `need` greys out maps too
// small for the room.
export function pickMap(current, need, onPick) {
  let theme = themeOf(mapById(current).id), sel = mapById(current).id;
  const detail = (id) => {
    const m = mapById(id);
    sel = id;
    thumb($('map-big'), m.id);
    $('map-name').textContent = m.name;
    const name = (THEMES.find(([p]) => p === themeOf(m.id)) || THEMES[0])[1];
    const f = features(m);
    const extra = { '밀 수 있는 상자': '밀 수 있는 상자가 있어요.', '움직이는 바닥': '움직이는 바닥이 있어요.' };
    $('map-desc').textContent = [THEME_DESC[themeOf(m.id)] || `원작의 ${name} 대전 맵이에요.`, ...f.map((x) => extra[x])].join(' ');
    const chips = mapChips(m).map((t) => Object.assign(document.createElement('span'), { textContent: t }));
    if (m.spawns.length < need) chips.push(Object.assign(document.createElement('span'), { className: 'warn', textContent: `지금 ${need}명이라 못 해요` }));
    $('map-info').replaceChildren(...chips);
    $('map-ok').disabled = m.spawns.length < need;
    $('map-detail').hidden = false;
  };
  const list = () => {
    for (const b of $('map-themes').children) b.classList.toggle('on', b.dataset.theme === theme);
    $('map-list').replaceChildren(...MAPS.filter((m) => themeOf(m.id) === theme).map((m) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.id = m.id;
      b.classList.toggle('sel', m.id === current);
      if (m.spawns.length < need) b.classList.add('full');
      const cv = document.createElement('canvas');
      cv.width = 80; cv.height = 69;
      thumb(cv, m.id);
      b.append(cv, document.createTextNode(m.name), Object.assign(document.createElement('small'), { textContent: `최대 ${m.spawns.length}명` }));
      b.onclick = () => { click(); detail(m.id); };
      return b;
    }));
    $('map-list').scrollTop = 0;
    $('map-list').querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
  };
  $('map-themes').replaceChildren(...THEMES.filter(([p]) => MAPS.some((m) => themeOf(m.id) === p)).map(([p, name]) => {
    const b = Object.assign(document.createElement('button'), { type: 'button', textContent: name });
    b.dataset.theme = p;
    b.onclick = () => { click(); theme = p; $('map-detail').hidden = true; list(); };
    return b;
  }));
  const close = () => { $('map-pick').hidden = true; };
  $('map-ok').onclick = () => { sfx('Bt_c_Success', 0.6); close(); onPick(sel); };
  $('map-back').onclick = () => { click(); $('map-detail').hidden = true; };
  $('map-random').onclick = () => {
    const ok = MAPS.filter((m) => m.spawns.length >= need);
    // Any map of any theme that fits everyone, taken at once (a different one from now).
    const others = ok.filter((m) => m.id !== mapById(current).id);
    const m = (others.length ? others : ok)[Math.floor(Math.random() * (others.length || ok.length))] || MAPS[0];
    sfx('Bt_c_Success', 0.6); close(); onPick(m.id);
  };
  $('map-cancel').onclick = () => { click(); close(); };
  $('map-pick').onclick = (e) => { if (e.target === $('map-pick')) close(); };
  $('map-detail').hidden = true;
  $('map-pick').hidden = false;
  list();
}
