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
  ['Space', '우주'], ['Aqua', '아쿠아'],
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
  btn.querySelector('b').textContent = `${m.name} (최대 ${m.spawns.length}명)`;
  btn.disabled = !onClick;
  btn.onclick = onClick ? () => { click(); onClick(); } : null;
}

// Opens the dialog on `current`; onPick(id) on 확인. `need` greys out maps too small for the room.
export function pickMap(current, need, onPick) {
  let sel = mapById(current).id, theme = themeOf(sel);
  const show = () => {
    const m = mapById(sel);
    thumb($('map-big'), m.id);
    $('map-name').textContent = m.name;
    $('map-info').textContent = `최대 ${m.spawns.length}명${m.spawns.length < need ? ' · 인원이 많아요' : ''}`;
    $('map-ok').disabled = m.spawns.length < need;
    for (const b of $('map-list').children) b.classList.toggle('sel', b.dataset.id === sel);
  };
  const list = () => {
    for (const b of $('map-themes').children) b.classList.toggle('on', b.dataset.theme === theme);
    $('map-list').replaceChildren(...MAPS.filter((m) => themeOf(m.id) === theme).map((m) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.id = m.id;
      if (m.spawns.length < need) b.classList.add('full');
      const cv = document.createElement('canvas');
      cv.width = 74; cv.height = 64;
      thumb(cv, m.id);
      b.append(cv, document.createTextNode(m.name), Object.assign(document.createElement('small'), { textContent: `최대 ${m.spawns.length}명` }));
      b.onclick = () => { click(); sel = m.id; show(); };
      b.ondblclick = () => { if (m.spawns.length >= need) done(m.id); };
      return b;
    }));
    show();
    $('map-list').querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
  };
  $('map-themes').replaceChildren(...THEMES.filter(([p]) => MAPS.some((m) => themeOf(m.id) === p)).map(([p, name]) => {
    const b = Object.assign(document.createElement('button'), { type: 'button', textContent: name });
    b.dataset.theme = p;
    b.onclick = () => { click(); theme = p; list(); };
    return b;
  }));
  const close = () => { $('map-pick').hidden = true; };
  const done = (id) => { sfx('Bt_c_Success', 0.6); close(); onPick(id); };
  $('map-ok').onclick = () => done(sel);
  $('map-random').onclick = () => {
    const ok = MAPS.filter((m) => m.spawns.length >= need);
    const m = ok[Math.floor(Math.random() * ok.length)] || MAPS[0];
    sel = m.id; theme = themeOf(sel); list();
  };
  $('map-cancel').onclick = () => { click(); close(); };
  $('map-pick').onclick = (e) => { if (e.target === $('map-pick')) close(); };
  $('map-pick').hidden = false;
  list();
}
