// This phone's account: the nickname (which is the ID), the token the server gave it, and the
// experience it holds. The server keeps the truth (any phone signs in with name and PIN); this
// keeps a copy to show at once and to play on when the server cannot be reached.
import { progress } from './shared/level.js';

const KEY = 'ca-account';
const API = (window.CA_SERVER || '').replace(/\/$/, '');
let acct = { token: null, name: '', exp: 0 };
try { Object.assign(acct, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { /* private mode */ }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(acct)); } catch { /* ignore */ } };
const listeners = [];

export const token = () => acct.token;
export const name = () => acct.name;
export const exp = () => acct.exp | 0;
export const rank = () => progress(exp());
export const signedIn = () => !!acct.token;
export const onChange = (f) => listeners.push(f);

// quiet: a fresh read of the account (a level reached on another phone is not news here).
function set(next, quiet = false) {
  const before = progress(exp()).level;
  Object.assign(acct, next);
  save();
  const after = progress(exp()).level;
  for (const f of listeners) f({ before, after, quiet });
}

async function post(action, body) {
  const r = await fetch(`${API}/api/account/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' });
  if (!r.ok) throw new Error(`account ${r.status}`);
  return r.json();
}

// Sign up or in: resolves to { ok: true, created } or { error } ('taken', 'locked', 'pin', 'name',
// or 'offline' when the server cannot be reached).
export async function enter(nick, pin) {
  let r;
  try { r = await post('enter', { name: nick, pin }); } catch { return { error: 'offline' }; }
  if (r.error) return r;
  set({ token: r.token, name: r.name, exp: r.exp }, true);
  return { ok: true, created: r.created };
}

// Reads the account again: 'ok', 'gone' (the token is no longer valid) or 'offline'.
export async function refresh() {
  if (!acct.token) return 'gone';
  try {
    const r = await post('me', { token: acct.token });
    if (r.error) return 'gone';
    set({ name: r.name, exp: r.exp }, true);
    return 'ok';
  } catch { return 'offline'; }
}

// The server's word after a game (online games are counted by the room server).
export function gotExp(e) { if (e && Number.isFinite(e.exp)) set({ exp: e.exp }); }

// A game against the computer: the page reports it; resolves to the server's answer or null.
export async function practiceDone(result, kills) {
  if (!acct.token) return null;
  try {
    const r = await post('practice', { token: acct.token, result, kills });
    if (r.error) return null;
    set({ exp: r.exp });
    return r;
  } catch { return null; }
}

export function signOut() { acct = { token: null, name: '', exp: 0 }; save(); }
