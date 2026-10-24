// Fetches the two packs that are not in the PatchData of the last patch but are in the full
// client installer on archive.org (Crazy_arcade_megaarchive, official_client/Full/CrazyArcade.z00):
//   CharTE  decorations: balloon skins (BombDeco), hats and hair (CharDeco) and their icons
//   FxMonster  rides (Ship/*) among the monsters
// Only the needed members are read out of the 680 MB archive with HTTP range requests and
// inflated into crazyarcade/.cache/extra/ (about 100 MB to download, once).
//
//   node crazyarcade/tools/fetch-extra.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const URL = 'https://archive.org/download/Crazy_arcade_megaarchive/official_client/Full/CrazyArcade.z00';
const WANT = ['CharTE.idx', 'CharTE.idd', 'FxMonster.idx', 'FxMonster.idd'];
// Where the members started when this was written; checked before use, searched for if wrong.
const KNOWN = { 'CharTE.idd': 92136467, 'CharTE.idx': 162043018, 'FxMonster.idd': 485289367, 'FxMonster.idx': 513686948 };

const here = path.dirname(fileURLToPath(import.meta.url));
export const EXTRA = path.join(here, '..', '.cache', 'extra');

// curl rather than fetch: it is on every Mac and honours proxy settings.
async function range(from, to) {
  for (let attempt = 0; ; attempt++) {
    try {
      return execFileSync('curl', ['-sSfL', '-r', `${from}-${to}`, URL], { maxBuffer: 64 << 20 });
    } catch (e) {
      if (attempt >= 4) throw e;
      await new Promise((ok) => setTimeout(ok, 2000 * 2 ** attempt));
    }
  }
}

// A local file header at `at`: { name, method, csize, usize, data } or null.
async function header(at) {
  const h = await range(at, at + 29 + 300);
  if (h.readUInt32LE(0) !== 0x04034b50) return null;
  const nl = h.readUInt16LE(26), el = h.readUInt16LE(28);
  return { name: h.subarray(30, 30 + nl).toString('latin1'), method: h.readUInt16LE(8), csize: h.readUInt32LE(18),
    usize: h.readUInt32LE(22), data: at + 30 + nl + el };
}

async function locate(names) {
  const found = {};
  for (const n of names) { const h = KNOWN[n] != null && await header(KNOWN[n]); if (h && h.name === n) found[n] = h; }
  if (Object.keys(found).length === names.length) return found;
  // Walk the archive from the start (it begins with the spanning marker PK00).
  for (let at = 4; ;) {
    const h = await header(at);
    if (!h) break;
    if (names.includes(h.name)) found[h.name] = h;
    if (Object.keys(found).length === names.length) break;
    at = h.data + h.csize;
  }
  return found;
}

async function save(h, file) {
  const tmp = `${file}.part`;
  const out = fs.createWriteStream(tmp);
  const inflate = h.method === 8 ? zlib.createInflateRaw() : null;
  const done = new Promise((ok, fail) => { out.on('finish', ok); out.on('error', fail); inflate?.on('error', fail); });
  if (inflate) inflate.pipe(out);
  const sink = inflate || out;
  const step = 16 << 20;
  for (let at = 0; at < h.csize; at += step) {
    const b = await range(h.data + at, h.data + Math.min(h.csize, at + step) - 1);
    if (!sink.write(b)) await new Promise((ok) => sink.once('drain', ok));
    process.stdout.write(`\r  ${path.basename(file)} ${Math.min(100, Math.round(((at + step) / h.csize) * 100))}%`);
  }
  sink.end();
  await done;
  process.stdout.write('\n');
  if (fs.statSync(tmp).size !== h.usize) throw new Error(`${file}: size ${fs.statSync(tmp).size}, expected ${h.usize}`);
  fs.renameSync(tmp, file);
}

export async function fetchExtra() {
  fs.mkdirSync(EXTRA, { recursive: true });
  const missing = WANT.filter((n) => !fs.existsSync(path.join(EXTRA, n)));
  if (!missing.length) return EXTRA;
  console.log(`archive.org 전체 설치본에서 받는 중: ${missing.join(', ')}`);
  const where = await locate(missing);
  for (const n of missing) {
    if (!where[n]) throw new Error(`${n} not found in the archive`);
    await save(where[n], path.join(EXTRA, n));
  }
  return EXTRA;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fetchExtra().then((dir) => console.log(`ok: ${dir}`)).catch((e) => { console.error(e.message); process.exit(1); });
}
