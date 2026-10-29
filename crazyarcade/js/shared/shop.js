// The player's belongings and records: lucci, what they own from the shop and wear, the
// character they play and their games. The same rules run on the accounts server (which keeps
// the truth for signed-in players) and in the page (for guests, and to answer at once).
import { CHARACTERS } from './const.js';

export const START_LUCCI = 10000;
// The eight first characters are everyone's; the rest are bought in the shop.
export const FREE_CHARS = CHARACTERS.slice(0, 8).map((c) => c.id);
export const ROUND_BONUS = { win: 300, draw: 150, lose: 100 };
const KINDS = ['char', 'hat', 'bomb', 'pet'];
const ID = { char: /^C\d{2}$/, hat: /^[A-Z]\d{1,5}$/, bomb: /^Bomb\d{1,4}$/, pet: /^Pet\d{1,4}$/ };
export const validItem = (kind, id) => KINDS.includes(kind) && typeof id === 'string' && ID[kind].test(id)
  && (kind !== 'char' || CHARACTERS.some((c) => c.id === id));

// Super characters can be bought from this level on (signed-in players; guests have no level).
export const SUPER_LEVEL = 20;
export const needLevel = (kind, id) => (kind === 'char' && (CHARACTERS.find((c) => c.id === id)?.name || '').startsWith('슈퍼') ? SUPER_LEVEL : 0);

// Prices (the real ones were in the server's shop catalogue, which is gone).
export function price(kind, id) {
  if (kind === 'char') { const n = CHARACTERS.find((c) => c.id === id)?.name || ''; return n.startsWith('슈퍼') ? 30000 : n.startsWith('럭셔리') ? 15000 : 8000; }
  return { hat: 2000, bomb: 1500, pet: 5000 }[kind] || 1000;
}

export function blankWallet() {
  return { lucci: START_LUCCI, owned: { char: [], hat: [], bomb: [], pet: [] }, wear: { hat: null, bomb: null, pet: null },
    char: CHARACTERS[0].id, stats: { games: 0, wins: 0, draws: 0, kills: 0 } };
}

// A wallet from anywhere (old saves, another phone) made whole and sane.
export function cleanWallet(w) {
  const b = blankWallet();
  if (!w || typeof w !== 'object') return b;
  const num = (v, d) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : d);
  const out = { lucci: num(w.lucci, b.lucci), owned: {}, wear: {}, char: b.char, stats: {} };
  for (const k of KINDS) out.owned[k] = [...new Set((w.owned?.[k] || []).filter((id) => validItem(k, id)))].slice(0, 2000);
  for (const k of ['hat', 'bomb', 'pet']) out.wear[k] = w.wear?.[k] && out.owned[k].includes(w.wear[k]) ? w.wear[k] : null;
  out.char = validItem('char', w.char) && owns(out, 'char', w.char) ? w.char : b.char;
  for (const k of Object.keys(b.stats)) out.stats[k] = num(w.stats?.[k], 0);
  return out;
}

export const owns = (w, kind, id) => (kind === 'char' && FREE_CHARS.includes(id)) || !!w.owned[kind]?.includes(id);

// Changes a wallet in place; each returns 'ok' or why not. level: the buyer's rank.
export function buy(w, kind, id, level = 0) {
  if (!validItem(kind, id)) return 'bad';
  if (owns(w, kind, id)) return 'owned';
  if (level < needLevel(kind, id)) return 'level';
  const p = price(kind, id);
  if (w.lucci < p) return 'poor';
  w.lucci -= p; w.owned[kind].push(id);
  if (kind !== 'char') w.wear[kind] = id;
  return 'ok';
}
export function wear(w, kind, id) {
  if (!['hat', 'bomb', 'pet'].includes(kind) || (id !== null && !owns(w, kind, id))) return 'bad';
  w.wear[kind] = id;
  return 'ok';
}
export function setChar(w, id) {
  if (!validItem('char', id) || !owns(w, 'char', id)) return 'bad';
  w.char = id;
  return 'ok';
}
// A finished game: its lucci (coins picked up plus the bonus) and the record.
export function roundDone(w, result, kills, coins) {
  const lucci = Math.max(0, Math.min(5000, coins | 0)) + (ROUND_BONUS[result] || 0);
  w.lucci += lucci;
  w.stats.games++;
  if (result === 'win') w.stats.wins++; else if (result === 'draw') w.stats.draws++;
  w.stats.kills += Math.max(0, Math.min(10, kills | 0));
  return lucci;
}
