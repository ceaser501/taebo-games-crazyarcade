// Converts the PC client's PatchData (from the private repo ceaser501/taebo-games-crazyarcade-assets)
// into what the browser loads: PNG sprite sheets with a JSON frame table per group, JPEG
// backgrounds and Ogg sounds, all under crazyarcade/assets/ca/.
//
//   node crazyarcade/tools/convert-assets.mjs ../taebo-games-crazyarcade-assets
//
// The argument is the assets checkout (its pc/PatchData folder) or a PatchData folder itself.
// Large .idd files are stored split as NAME.idd.000, .001, ... and joined here.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { Archive, isSprite, spriteFrames, encodePng, pack } from './ca-formats.mjs';
import { MAPS } from '../js/shared/maps-data.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, '..', 'assets', 'ca');

const arg = process.argv[2] || path.join(here, '..', '..', '..', 'taebo-games-crazyarcade-assets');
const SRC = fs.existsSync(path.join(arg, 'pc', 'PatchData')) ? path.join(arg, 'pc', 'PatchData') : arg;
if (!fs.existsSync(SRC)) { console.error(`PatchData not found: ${SRC}`); process.exit(1); }

// Joins split archives into a temp folder once so Archive can read them as single files.
const TMP = path.join(OUT, '..', '.patchdata');
function archive(base) {
  const whole = path.join(SRC, `${base}.idd`);
  if (!fs.existsSync(whole)) {
    const parts = fs.readdirSync(SRC).filter((f) => f.startsWith(`${base}.idd.`)).sort();
    if (!parts.length) throw new Error(`missing ${base}.idd`);
    fs.mkdirSync(TMP, { recursive: true });
    const joined = path.join(TMP, `${base}.idd`);
    if (!fs.existsSync(joined)) {
      const fd = fs.openSync(joined, 'w');
      for (const p of parts) fs.writeSync(fd, fs.readFileSync(path.join(SRC, p)));
      fs.closeSync(fd);
    }
    fs.copyFileSync(path.join(SRC, `${base}.idx`), path.join(TMP, `${base}.idx`));
    return new Archive(TMP, base);
  }
  return new Archive(SRC, base);
}

