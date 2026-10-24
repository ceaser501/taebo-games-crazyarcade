// The player's lucci, what they own from the shop and what they wear, kept in this browser
// (there are no accounts). Lucci come from the coins picked up in games and a bonus per round.
import { CHARACTERS } from './shared/const.js';
import * as A from './assets.js';

const KEY = 'ca-wallet';
const START_LUCCI = 10000;
// The eight first characters are everyone's; the rest are bought in the shop.
export const FREE_CHARS = CHARACTERS.slice(0, 8).map((c) => c.id);
// Prices (the real ones were in the server's shop catalogue, which is gone).
export function price(kind, id) {
  if (kind === 'char') { const n = CHARACTERS.find((c) => c.id === id)?.name || ''; return n.startsWith('슈퍼') ? 30000 : n.startsWith('럭셔리') ? 15000 : 8000; }
  return { hat: 2000, bomb: 1500, pet: 5000 }[kind] || 1000;
}
export const ROUND_BONUS = { win: 300, draw: 150, lose: 100 };

function blank() { return { lucci: START_LUCCI, owned: { char: [], hat: [], bomb: [], pet: [] }, wear: { hat: null, bomb: null, pet: null } }; }
let w = blank();
try {
  const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
  if (saved && typeof saved.lucci === 'number') w = { ...blank(), ...saved, owned: { ...blank().owned, ...saved.owned }, wear: { ...blank().wear, ...saved.wear } };
} catch { /* private mode: start fresh each time */ }
function save() { try { localStorage.setItem(KEY, JSON.stringify(w)); } catch { /* ignore */ } }

export const lucci = () => w.lucci;
export const owns = (kind, id) => (kind === 'char' && FREE_CHARS.includes(id)) || w.owned[kind]?.includes(id);
export const wearing = (kind) => w.wear[kind];
export function buy(kind, id) {
  if (owns(kind, id)) return 'owned';
  const p = price(kind, id);
  if (w.lucci < p) return 'poor';
  w.lucci -= p; w.owned[kind].push(id);
  if (kind !== 'char') w.wear[kind] = id;
  save();
  return 'ok';
}
export function wear(kind, id) { if (id === null || owns(kind, id)) { w.wear[kind] = id; save(); } }
export function earn(n) { if (n > 0) { w.lucci += Math.round(n); save(); } }
// What others see: sent with the character to the room.
export const look = () => ({ hat: w.wear.hat, bomb: w.wear.bomb, pet: w.wear.pet });

// The shop catalogue (assets/ca/deco.json, written by the converter) and the sprite groups
// that hold one item's pictures.
let catalogue = null;
export async function deco() {
  if (catalogue) return catalogue;
  if (!A.manifest.deco) return (catalogue = { hats: [], bombs: [], pets: [], hatChunk: 1, bombChunk: 1 });
  try { catalogue = await (await fetch('assets/ca/deco.json')).json(); } catch { catalogue = { hats: [], bombs: [], pets: [], hatChunk: 1, bombChunk: 1 }; }
  return catalogue;
}
export function groupFor(kind, id) {
  if (!catalogue) return null;
  if (kind === 'hat') { const i = catalogue.hats.indexOf(id); return i < 0 ? null : `hat_${Math.floor(i / catalogue.hatChunk)}`; }
  if (kind === 'bomb') { const i = catalogue.bombs.indexOf(id); return i < 0 ? null : `bomb_${Math.floor(i / catalogue.bombChunk)}`; }
  if (kind === 'pet') return catalogue.pets.includes(id) ? `pet_${id}` : null;
  return null;
}
export async function loadLook(l) {
  await deco();
  await Promise.all(['hat', 'bomb', 'pet'].map((k) => (l && l[k] && groupFor(k, l[k]) ? A.loadGroup(groupFor(k, l[k])) : null)));
}
