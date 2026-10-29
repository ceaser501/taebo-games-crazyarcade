// Daily missions, challenge rewards and the 행운룰렛. Finished online games earn 행운 열쇠
// (lucky keys): today's missions once a day each, challenges every time they happen; a key
// spins the roulette once. The accounts server keeps all of it (rw on the account) and runs
// these rules; the page uses the same tables to draw the popup. Games against the computer
// earn nothing here.
import { levelOf } from './level.js';

// Today's missions: once a day each, reset at midnight Korean time.
export const DAILY = [
  { id: 'win', name: '하루 첫 승리', need: 1, unit: '승', icon: '🏆' },
  { id: 'duelGames', name: '무한 결투 3판', need: 3, unit: '판', icon: '⚔' },
  { id: 'duelKills', name: '무한 결투 5킬', need: 5, unit: '킬', icon: '💥' },
  { id: 'rescues', name: '우리 팀 2번 구하기', need: 2, unit: '번', icon: '🫧' },
];
// Challenges: a key every time (several pile up until taken).
export const CHALLENGES = [
  { id: 'multi', name: '멀티킬 (한 판 3킬 이상)', icon: '🔥' },
  { id: 'mvp', name: 'MVP', sub: '그 판 최다 킬 · 무한 결투 최고 점수', icon: '⭐' },
  { id: 'streak', name: '연승', icon: '📈' },
  { id: 'level', name: '레벨 10단위', icon: '🎖' },
];
export const STREAK_BONUS = 100; // lucci for each win while on a streak (2 wins in a row or more)
export const MULTI_KILLS = 3;

// The 행운룰렛's nine prizes; weights out of 1000.
export const PRIZES = [
  { id: 'l300', kind: 'lucci', n: 300, name: '300 루찌', w: 300, sprite: 'Item/CoinBronze' },
  { id: 'l800', kind: 'lucci', n: 800, name: '800 루찌', w: 200, sprite: 'Item/CoinSilver' },
  { id: 'e30', kind: 'exp', n: 30, name: '경험치 +30', w: 150 },
  { id: 'hat', kind: 'hat', name: '랜덤 머리장식', w: 100 },
  { id: 'bomb', kind: 'bomb', name: '랜덤 물풍선', w: 80 },
  { id: 'l2000', kind: 'lucci', n: 2000, name: '2,000 루찌', w: 80, sprite: 'Item/CoinGold' },
  { id: 'e80', kind: 'exp', n: 80, name: '경험치 +80', w: 60 },
  { id: 'pet', kind: 'pet', name: '랜덤 펫', w: 25 },
  { id: 'jackpot', kind: 'lucci', n: 10000, name: '잭팟 10,000 루찌', w: 5, sprite: 'Item/CoinPocketGoldSpecial', jackpot: true },
];
const DECO_PRICE = { hat: 2000, bomb: 1500, pet: 5000 };

// The day in Korea (missions reset at its midnight).
export const dayOf = (now = Date.now()) => new Date(now + 9 * 3600 * 1000).toISOString().slice(0, 10);

// Streak marks that give a key: 3, 5, 10, 15, 20 …
export const streakMark = (n) => n === 3 || (n >= 5 && n % 5 === 0);
export const nextStreakMark = (n) => (n < 3 ? 3 : n < 5 ? 5 : (Math.floor(n / 5) + 1) * 5);

// Titles: earned for good, shown under the name in the waiting room and on the kill/death
// board (one at a time, the player's pick). 주간 1위 lasts the week after the one it was won in.
export const TITLES = [
  { id: 'master', name: '물풍선 장인', desc: '온라인 누적 100킬', need: 100, of: 'kills' },
  { id: 'rescuer', name: '구조대', desc: '우리 팀 구하기 누적 50번', need: 50, of: 'rescues' },
  { id: 'immortal', name: '불사신', desc: '무한 결투에서 한 번도 안 죽고 승리', need: 1, of: 'immortal' },
  { id: 'lucky', name: '럭키가이', desc: '행운룰렛 잭팟 당첨', need: 1, of: 'jackpots' },
  { id: 'comeback', name: '역전의 용사', desc: '3연패 뒤 승리', need: 1, of: 'comebacks' },
  { id: 'weekly', name: '주간 1위', desc: '지난주 주간 랭킹 1위 (이번 주 동안)', need: 1, of: 'weekly' },
];
export const titleName = (id) => TITLES.find((t) => t.id === id)?.name || null;

// The week in Korea, named by its Monday ("2026-10-26"); the ranking starts again each Monday.
export function weekOf(now = Date.now()) {
  const k = new Date(now + 9 * 3600 * 1000);
  const back = (k.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate() - back)).toISOString().slice(0, 10);
}
export const lastWeekOf = (now = Date.now()) => weekOf(now - 7 * 86400000);

export function blank() {
  return { keys: 0, day: '', daily: {}, taken: {}, pending: { multi: 0, mvp: 0, streak: 0, level: 0 }, streak: 0, jackpots: 0,
    life: { kills: 0, rescues: 0, immortal: 0, comebacks: 0 }, lossRun: 0, title: null };
}

// Made whole and moved to today (yesterday's missions are gone).
export function fresh(rw, now = Date.now()) {
  const b = blank();
  const out = rw && typeof rw === 'object' ? rw : b;
  for (const k of Object.keys(b)) if (out[k] == null) out[k] = b[k];
  for (const k of Object.keys(b.pending)) out.pending[k] = Math.max(0, out.pending[k] | 0);
  for (const k of Object.keys(b.life)) out.life[k] = Math.max(0, out.life[k] | 0);
  out.keys = Math.max(0, out.keys | 0);
  const today = dayOf(now);
  if (out.day !== today) { out.day = today; out.daily = {}; out.taken = {}; }
  return out;
}