const glob = (pat) => new RegExp('^' + pat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
const pick = (ar, pats) => { const res = pats.map(glob); return ar.names().filter((n) => res.some((r) => r.test(n))); };

// Characters: classic, luxury and super versions (C00 Dao ... C29 super Lucky Ethi).
const CHARS = Array.from({ length: 30 }, (_, i) => `C${String(i).padStart(2, '0')}`);
// Map themes we build maps from.
// Map themes: the tilesets the maps use (or a list in CA_TILESETS).
const TILESETS = process.env.CA_TILESETS ? process.env.CA_TILESETS.split(',') : [...new Set(MAPS.map((m) => m.theme))].sort();

const GROUPS = [
  { name: 'game', from: [
    ['FxDesktop', ['Bomb/Bomb00', 'Bomb/Bomb02', 'Bomb/Bomb03', 'Bomb/Fire00', 'Bomb/Bubble00', 'Bomb/BombExplosion0*', 'Bomb/HELP!']],
    ['fx', ['Item/Bomb', 'Item/Potion', 'Item/MaxPower', 'Item/Skate', 'Item/RedDevil', 'Item/Niddle', 'Item/Shield', 'Item/Dart',
      'Item/Spring', 'Item/Turtle0', 'Item/Turtle1', 'Item/Owl', 'Item/Shoe', 'Item/Kart', 'Item/ShieldOn', 'Item/ShieldFlash',
      'Item/RescuedEffect', 'Item/ThrownDart', 'Item/UFO*', 'Item/Swimming']],
    ['FxStage', ['Game/Start', 'Game/Win', 'Game/Lose', 'Game/Draw', 'Game/HurryUp', 'Game/Timer', 'Game/TeamColor', 'Game/SelfIndicator*',
      'Game/StartIndicator*', 'Game/UserItemBox00', 'Game/UserItemkey00', 'Game/ItemBox0*', 'Game/Player0*', 'Game/Rank', 'Game/Tie',
      'Game/ResultImg', 'Game/ResultInfoBar', 'Game/ResultEffect01', 'Game/Nice', 'Game/Perfect', 'Game/First', 'Game/Kill_Image*']],
  ] },
  { name: 'ui', from: [
    ['FxDesktop', ['LoginStage/*', 'GlobalUI/GlobalBar', 'GlobalUI/BtBack', 'GlobalUI/BtExit', 'GlobalUI/BtShop', 'GlobalUI/BtMyInfo',
      'GlobalUI/BtLobby', 'GlobalUI/BtMenu', 'GlobalUI/Dlg_Back']],
    ['FxStage', ['Lobby/LB_*', 'Lobby/Dlg_Creat', 'Lobby/Dlg_Creat01', 'Lobby/Dlg_LB-RoomInfo*', 'Lobby/Dlg_LB-RoomPw', 'Lobby/Dlg_PasswordBg',
      'Lobby/Gametype_*', 'Lobby/Normal_bt0*', 'Lobby/Battle_bt0*', 'Lobby/BtCheckBox', 'Lobby/ReadyBox', 'Lobby/TextBox', 'Lobby/new_small',
      'Lobby/new_big', 'Lobby/HeartIcon_*']],
    ['FxMap', ['Prepare/PRE_*', 'Prepare/Dlg_PRE-*', 'Prepare/S_Selrandom', 'Prepare/UI_WaterDrop', 'Theme/*']],
    ['FxContents', ['CharacterSelect/*']],
  ] },
  // Map previews for the map list (zlib-wrapped sprites in FxMap's Etc/).
  { name: 'maps', from: [['FxMap', MAPS.map((m) => `Etc/${m.id}_mm`)]] },
  ...TILESETS.map((t) => ({ name: `tile_${t}`, from: [['FxTile', [`${t}/*`]]] })),
  ...CHARS.map((c) => ({ name: `char_${c}`, from: [['FxCharacter', [`Character/${c}-*`]]] })),
];

const JPEGS = [
  ['FxDesktop', 'LoginStage/CAStage', 'login'],
  ['FxStage', 'Lobby/CAStage', 'lobby'],
  ['FxMap', 'Prepare/CAStage', 'room'],
  ['FxStage', 'Game/CAStage', 'game'],
  ['FxStage', 'Shop/Stage', 'shop'],
];

// Background music by screen and theme, and the sound effects the game uses.
const BGM = ['StageLogin', 'StageChannel', 'Prepare', 'Village', 'Desert', 'Ice', 'Factory', 'Patrit', 'Forest', 'Cookie', 'Ocean', 'Camp',
  'Tomb', 'Mine', 'Pirate', 'Kfg', 'Xmas', 'Bula', 'Ntc_Win', 'Ntc_Lose', 'Ntc_Draw', 'Ntc_Hurryup', 'Ntc_GameEnd', 'BreakTime', 'ShowTime',
  'RetroVillage', 'RetroForest', 'RetroFactory', 'RetroCamp', 'RetroPatrit', 'Lovelyroom', 'Aqua', 'Cemetery', 'space'];
const SFX = ['Wave/BombExplosion0*', 'Wave/Bt_*', 'Wave/Cha_*', 'Wave/Itm_*', 'Wave/Ntc_*', 'Wave/Game_*', 'Wave/Stage_*', 'Wave/Sys_*',
  'Wave/Lobby_*', 'Wave/Room_*', 'Wave/Pre_*', 'Wave/Effect_*'];

function emitGroup(group) {
  const images = [], table = {};
  for (const [base, pats] of group.from) {
    const ar = archive(base);
    for (const name of pick(ar, pats)) {
      let b = ar.read(name);
      if (name.endsWith('_mm') && !isSprite(b)) { try { b = zlib.inflateSync(b.subarray(8)); } catch { continue; } }
      if (!isSprite(b)) continue;
      let frames;
      try { frames = spriteFrames(b); } catch (e) { console.warn(`skip ${name}: ${e.message}`); continue; }
      table[name] = frames.map((f) => { images.push(f); return f; });
    }
  }
  if (!images.length) { console.warn(`group ${group.name}: nothing`); return null; }
  const sheets = pack(images.filter((f) => f.w && f.h));
  const files = sheets.map((s, k) => {
    const file = `${group.name}_${k}.png`;
    fs.writeFileSync(path.join(OUT, file), encodePng(s.w, s.h, s.rgba));
    return file;
  });
  const sprites = {};
  for (const [name, frames] of Object.entries(table))
    sprites[name] = frames.map((f) => (f.w && f.h ? [f.sheet, f.sx, f.sy, f.w, f.h, f.dx, f.dy] : [-1, 0, 0, 0, 0, 0, 0]));
  fs.writeFileSync(path.join(OUT, `${group.name}.json`), JSON.stringify({ sheets: files, sprites }));
  const bytes = files.reduce((n, f) => n + fs.statSync(path.join(OUT, f)).size, 0);
  console.log(`${group.name}: ${Object.keys(sprites).length} sprites, ${files.length} sheets, ${(bytes / 1e6).toFixed(1)} MB`);
  return { name: group.name, sprites: Object.keys(sprites).length };
}

const only = process.env.CA_ONLY ? new RegExp(process.env.CA_ONLY) : null;
if (!only) fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'bg'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'bgm'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'sfx'), { recursive: true });

