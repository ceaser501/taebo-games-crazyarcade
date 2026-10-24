// Builds js/shared/maps-data.js from the PC client's own map files (FxMap Map/<id>, encrypted).
//
//   node crazyarcade/tools/build-maps.mjs ../taebo-games-crazyarcade-assets
//
// A map file (KR 00967): i32 version (1000/1001), ?, ?, width, height, spawn count; spawn cells
// from byte 80 as (col, row); a count of 16-byte rects; then the grid, width·height cells of
// (tile id, object id[, overlay id when version 1001]); then the item drop list (name, weight),
// an i32 and the fixed item placements (name, col, row, chance).
// Ids index fx ObjectTable/ObjectTable: names like Tile00_Box/BoxGray whose layer (Ground, Box,
// Static, Passable) decides collision, each pointing to an animation block whose states name
// the FxTile sprite and its frames (Default, Broken, ShakenHorz...).
// Layout as worked out by the boom-rs project (github.com/aquaplatinumberlitz/boom-rs).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Archive, readIndex } from './ca-formats.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = process.argv[2] || path.join(here, '..', '..', '..', 'taebo-games-crazyarcade-assets');
const SRC = fs.existsSync(path.join(arg, 'pc', 'PatchData')) ? path.join(arg, 'pc', 'PatchData') : arg;
const OUT = path.join(here, '..', 'js', 'shared', 'maps-data.js');
const cp949 = new TextDecoder('euc-kr');

const COLS = 15, ROWS = 13;
const KO = { Village: '빌리지', Patrit: '해적', Camp: '캠프', Factory: '공장', Forest: '숲', Tomb: '묘지', Ice: '아이스', Desert: '사막',
  Cookie: '쿠키', Mine: '광산', Ocean: '바다', Pirate: '해적', Xmas: '크리스마스', Space: '우주', KFG: 'KFG', Aqua: '아쿠아' };
const BGM = { Village: 'Village', Patrit: 'Patrit', Camp: 'Camp', Factory: 'Factory', Forest: 'Forest', Tomb: 'Tomb', Ice: 'Ice',
  Desert: 'Desert', Cookie: 'Cookie', Mine: 'Mine', Ocean: 'Ocean', Pirate: 'Pirate', Xmas: 'Xmas', Space: 'space', KFG: 'Kfg', Aqua: 'Aqua' };
// Map drop names -> the game's item keys (items the game does not have are left out).
const DROPS = { 'Item/ItemBomb': 'bomb', 'Item/ItemFire': 'potion', 'Item/ItemRoller': 'skate', 'Item/ItemMaxPower': 'maxpower',
  'Item/RedDevil': 'devil', RedDevil: 'devil', 'Item/ItemNiddle': 'needle', 'Item/ItemShield': 'shield', 'Item/ItemTurtle0': 'turtle',
  'Item/ItemTurtle1': 'turtle', 'Item/ItemOwl': 'owl' };
const LAYER = { ground: 'floor', box: 'soft', static: 'hard', event: 'hard', deco: 'hard', passable: 'bush', passble: 'bush', passible: 'bush' };

const fxMap = new Archive(SRC, 'FxMap');
const fx = new Archive(SRC, 'fx');
// FxTile sprite names by lower case (the tables do not always match the case).
// Conveyor belts live in fx (TileConv/), everything else in FxTile.
const tiles = new Map([...readIndex(path.join(SRC, 'FxTile.idx')), ...fx.names().filter((n) => n.startsWith('TileConv/')).map((name) => ({ name }))]
  .map((e) => [e.name.toLowerCase(), e.name]));

// ObjectTable: u32 count; (string name, u32 offset of its animation block).
const ot = fx.read('ObjectTable/ObjectTable');
const str = (b, o) => { const n = b.readUInt32LE(o); return [cp949.decode(b.subarray(o + 4, o + 4 + n)).replace(/\0+$/, ''), o + 4 + n]; };
const objects = [];
{
  let o = 4;
  for (let i = ot.readUInt32LE(0); i > 0; i--) { const [name, p] = str(ot, o); objects.push({ name, at: ot.readUInt32LE(p) }); o = p + 4; }
}
// Animation block: u32 states; per state string label, string sprite, u32 n, n × (frame, duration).
function states(at) {
  const out = {};
  let o = at + 4;
  for (let n = ot.readUInt32LE(at), k = 0; k < n; k++) {
    let label, sprite;
    [label, o] = str(ot, o);
    [sprite, o] = str(ot, o);
    const f = ot.readUInt32LE(o); o += 4;
    const frames = [];
    for (let j = 0; j < f; j++) frames.push(ot.readUInt32LE(o + 8 * j));
    o += 8 * f;
    out[label] = { sprite, frames };
  }
  return out;
}

