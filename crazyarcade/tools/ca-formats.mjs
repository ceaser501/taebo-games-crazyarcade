// Readers for Crazy Arcade's PatchData archives (the PC client, last patch 00967).
//
// Each archive is a pair: NAME.idx lists entries, NAME.idd holds their bytes back to back.
//   .idx  16-byte header, then one XOR chain: every byte is XORed with the plaintext byte four
//         places earlier. Plaintext records are u32 name length, name (cp949), u32 offset,
//         u32 size, u32 x, u32 y. The first record's length is not stored (it seeds the chain).
//         Entries with x or y set are encrypted with a scheme we cannot read (maps, tables).
//   sprite  i32 frameCount, i32 format (2), i32 atlasCount, i32 ?; atlasCount × (height, width);
//           frameCount × 12 i32 (offX, offY, key, atlas, left, top, right, bottom, canvasW,
//           canvasH, anchorX, anchorY); then per atlas u32 length + pixel stream.
//   pixels  op bytes: top two bits kind, low six count. 0 literal BGR pixels, 1 one BGR pixel
//           repeated, 2 transparent run. A stream starts with c0 (colour only) or c1 + u32
//           length (colour stream, then an alpha stream of the same ops on single bytes, where
//           kind 3 is a fully opaque run).
// A frame's image goes at (anchorX - offX, anchorY - offY) on its canvas; the anchor is the
// bottom-left corner of the 40×40 map cell the thing stands on.
import fs from 'node:fs';
import zlib from 'node:zlib';

const cp949 = new TextDecoder('euc-kr');

function unchain(block, seed) {
  const p = Buffer.alloc(block.length + 4);
  seed.copy(p, 0, 0, 4);
  for (let i = 0; i < block.length; i++) p[i + 4] = block[i] ^ p[i];
  return p.subarray(4);
}

function records(plain, n) {
  const out = [];
  let o = 0;
  for (;;) {
    if (o + n + 16 > plain.length) throw new Error('truncated');
    const name = cp949.decode(plain.subarray(o, o + n));
    out.push({ name, offset: plain.readUInt32LE(o + n), size: plain.readUInt32LE(o + n + 4),
      x: plain.readUInt32LE(o + n + 8), y: plain.readUInt32LE(o + n + 12) });
    o += n + 16;
    if (o >= plain.length) return out;
    n = plain.readUInt32LE(o); o += 4;
    if (n > 512) throw new Error('bad record length');
  }
}

export function readIndex(file) {
  const d = fs.readFileSync(file);
  for (let n = 1; n < 256; n++) {
    const plain = unchain(d.subarray(16), Buffer.from([n, 0, 0, 0]));
    if (plain.readUInt32LE(n) !== 0) continue;
    try { return records(plain, n); } catch { /* try the next length */ }
  }
  throw new Error(`cannot read ${file}`);
}

// An archive opened for reading: entries by name and their bytes on demand.
export class Archive {
  constructor(dir, base) {
    this.entries = new Map(readIndex(`${dir}/${base}.idx`).map((e) => [e.name, e]));
    this.fd = fs.openSync(`${dir}/${base}.idd`, 'r');
  }
  names() { return [...this.entries.keys()]; }
  has(name) { return this.entries.has(name); }
  read(name) {
    const e = this.entries.get(name);
    if (!e) throw new Error(`missing ${name}`);
    const b = Buffer.alloc(e.size);
    fs.readSync(this.fd, b, 0, e.size, e.offset);
    return b;
  }
}

export function isSprite(b) {
  if (b.length < 16) return false;
  const n = b.readInt32LE(0), fmt = b.readInt32LE(4), na = b.readInt32LE(8);
  return n > 0 && n < 5000 && fmt === 2 && na > 0 && na < 500;
}

export function parseSprite(b) {
  const n = b.readInt32LE(0), na = b.readInt32LE(8);
  let o = 16;
  const sizes = [];
  for (let i = 0; i < na; i++) { sizes.push({ h: b.readInt32LE(o), w: b.readInt32LE(o + 4) }); o += 8; }
  const frames = [];
  for (let i = 0; i < n; i++) {
    const v = [];
    for (let k = 0; k < 12; k++) v.push(b.readInt32LE(o + 4 * k));
    o += 48;
    frames.push({ ox: v[0], oy: v[1], atlas: v[3], x: v[4], y: v[5], w: v[6] - v[4], h: v[7] - v[5],
      cw: v[8], ch: v[9], ax: v[10], ay: v[11] });
  }
  const atlases = sizes.map(({ w, h }) => {
    const len = b.readUInt32LE(o); o += 4;
    const data = b.subarray(o, o + len); o += len;
    return { w, h, data };
  });
  return { frames, atlases };
}

