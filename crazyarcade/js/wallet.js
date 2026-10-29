// The player's lucci, what they own from the shop and wear, the character they play and their
// record. Signed in, these live in the account on the server (any phone sees them) and every
// change goes there; this shows it at once from the last copy. Guests keep them in this browser.
// The rules themselves are shared with the server (shared/shop.js).
import * as A from './assets.js';
import * as Account from './account.js';
import * as Shop from './shared/shop.js';

export { FREE_CHARS, ROUND_BONUS, price, needLevel } from './shared/shop.js';

const KEY = 'ca-wallet';
let local = null;
try { local = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { /* private mode */ }
const hadLocal = !!(local && typeof local.lucci === 'number');
local = Shop.cleanWallet(local);
const saveLocal = () => { try { localStorage.setItem(KEY, JSON.stringify(local)); } catch { /* ignore */ } };

const cur = () => (Account.signedIn() ? Account.wallet() : local);
const changed = () => (Account.signedIn() ? Account.saveLocal() : saveLocal());

export const lucci = () => cur().lucci;
export const owns = (kind, id) => Shop.owns(cur(), kind, id);
export const wearing = (kind) => cur().wear[kind];
export const myChar = () => (owns('char', cur().char) ? cur().char : Shop.FREE_CHARS[0]);
export const stats = () => ({ ...cur().stats });
// What others see: sent with the character to the room.
export const look = () => ({ ...cur().wear });

export function buy(kind, id) {
  const r = Shop.buy(cur(), kind, id, Account.signedIn() ? Account.rank().level : 0);
  if (r === 'ok') { changed(); Account.shop('buy', { kind, id }); }
  return r;
}
export function wear(kind, id) { if (Shop.wear(cur(), kind, id) === 'ok') { changed(); Account.shop('wear', { kind, id }); } }
export function setChar(id) { if (Shop.setChar(cur(), id) === 'ok') { changed(); Account.shop('char', { id }); } }

// A finished round. Guests count it here; signed in, an online round is counted by the room
// server and a practice round is reported. Resolves to the lucci it brought (or null when the
// server will tell, with the 'exp' message).
export async function roundDone(result, kills, coins, practice) {
  if (!Account.signedIn()) { const n = Shop.roundDone(local, result, kills, coins); saveLocal(); return n; }
  if (!practice) return null;
  const r = await Account.practiceDone(result, kills, coins);
  return r ? r.lucci : 0;
}

// A new account starts from what this phone had before accounts (once).
export function bringIn() { if (hadLocal) Account.shop('import', { wallet: local }); }

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