function parseMap(b) {
  const I = (o) => b.readInt32LE(o);
  const ver = I(0), W = I(12), H = I(16), nsp = I(20);
  let o = 80;
  const spawns = [];
  for (let k = 0; k < nsp; k++, o += 8) spawns.push([I(o), I(o + 4)]);
  o += 4 + 16 * I(o);
  const per = ver === 1001 ? 3 : 2, cells = [];
  for (let k = 0; k < W * H; k++) cells.push([I(o + 4 * per * k), I(o + 4 * per * k + 4)]);
  o += 4 * per * W * H;
  const drops = [];
  for (let n = I(o), k = (o += 4, 0); k < n; k++) { let name; [name, o] = str(b, o); drops.push([name, I(o)]); o += 4; }
  return { ver, W, H, spawns, cells, drops };
}

const previews = fxMap.names().filter((n) => /^Etc\/.+_mm$/.test(n)).map((n) => n.slice(4, -3));
const maps = [], skipped = [];
for (const id of previews.sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))) {
  const pre = id.match(/^[A-Za-z]+/)[0], cap = pre[0].toUpperCase() + pre.slice(1);
  // Battle maps only (the ladder/practice themes); event, monster and lobby maps need rules the game lacks.
  if (!KO[cap] || !fxMap.has(`Map/${id}`)) continue;
  let m;
  try { m = parseMap(fxMap.read(`Map/${id}`)); } catch (e) { skipped.push(`${id} (${e.message})`); continue; }
  if (m.W !== COLS || m.H !== ROWS || m.spawns.length < 2) { skipped.push(`${id} ${m.W}x${m.H}`); continue; }
  const list = [], index = new Map(), sets = new Set();
  let bad = null;
  const tile = (id, want) => {
    if (index.has(id)) return index.get(id);
    const o = objects[id];
    // Conveyor belts (TileConv/...) have no layer; they are drawn as floor (they do not carry anyone here).
    const [, set, layer] = o?.name.match(/^([^_/]+)_([^_/]+)[^/]*\//) || (o?.name.startsWith('TileConv/') ? [0, 'TileConv', 'ground'] : []);
    const kind = LAYER[layer?.toLowerCase()];
    const st = o && states(o.at), def = st && (st.Default || Object.values(st)[0]);
    const sprite = def && tiles.get(def.sprite.toLowerCase());
    if (!kind || (want === 'floor') !== (kind === 'floor')) { bad = o ? o.name : `#${id}`; return -1; }
    if (!sprite) {
      // Invisible walls (TileTransParent_Static) block without a picture; anything else is missing.
      if (/^TileTrans/i.test(set) && kind === 'hard') list.push(['$cover', 'hard']);
      else { bad = o.name; return -1; }
    } else {
      sets.add(sprite.split('/')[0]);
      const brk = st.Broken && tiles.get(st.Broken.sprite.toLowerCase());
      // [sprite, kind, w, h, crumbling sprite (the same sheet; frames 1.. are the Broken state)]
      list.push(kind === 'soft' ? [sprite, kind, 1, 1, brk || sprite] : [sprite, kind]);
    }
    index.set(id, list.length - 1);
    return list.length - 1;
  };
  // A floor cell of -1 is covered by a neighbour's wide ground sprite (waterways, islands).
  const floor = m.cells.map(([t]) => (t < 0 ? -1 : tile(t, 'floor')));
  const objs = m.cells.map(([, t]) => (t < 0 ? -1 : tile(t, 'obj')));
  if (bad) { skipped.push(`${id} (${bad})`); continue; }
  const spawns = m.spawns.filter(([c, r]) => c >= 0 && r >= 0 && c < COLS && r < ROWS && (objs[r * COLS + c] < 0 || list[objs[r * COLS + c]][1] !== 'hard'));
  const drops = {};
  for (const [name, w] of m.drops) if (DROPS[name] && w > 0) drops[DROPS[name]] = (drops[DROPS[name]] || 0) + w;
  maps.push({ id, name: (KO[cap] || cap) + id.slice(pre.length), theme: [...sets][0], sets: [...sets], bgm: BGM[cap] || 'Village',
    tiles: list, floor, objs, spawns, drops });
}

fs.writeFileSync(OUT, '// The PC client\'s battle maps (FxMap Map/<id>), generated by tools/build-maps.mjs.\n'
  + '// tiles: [sprite, kind, w, h, crumbling sprite]; floor/objs: tile index per cell; drops: map item weights.\n'
  + `export const MAPS = ${JSON.stringify(maps)};\n`);
console.log(`${maps.length} maps -> ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
if (skipped.length) console.log(`skipped ${skipped.length}: ${skipped.join(', ')}`);
