// Ranks: experience from games, the level it makes, and the client's rank icon for a level.
// Shared by the page, the room server and the accounts store.
//
// The client's Etc/LevelIcons holds the icon's parts on a 16×14 canvas: 16 emblems (coin, gem
// crosses, cups, trophies, jewels…) each in bronze, silver and gold, drawn with a coloured plate
// and one to three dots. Level 1 is the beginner's icon (Level/Novice_LevelIcon); after it each
// emblem takes three levels (one, two, three dots), 145 levels in all.

// Frames of Etc/LevelIcons. Four blocks, each with its own dots and plates.
const BLOCKS = [
  { dots: [0, 1, 2], plates: [3, 4, 5, 6, 7], emblems: [8, 11, 14, 17, 20] },
  { dots: [23, 24, 25], plates: [26, 27, 28, 29, 30], emblems: [31, 34, 37, 40, 43] },
  { dots: [46, 47, 48], plates: [49, 50, 51, 52, 53], emblems: [54, 57, 60, 63, 66] },
  { dots: [69, 70, 71], plates: [72, 73, 74, 75, 76], emblems: [77] },
];
const TYPES = BLOCKS.flatMap((b, bi) => b.emblems.map((first) => ({ first, block: bi })));
export const MAX_LEVEL = 1 + TYPES.length * 3 * 3; // 145

// Experience needed to reach a level (level 1 from 0): quick at first, slower later.
export const expFor = (level) => { const n = Math.max(0, Math.min(MAX_LEVEL, level) - 1); return 3 * n * n + 17 * n; };
export function levelOf(exp) {
  let l = 1;
  while (l < MAX_LEVEL && exp >= expFor(l + 1)) l++;
  return l;
}
// { level, into: exp gained in this level, need: exp this level takes (0 at the top) }
export function progress(exp) {
  const level = levelOf(exp);
  return { level, into: exp - expFor(level), need: level < MAX_LEVEL ? expFor(level + 1) - expFor(level) : 0 };
}

// Experience for one game: more for a win, a little for each player caught; half against the
// computer.
export function gainFor(result, kills = 0, practice = false) {
  const base = { win: 30, draw: 15, lose: 10 }[result] || 0;
  const g = base + 4 * Math.max(0, Math.min(10, kills | 0));
  return practice ? Math.round(g / 2) : g;
}

// The parts to draw for a level, in order: [frame of Etc/LevelIcons, ...] or null for level 1
// (the beginner's own icon).
export function rankParts(level) {
  if (level <= 1) return null;
  const k = Math.min(MAX_LEVEL, level) - 2;
  const emblem = Math.floor(k / 3), dots = k % 3;
  const type = TYPES[Math.floor(emblem / 3)], metal = emblem % 3;
  const b = BLOCKS[type.block];
  const plate = b.plates[Math.min(4, Math.floor((Math.floor(emblem / 3) * 5) / TYPES.length))];
  return [type.first + metal, plate, b.dots[dots]];
}