function runs(data, n, size, put, full) {
  let p = 0, i = 0;
  while (i < data.length && p < n) {
    const op = data[i++], kind = op >> 6, cnt = op & 63;
    if (kind === 2) p += cnt;
    else if (kind === 1) { const at = i; i += size; for (let k = 0; k < cnt; k++) put(p++, data, at); }
    else if (kind === 0) for (let k = 0; k < cnt; k++) { put(p++, data, i); i += size; }
    else if (full) for (let k = 0; k < cnt; k++) full(p++);
    else throw new Error(`pixel op ${op.toString(16)}`);
  }
}

// Atlas pixels -> RGBA buffer.
export function decodePixels({ w, h, data }) {
  const n = w * h, out = Buffer.alloc(n * 4);
  if (!data.length) return out;
  const col = (p, d, at) => { if (p < n) { out[p * 4] = d[at + 2]; out[p * 4 + 1] = d[at + 1]; out[p * 4 + 2] = d[at]; out[p * 4 + 3] = 255; } };
  if (data[0] === 0xc0) runs(data.subarray(1), n, 3, col);
  else if (data[0] === 0xc1) {
    const len = data.readUInt32LE(1);
    runs(data.subarray(5, 5 + len), n, 3, col);
    runs(data.subarray(5 + len), n, 1, (p, d, at) => { if (p < n) out[p * 4 + 3] = d[at]; }, (p) => { if (p < n) out[p * 4 + 3] = 255; });
  } else throw new Error(`pixel stream ${data[0].toString(16)}`);
  return out;
}

// Every frame of a sprite cut out of its atlases: { w, h, rgba, dx, dy } where (dx, dy) is the
// image's top-left relative to the anchor.
export function spriteFrames(b) {
  const { frames, atlases } = parseSprite(b);
  const pix = atlases.map(decodePixels);
  return frames.map((f) => {
    const a = atlases[f.atlas], src = pix[f.atlas];
    const w = Math.max(0, Math.min(f.w, a.w - f.x)), h = Math.max(0, Math.min(f.h, a.h - f.y));
    const rgba = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) src.copy(rgba, y * w * 4, ((f.y + y) * a.w + f.x) * 4, ((f.y + y) * a.w + f.x + w) * 4);
    return { w, h, rgba, dx: -f.ox, dy: -f.oy };
  });
}

const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
function crc32(buf) { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }

export function encodePng(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  const chunk = (type, body) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
    const tb = Buffer.concat([Buffer.from(type), body]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(tb));
    return Buffer.concat([len, tb, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// Shelf-packs images (each { w, h }) into sheets no wider than `width`; sets .sheet/.sx/.sy.
export function pack(images, width = 2048, maxHeight = 4096) {
  const order = images.map((im, i) => i).sort((a, b) => images[b].h - images[a].h || images[b].w - images[a].w);
  const sheets = [];
  let cur = null;
  for (const i of order) {
    const im = images[i];
    const w = im.w + 2, h = im.h + 2;
    if (!cur || (cur.x + w > width && cur.y + cur.row + h > maxHeight)) { cur = { x: 0, y: 0, row: 0, w: 0, h: 0 }; sheets.push(cur); }
    if (cur.x + w > width) { cur.x = 0; cur.y += cur.row; cur.row = 0; }
    im.sheet = sheets.length - 1; im.sx = cur.x + 1; im.sy = cur.y + 1;
    cur.x += w; cur.row = Math.max(cur.row, h); cur.w = Math.max(cur.w, cur.x); cur.h = Math.max(cur.h, cur.y + cur.row);
  }
  return sheets.map((s) => {
    const rgba = Buffer.alloc(s.w * s.h * 4);
    return { w: s.w, h: s.h, rgba };
  }).map((s, k) => {
    for (const im of images) if (im.sheet === k)
      for (let y = 0; y < im.h; y++) im.rgba.copy(s.rgba, ((im.sy + y) * s.w + im.sx) * 4, y * im.w * 4, (y + 1) * im.w * 4);
    return s;
  });
}