const groups = [];
for (const g of GROUPS) if (!only || only.test(g.name)) { const r = emitGroup(g); if (r) groups.push(r.name); }
// A partial run keeps the groups converted before.
if (only) for (const f of fs.readdirSync(OUT)) if (f.endsWith('.json') && f !== 'manifest.json' && !groups.includes(f.slice(0, -5))) groups.push(f.slice(0, -5));

for (const [base, name, file] of JPEGS) {
  const ar = archive(base);
  if (ar.has(name)) fs.writeFileSync(path.join(OUT, 'bg', `${file}.jpg`), ar.read(name));
}

// Sounds are Ogg Vorbis, which iPhones cannot play; with ffmpeg around they become MP3.
let ffmpeg = false;
try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); ffmpeg = process.env.CA_OGG !== '1'; } catch { /* keep Ogg */ }
const audio = ffmpeg ? 'mp3' : 'ogg';
function writeSound(dir, name, bytes, bitrate) {
  const out = path.join(OUT, dir, `${name}.${audio}`);
  if (!ffmpeg) { fs.writeFileSync(out, bytes); return; }
  const tmp = path.join(OUT, dir, `${name}.tmp.ogg`);
  fs.writeFileSync(tmp, bytes);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', tmp, '-codec:a', 'libmp3lame', '-b:a', bitrate, out]);
  fs.rmSync(tmp);
}
const snd = only && !only.test('sound') ? null : archive('FxSound');
const bgm = [];
const sfx = [];
if (snd) {
  for (const n of BGM) if (snd.has(`MP3/${n}`)) { writeSound('bgm', n, snd.read(`MP3/${n}`), '128k'); bgm.push(n); }
  for (const n of pick(snd, SFX)) { const s = n.slice(5); writeSound('sfx', s, snd.read(n), '96k'); sfx.push(s); }
} else {
  // Partial run: keep the sounds from before.
  for (const f of fs.readdirSync(path.join(OUT, 'bgm'))) bgm.push(f.replace(/\.\w+$/, ''));
  for (const f of fs.readdirSync(path.join(OUT, 'sfx'))) sfx.push(f.replace(/\.\w+$/, ''));
}

fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({ groups, bg: JPEGS.map((j) => j[2]), bgm, sfx, audio }, null, 1));
fs.rmSync(TMP, { recursive: true, force: true });
console.log(`bgm ${bgm.length}, sfx ${sfx.length} -> ${OUT}`);
