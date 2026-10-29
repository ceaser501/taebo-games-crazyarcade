// Accounts: the nickname is the ID. The first phone to take a name sets a 4-digit PIN for it;
// any other phone gets into the same name with that PIN, and someone else cannot take it.
// Each account keeps its experience (the rank) and its wallet (lucci, shop items, character,
// records; shared/shop.js), so another phone picks up everything. The store is any async get/put of plain
// objects: a Durable Object's storage on Cloudflare, a Map in the local dev server.
import { gainFor, levelOf } from './level.js';
import * as Shop from './shop.js';
import * as Rewards from './rewards.js';

const LOCK_AFTER = 5, LOCK_MS = 5 * 60 * 1000; // wrong PINs in a row, then a pause
const PRACTICE_GAP = 40 * 1000; // at most one practice game's experience this often

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const random = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));
const hash = async (salt, pin) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${pin}`)));

// A name as shown (trimmed, single spaces, at most 10 characters) and the key it is kept under.
export function cleanName(name) {
  return String(name || '').normalize('NFC').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 10);
}
const keyOf = (name) => `u:${cleanName(name).toLowerCase()}`;
const pub = (u) => ({ name: u.name, exp: u.exp, level: levelOf(u.exp), wallet: Shop.cleanWallet(u.wallet), imported: !!u.imported });

export class AccountsCore {
  constructor(store) { this.store = store; }

  // Sign up or sign in: { token, name, exp, level, created } or { error: 'name' | 'pin' | 'taken' | 'locked' }.
  async enter(name, pin) {
    name = cleanName(name);
    if (!name) return { error: 'name' };
    if (!/^\d{4}$/.test(String(pin))) return { error: 'pin' };
    const key = keyOf(name), now = Date.now();
    let u = await this.store.get(key);
    let created = false;
    if (!u) {
      const salt = random(8);
      u = { name, salt, hash: await hash(salt, pin), exp: 0, at: now, fails: 0, lock: 0, wallet: Shop.blankWallet() };
      created = true;
    } else {
      if (u.lock > now) return { error: 'locked' };
      if ((await hash(u.salt, pin)) !== u.hash) {
        u.fails = (u.fails || 0) + 1;
        if (u.fails >= LOCK_AFTER) { u.fails = 0; u.lock = now + LOCK_MS; }
        await this.store.put(key, u);
        return { error: 'taken' };
      }
      u.fails = 0;
    }
    const token = random(16);
    await this.store.put(key, u);
    await this.store.put(`t:${token}`, key);
    return { token, created, ...pub(u) };
  }

  async user(token) {
    if (!token || typeof token !== 'string') return null;
    const key = await this.store.get(`t:${token.slice(0, 64)}`);
    return key ? { key, u: await this.store.get(key) } : null;
  }

  async taken(name) { return !!(await this.store.get(keyOf(name))); }

  // The name a guest (no account) shows in a room: someone's registered name gets marked.
  async guestName(name) {
    const n = cleanName(name) || '플레이어';
    return (await this.taken(n)) ? `${n.slice(0, 6)}(손님)` : n;
  }

  // The account behind a token: { name, exp, level } or null.
  async me(token) { const a = await this.user(token); return a && a.u ? pub(a.u) : null; }

  // A finished game for an account: experience, and with game = { result, kills, coins } its
  // lucci and record. Returns { before, exp, level, gained, lucci, wallet }.
  async award(key, gained, game = null) {
    const u = await this.store.get(key);
    if (!u) return null;
    const before = u.exp;
    u.exp = before + Math.max(0, Math.round(gained));
    u.wallet = Shop.cleanWallet(u.wallet);
    let lucci = game ? Shop.roundDone(u.wallet, game.result, game.kills, game.coins) : 0;
    // An online game counts for the daily missions and challenges (practice does not come here
    // with a game), and a win on a streak brings a little more lucci.
    let missions = null;
    if (game && !game.practice) {
      u.rw = Rewards.fresh(u.rw);
      const bonus = Rewards.onGame(u.rw, game, before, u.exp);
      u.wallet.lucci += bonus; lucci += bonus;
      missions = Rewards.view(u.rw, u.exp).rows;
    }
    await this.store.put(key, u);
    if (u.exp > before) await this.addWeekly(key, u.name, u.exp - before);
    return { before, exp: u.exp, level: levelOf(u.exp), gained: u.exp - before, lucci, wallet: u.wallet, missions };
  }

  // Shop and character choices, checked here: { wallet } or { error }.
  async change(token, f) {
    const a = await this.user(token);
    if (!a || !a.u) return { error: 'token' };
    a.u.wallet = Shop.cleanWallet(a.u.wallet);
    const r = f(a.u.wallet, a.u);
    if (r !== 'ok') return { error: r, wallet: a.u.wallet };
    await this.store.put(a.key, a.u);
    return { wallet: a.u.wallet };
  }

  // A game against the computer, told by the page itself, so it is held to a pace.
  async practice(token, result, kills, coins) {
    const a = await this.user(token);
    if (!a || !a.u) return { error: 'token' };
    const now = Date.now();
    if (now - (a.u.practiceAt || 0) < PRACTICE_GAP) return { ...pub(a.u), before: a.u.exp, gained: 0, lucci: 0 };
    a.u.practiceAt = now;
    await this.store.put(a.key, a.u);
    return this.award(a.key, gainFor(result, kills, true), { result, kills, coins: Math.min(1000, coins | 0), practice: true });
  }

  // Requests from the page: POST /api/account/<action> with JSON.
  async handle(action, body) {
    if (action === 'enter') return this.enter(body.name, body.pin);
    if (action === 'me') { const me = await this.me(body.token); return me || { error: 'token' }; }
    if (action === 'practice') return this.practice(body.token, body.result, body.kills, body.coins);
    if (action === 'buy') return this.change(body.token, (w, u) => Shop.buy(w, body.kind, body.id, levelOf(u.exp)));
    if (action === 'wear') return this.change(body.token, (w) => Shop.wear(w, body.kind, body.id ?? null));
    if (action === 'char') return this.change(body.token, (w) => Shop.setChar(w, body.id));
    // What this phone had before accounts, brought in once (a new account starts from it).
    if (action === 'import') return this.change(body.token, (w, u) => {
      if (u.imported) return 'done';
      Object.assign(w, Shop.cleanWallet(body.wallet));
      w.lucci = Math.min(w.lucci, 1000000);
      u.imported = true;
      return 'ok';
    });
    if (['missions', 'claim', 'spin', 'title'].includes(action)) return this.missions(action, body);
    return { error: 'action' };
  }

  // The weekly ranking: experience gained this week (Korean weeks from Monday), by account.
  async addWeekly(key, name, n) {
    const wk = `w:${Rewards.weekOf()}`;
    const board = (await this.store.get(wk)) || {};
    const e = board[key] || { name, exp: 0 };
    e.name = name; e.exp += n;
    board[key] = e;
    await this.store.put(wk, board);
  }
  async ranking(key) {
    const board = (await this.store.get(`w:${Rewards.weekOf()}`)) || {};
    const all = Object.entries(board).sort((a, b) => b[1].exp - a[1].exp);
    const users = await Promise.all(all.slice(0, 10).map(([k]) => this.store.get(k)));
    const top = all.slice(0, 10).map(([k, e], i) => ({ rank: i + 1, name: e.name, exp: e.exp, level: users[i] ? levelOf(users[i].exp) : 1, me: k === key }));
    const mine = all.findIndex(([k]) => k === key);
    return { week: Rewards.weekOf(), top, mine: mine < 0 ? null : { rank: mine + 1, exp: all[mine][1].exp } };
  }
  // Whether this account won last week's ranking (the 주간 1위 title for this week).
  async weeklyWinner(key) {
    const board = (await this.store.get(`w:${Rewards.lastWeekOf()}`)) || {};
    let best = null;
    for (const [k, e] of Object.entries(board)) if (!best || e.exp > best[1].exp) best = [k, e];
    return !!best && best[0] === key;
  }
  // The title an account shows in rooms, or null.
  async titleOf(key, u) { return Rewards.shownTitle(u.rw, await this.weeklyWinner(key)); }

  // The daily missions popup: 'missions' reads them, 'claim' takes keys (body.id or 'all'),
  // 'spin' turns the 행운룰렛 once (body.pool: the shop's decorations, for a random one).
  async missions(action, body) {
    const a = await this.user(body.token);
    if (!a || !a.u) return { error: 'token' };
    const u = a.u;
    u.rw = Rewards.fresh(u.rw);
    u.wallet = Shop.cleanWallet(u.wallet);
    let out = {};
    const weekly = await this.weeklyWinner(a.key);
    if (action === 'claim') out.taken = Rewards.claim(u.rw, String(body.id || 'all'));
    if (action === 'title') { const r = Rewards.setTitle(u.rw, body.id ?? null, weekly); if (r !== 'ok') out.error = r; }
    if (action === 'spin') {
      const pool = {};
      for (const k of ['hat', 'bomb', 'pet']) pool[k] = (Array.isArray(body.pool?.[k]) ? body.pool[k] : []).slice(0, 5000).filter((id) => Shop.validItem(k, id));
      const r = Rewards.spin(u.rw, u, u.wallet, pool);
      if (!r) return { error: 'keys', ...Rewards.view(u.rw, u.exp) };
      out.spin = r;
    }
    if (action !== 'missions') await this.store.put(a.key, u);
    return { ...out, ...Rewards.view(u.rw, u.exp), exp: u.exp, level: levelOf(u.exp), wallet: u.wallet,
      titles: Rewards.titles(u.rw, weekly), title: Rewards.shownTitle(u.rw, weekly), ranking: await this.ranking(a.key) };
  }
}

export { keyOf as accountKey };