// An online game for this account. game: { result, kills, rescues, duel, mvp }; exp before and
// after the game's experience. Returns the streak bonus in lucci.
export function onGame(rw, game, expBefore, expAfter) {
  const d = rw.daily;
  if (game.result === 'win') d.win = (d.win | 0) + 1;
  if (game.duel) { d.duelGames = (d.duelGames | 0) + 1; d.duelKills = (d.duelKills | 0) + Math.max(0, game.kills | 0); }
  d.rescues = (d.rescues | 0) + Math.max(0, game.rescues | 0);
  if ((game.kills | 0) >= MULTI_KILLS) rw.pending.multi++;
  if (game.mvp) rw.pending.mvp++;
  rw.life.kills += Math.max(0, game.kills | 0);
  rw.life.rescues += Math.max(0, game.rescues | 0);
  if (game.duel && game.result === 'win' && (game.deaths | 0) === 0) rw.life.immortal++;
  let bonus = 0;
  if (game.result === 'win') {
    if (rw.lossRun >= 3) rw.life.comebacks++;
    rw.lossRun = 0;
    rw.streak++;
    if (streakMark(rw.streak)) rw.pending.streak++;
    if (rw.streak >= 2) bonus = STREAK_BONUS;
  } else if (game.result === 'lose') { rw.streak = 0; rw.lossRun++; }
  levelUp(rw, expBefore, expAfter);
  return bonus;
}
// Every tenth level reached gives a key.
export function levelUp(rw, expBefore, expAfter) {
  const a = Math.floor(levelOf(expBefore) / 10), b = Math.floor(levelOf(expAfter) / 10);
  if (b > a) rw.pending.level += b - a;
}

// What the popup shows: today's missions and the challenges with their progress, and how many
// keys can be taken.
export function view(rw, exp) {
  const daily = DAILY.map((m) => {
    const have = Math.min(m.need, rw.daily[m.id] | 0);
    return { ...m, have, done: have >= m.need, taken: !!rw.taken[m.id] };
  });
  const lv = levelOf(exp);
  const challenges = CHALLENGES.map((c) => ({ ...c, ready: rw.pending[c.id] | 0 }));
  challenges.find((c) => c.id === 'streak').progress = { have: rw.streak, next: nextStreakMark(rw.streak) };
  challenges.find((c) => c.id === 'level').progress = { have: lv, next: (Math.floor(lv / 10) + 1) * 10 };
  const ready = daily.filter((m) => m.done && !m.taken).length + challenges.reduce((n, c) => n + c.ready, 0);
  const rows = daily.filter((m) => m.done && !m.taken).length + challenges.filter((c) => c.ready).length;
  return { keys: rw.keys, day: rw.day, daily, challenges, ready, rows };
}

// Takes the keys of one mission or challenge (id), or of all ('all'). Returns the number taken.
export function claim(rw, id) {
  let n = 0;
  for (const m of DAILY) {
    if ((id === 'all' || id === m.id) && (rw.daily[m.id] | 0) >= m.need && !rw.taken[m.id]) { rw.taken[m.id] = true; n++; }
  }
  for (const c of CHALLENGES) {
    if ((id === 'all' || id === c.id) && rw.pending[c.id] > 0) { n += rw.pending[c.id]; rw.pending[c.id] = 0; }
  }
  rw.keys += n;
  return n;
}

// Picks a prize (r: a number in [0, 1)).
export function pick(r) {
  let x = Math.floor(r * 1000);
  for (const p of PRIZES) { if (x < p.w) return p; x -= p.w; }
  return PRIZES[0];
}

// Spins once: takes a key and gives the prize to the wallet (and experience to u). pool: the
// shop's decorations by kind, for a random one not owned yet (all owned: half its price in
// lucci). Returns { prize, item, lucci, exp } or null without a key.
export function spin(rw, u, wallet, pool, r = Math.random(), r2 = Math.random()) {
  if (rw.keys < 1) return null;
  rw.keys--;
  const prize = pick(r);
  const out = { prize: prize.id, item: null, lucci: 0, exp: 0 };
  if (prize.kind === 'lucci') { wallet.lucci += prize.n; out.lucci = prize.n; if (prize.jackpot) rw.jackpots++; }
  else if (prize.kind === 'exp') { const before = u.exp; u.exp += prize.n; out.exp = prize.n; levelUp(rw, before, u.exp); }
  else {
    const kind = prize.kind;
    const ok = (pool && Array.isArray(pool[kind]) ? pool[kind] : []).filter((id) => typeof id === 'string' && !wallet.owned[kind].includes(id));
    if (ok.length) { out.item = ok[Math.floor(r2 * ok.length)]; wallet.owned[kind].push(out.item); }
    else { out.lucci = DECO_PRICE[kind] / 2; wallet.lucci += out.lucci; }
  }
  return out;
}

// Titles with their progress; weekly: whether this player won last week's ranking.
export function titles(rw, weekly) {
  const have = { ...rw.life, jackpots: rw.jackpots, weekly: weekly ? 1 : 0 };
  return TITLES.map((t) => ({ ...t, have: Math.min(t.need, have[t.of] | 0), earned: (have[t.of] | 0) >= t.need }));
}
// The title shown: the pick, while it is still held.
export function shownTitle(rw, weekly) {
  if (!rw || !rw.title) return null;
  const t = titles(rw, weekly).find((x) => x.id === rw.title);
  return t && t.earned ? t.id : null;
}
// Picks the title to show (null for none); 'ok' or 'bad'.
export function setTitle(rw, id, weekly) {
  if (id === null) { rw.title = null; return 'ok'; }
  const t = titles(rw, weekly).find((x) => x.id === id);
  if (!t || !t.earned) return 'bad';
  rw.title = id;
  return 'ok';
}
