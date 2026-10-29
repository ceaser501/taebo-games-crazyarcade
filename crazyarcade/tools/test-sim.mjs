// Plays a short bot match on every map with the shared simulation and room code, to catch
// crashes and maps nobody can move on. `npm test`.
import { MAPS } from '../js/shared/maps.js';
import { createGame, step, isOver, RESPAWN } from '../js/shared/sim.js';
import { Bot } from '../js/shared/ai.js';
import { RoomCore } from '../js/shared/room.js';
import { HZ } from '../js/shared/const.js';
import { AccountsCore } from '../js/shared/accounts.js';
import { levelOf, expFor, rankParts, MAX_LEVEL } from '../js/shared/level.js';

let bad = 0;
for (const map of MAPS) {
  const players = [0, 1, 2, 3].map((i) => ({ id: `b${i}`, name: `b${i}`, char: ['C00', 'C05', 'C01', 'C04'][i], team: i % 2, color: i % 2 ? 5 : 0 }));
  const g = createGame({ map, players, seed: 42, mode: 'team' });
  const bots = players.map((p) => new Bot(p.id));
  const start = g.players.map((p) => [p.x, p.y]);
  let places = 0;
  for (let t = 0; t < HZ * 60 && !isOver(g); t++) {
    const inputs = {};
    for (const b of bots) inputs[b.id] = b.think(g);
    step(g, inputs);
    places += g.events.filter((e) => e.type === 'place').length;
  }
  const moved = g.players.filter((p, i) => Math.hypot(p.x - start[i][0], p.y - start[i][1]) > 1 || p.state !== 'normal').length;
  if (moved < 2 || places === 0) { bad++; console.log(`stuck? ${map.id}: moved ${moved}, balloons ${places}`); }
}

// Items on an empty test field: kick, punch, dart, conveyor.
function field(extra = {}) {
  const map = { id: 't', tiles: [['x', 'floor']], floor: new Array(15 * 13).fill(0), objs: new Array(15 * 13).fill(-1),
    spawns: [[1, 1], [13, 11]], drops: { bomb: 1 }, ...extra };
  const g = createGame({ map, players: [{ id: 'a', char: 'C00', team: 0, color: 0 }, { id: 'b', char: 'C00', team: 1, color: 5 }], seed: 1, mode: 'solo' });
  g.phase = 'play';
  const a = g.players.find((p) => p.id === 'a'), b = g.players.find((p) => p.id === 'b');
  a.x = 1 * 40 + 20; a.y = 1 * 40 + 20; b.x = 13 * 40 + 20; b.y = 11 * 40 + 20;
  return { g, a };
}
const check = (ok, what) => { if (!ok) { bad++; console.log(`item test failed: ${what}`); } };
{
  const { g, a } = field();
  a.kick = true;
  step(g, { a: { bomb: true } });
  for (let i = 0; i < 20; i++) step(g, { a: { dir: 3 } }); // step off to the left
  for (let i = 0; i < 20; i++) step(g, { a: { dir: 4 } }); // walk back into it
  for (let i = 0; i < 30; i++) step(g, {});
  check(g.bombs.length === 1 && g.bombs[0].c > 3, `kick (balloon at ${g.bombs[0]?.c})`);
}
{
  const { g, a } = field();
  a.punch = true;
  g.bombs.push({ id: 99, c: 2, r: 1, owner: 'b', power: 1, t: 60, pass: [], off: 0, kick: 0, fly: null });
  a.dir = 4;
  step(g, { a: { bomb: true } });
  for (let i = 0; i < 20; i++) step(g, {});
  check(g.bombs[0] && !g.bombs[0].fly && g.bombs[0].c === 5, `punch (balloon at ${g.bombs[0]?.c})`);
}
{
  // The glove also throws the balloon you stand on (just placed), the way you face.
  const { g, a } = field();
  a.punch = true; a.dir = 4;
  step(g, { a: { bomb: true } });
  step(g, { a: { bomb: true } });
  for (let i = 0; i < 20; i++) step(g, {});
  check(g.bombs.length === 1 && !g.bombs[0].fly && g.bombs[0].c === 4, `punch from under you (balloon at ${g.bombs[0]?.c})`);
}
{
  const { g, a } = field();
  a.dart = 1; a.dir = 4;
  g.bombs.push({ id: 99, c: 6, r: 1, owner: 'b', power: 1, t: 60, pass: [], off: 0, kick: 0, fly: null });
  step(g, { a: { item: 'dart' } });
  step(g, {});
  check(g.bombs.length === 0 && a.dart === 0, 'dart');
}
{
  const conv = new Array(15 * 13).fill(0); for (let c = 0; c < 15; c++) conv[5 * 15 + c] = 4;
  const { g, a } = field({ conv });
  a.y = 5 * 40 + 20;
  for (let i = 0; i < 60; i++) step(g, {});
  check(a.x > 60 + 40, `conveyor (x ${a.x})`);
}
// The devil turns the arrows around; the red devil maxes everything.
{
  const map = { id: 't', tiles: [['x', 'floor']], floor: new Array(15 * 13).fill(0), objs: new Array(15 * 13).fill(-1), spawns: [[1, 1], [9, 9]], drops: { bomb: 1 } };
  const g = createGame({ map, players: [{ id: 'a', char: 'C00', team: 0, color: 0 }, { id: 'b', char: 'C00', team: 5, color: 5 }], seed: 3, mode: 'team' });
  g.phase = 'play';
  const a = g.players[0];
  a.x = 220; a.y = 220;
  g.items[5 * 15 + 6] = { k: 'skull', fresh: 0 }; g.items[5 * 15 + 4] = { k: 'devil', fresh: 0 };
  for (let i = 0; i < 12; i++) step(g, { a: { dir: 4 } }); // onto the devil at (6,5)
  const x0 = a.x;
  for (let i = 0; i < 10; i++) step(g, { a: { dir: 4 } }); // pressing right walks left
  check(a.curse === 'reverse' && a.x < x0, `devil reverses (${a.curse}, ${x0} -> ${a.x})`);
  a.curse = null;
  for (let i = 0; i < 40 && g.items[5 * 15 + 4]; i++) step(g, { a: { dir: 3 } });
  check(a.bombs === a.max.bombs && a.power === a.max.power && a.speed === a.max.speed, 'red devil maxes everything');
}
// A popped player's power-ups go back onto the map.
{
  const map = { id: 't', tiles: [['x', 'floor']], floor: new Array(15 * 13).fill(0), objs: new Array(15 * 13).fill(-1), spawns: [[1, 1], [5, 1]], drops: { bomb: 1 } };
  const g = createGame({ map, players: [{ id: 'a', char: 'C00', team: 0, color: 0 }, { id: 'b', char: 'C00', team: 5, color: 5 }], seed: 3, mode: 'team' });
  g.phase = 'play';
  const [a, b] = g.players;
  a.x = 100; a.y = 60; b.x = 120; b.y = 60;
  for (const [k, c] of [['bomb', 2], ['potion', 3], ['skate', 4]]) { g.items[1 * 15 + c] = { k, fresh: 0 }; a.x = c * 40 + 20; step(g, {}); }
  const before = g.items.filter(Boolean).length;
  a.state = 'trapped'; a.stateT = 100; b.x = a.x + 10; b.y = a.y;
  step(g, {});
  check(a.state === 'dead' && g.items.filter(Boolean).length === before + 3, `items dropped on death (${g.items.filter(Boolean).length - before})`);
}
// Bubbles in team play: a teammate frees from a touch's distance, an opponent pops only up close.
for (const [mate, dist, want] of [[true, 36, 'normal'], [false, 36, 'trapped'], [false, 20, 'dead']]) {
  const map = { id: 't', tiles: [['x', 'floor']], floor: new Array(15 * 13).fill(0), objs: new Array(15 * 13).fill(-1), spawns: [[1, 1], [5, 1]], drops: { bomb: 1 } };
  const g = createGame({ map, players: [{ id: 'a', char: 'C00', team: 0, color: 0 }, { id: 'b', char: 'C00', team: mate ? 0 : 5, color: mate ? 0 : 5 }], seed: 1, mode: 'team' });
  g.phase = 'play';
  const [a, b] = g.players;
  a.x = 100; a.y = 60; b.x = 100 + dist; b.y = 60;
  a.state = 'trapped'; a.stateT = 100;
  step(g, {});
  check(a.state === want, `${mate ? 'teammate' : 'opponent'} at ${dist} px: ${a.state}, want ${want}`);
}

{
  // Positions reported by a phone: a short move is taken, a teleport or a move into a wall is not.
  const { g, a } = field({ objs: (() => { const o = new Array(15 * 13).fill(-1); o[1 * 15 + 3] = 0; return o; })(), tiles: [['x', 'floor'], ['w', 'hard']] });
  g.objs[1 * 15 + 3] = { t: 1, k: 'hard', item: null, breakT: 0 };
  step(g, { a: { dir: 4, x: 66, y: 60 } });
  check(a.x === 66, `report taken (x ${a.x})`);
  step(g, { a: { dir: 4, x: 400, y: 60 } });
  check(a.x === 66, `teleport refused (x ${a.x})`);
  step(g, { a: { dir: 4, x: 126, y: 60 } });
  check(a.x < 100, `wall refused (x ${a.x})`);
}

{
  // A crate is pushed one cell after walking into it for a moment; a plain block is not.
  const objs = new Array(15 * 13).fill(-1); objs[1 * 15 + 2] = 1; objs[3 * 15 + 2] = 2;
  const { g, a } = field({ objs, tiles: [['x', 'floor'], ['crate', 'soft', 1, 1, 'crate', 1], ['block', 'soft', 1, 1, 'block']] });
  for (let i = 0; i < 20; i++) step(g, { a: { dir: 4 } });
  check(!g.objs[1 * 15 + 2] && [3, 4, 5].some((c) => g.objs[1 * 15 + c]?.push), 'crate pushed');
  a.x = 60; a.y = 140;
  for (let i = 0; i < 20; i++) step(g, { a: { dir: 4 } });
  check(g.objs[3 * 15 + 2] && !g.objs[3 * 15 + 3], 'block not pushed');
}

// The room: join, bot, start, tick to the end.
const sent = [];
const room = new RoomCore({ code: '0000', send: (id, m) => sent.push([id, m.t]), broadcast: (m) => sent.push(['*', m.t]) });
room.join('h', '방장');
room.message('h', { t: 'bot' });
room.message('h', { t: 'start' });
if (room.phase !== 'game') { bad++; console.log('room did not start'); }
for (let i = 0; i < HZ * 200 && room.phase === 'game'; i++) room.tick();
if (room.phase !== 'room') { bad++; console.log('round did not end'); }

// Accounts: a name is taken by its first PIN; the same name and PIN work from another phone.
{
  const data = new Map();
  const acc = new AccountsCore({ get: async (k) => data.get(k), put: async (k, v) => { data.set(k, v); } });
  const a = await acc.enter(' 태수 ', '1234');
  check(a.token && a.created && a.name === '태수' && a.level === 1, `sign up ${JSON.stringify(a)}`);
  check((await acc.enter('태수', '9999')).error === 'taken', 'someone else cannot take the name');
  const b = await acc.enter('태수', '1234');
  check(b.token && !b.created && b.token !== a.token, 'same name and PIN from another phone');
  check((await acc.enter('', '1234')).error === 'name' && (await acc.enter('x', '12a4')).error === 'pin', 'bad name or PIN');
  const u = await acc.user(b.token);
  const w = await acc.award(u.key, 50);
  check(w.exp === 50 && (await acc.me(a.token)).exp === 50, 'experience is kept for the name');
  const p1 = await acc.practice(a.token, 'win', 2), p2 = await acc.practice(a.token, 'win', 2);
  check(p1.gained === 19 && p2.gained === 0, `practice paced (${p1.gained}, ${p2.gained})`);
  for (let i = 0; i < 5; i++) await acc.enter('태수', '0000');
  check((await acc.enter('태수', '1234')).error === 'locked', 'wrong PINs lock the name for a while');
  // The wallet: bought and worn on the server, lucci and records from games, old phone data once.
  const t = b.token;
  check((await acc.handle('buy', { token: t, kind: 'hat', id: 'A123' })).wallet?.wear.hat === 'A123', 'buy a hat (worn at once)');
  check((await acc.handle('buy', { token: t, kind: 'char', id: 'C99' })).error === 'bad', 'no such character');
  const sup = (await import('../js/shared/const.js')).CHARACTERS.find((c) => c.name.startsWith('슈퍼')).id;
  check((await acc.handle('buy', { token: t, kind: 'char', id: sup })).error === 'level', 'super characters wait for Lv.20');
  check((await acc.handle('char', { token: t, id: 'C20' })).error === 'bad', 'cannot play a character not owned');
  const g = await acc.award(u.key, 30, { result: 'win', kills: 2, coins: 50 });
  check(g.lucci === 350 && g.wallet.stats.wins === 2 && g.wallet.stats.games === 2 && g.wallet.stats.kills === 4, `round lucci and record ${JSON.stringify(g.wallet?.stats)}`);
  const im = await acc.handle('import', { token: t, wallet: { lucci: 77777, owned: { pet: ['Pet001'] } } });
  check(im.wallet?.lucci === 77777 && im.wallet.owned.pet[0] === 'Pet001' && (await acc.handle('import', { token: t, wallet: { lucci: 1 } })).error === 'done', 'old phone data brought in once');
  check((await acc.me(t)).wallet.lucci === 77777, 'wallet read back');
  check((await acc.guestName('태수')) === '태수(손님)' && (await acc.guestName('나그네')) === '나그네', 'guests cannot show a registered name');
  check(levelOf(0) === 1 && levelOf(expFor(10)) === 10 && levelOf(expFor(10) - 1) === 9 && levelOf(1e9) === MAX_LEVEL, 'levels');
  check(rankParts(1) === null && rankParts(2).length === 3 && rankParts(MAX_LEVEL)[0] === 79, 'rank icon parts');
}
// A round decided in a room reports each signed-in player's result.
{
  let got = null;
  const r = new RoomCore({ code: '1', send: () => {}, broadcast: () => {}, onResult: (l) => { got = l; } });
  r.join('h', 'H', { key: 'u:h', exp: 0 });
  r.message('h', { t: 'bot' });
  r.message('h', { t: 'start' });
  for (let i = 0; i < HZ * 300 && r.phase === 'game'; i++) r.tick();
  check(got && got.length === 1 && got[0].acct === 'u:h' && ['win', 'lose', 'draw'].includes(got[0].result), `room result ${JSON.stringify(got)}`);
}
// Chat: a player's line carries their id (for the bubble over their head); too many in a row are dropped.
{
  const lines = [];
  const r = new RoomCore({ code: '2', send: () => {}, broadcast: (m) => { if (m.t === 'chat') lines.push(m); } });
  r.join('a', 'A');
  for (let i = 0; i < 8; i++) r.message('a', { t: 'chat', text: `hi ${i}` });
  const said = lines.filter((l) => l.id === 'a');
  check(said.length === 5 && said[0].name === 'A' && said[0].text === 'hi 0', `chat lines ${JSON.stringify(said)}`);
  check(lines.some((l) => l.id === null && !l.name), 'chat notices have no sender');
}
// Two players start far apart: on every map, over many seeds, never closer than half the
// farthest any two start points are.
{
  let close = 0;
  for (const map of MAPS) {
    const sp = map.spawns;
    let widest = 0;
    for (const a of sp) for (const b of sp) widest = Math.max(widest, Math.hypot(a[0] - b[0], a[1] - b[1]));
    for (let seed = 1; seed <= 20; seed++) {
      const g = createGame({ map, players: [{ id: 'a', char: 'C00', team: 0 }, { id: 'b', char: 'C00', team: 5 }], seed });
      const [p, q] = g.players;
      if (Math.hypot(p.x - q.x, p.y - q.y) / 40 < widest / 2) { close++; if (close < 4) console.log(`close start on ${map.id}`); }
    }
  }
  check(close === 0, `${close} close starts`);
}
// 전체 랜덤: the room keeps 'random' and picks a real map that fits as the round starts.
{
  let started = null;
  const r = new RoomCore({ code: '3', send: () => {}, broadcast: (m) => { if (m.t === 'start') started = m; } });
  r.join('h', 'H');
  r.message('h', { t: 'settings', map: 'random' });
  r.message('h', { t: 'bot' });
  check(r.state().map === 'random', 'random map kept in the room');
  r.message('h', { t: 'start' });
  check(started && started.map !== 'random' && MAPS.some((m) => m.id === started.map && m.spawns.length >= 2), `random map at start ${started?.map}`);
}
// 무한 결투: a popped player comes back, the round runs to the clock, points decide.
{
  const map = MAPS.find((m) => m.id === 'Village10');
  const g = createGame({ map, players: [{ id: 'a', char: 'C00', team: 0 }, { id: 'b', char: 'C00', team: 5 }], seed: 4, rule: 'duel' });
  g.phase = 'play';
  const [a, b] = g.players;
  a.state = 'trapped'; a.stateT = 1;
  step(g, {});
  check(a.state === 'dead' && a.deaths === 1 && g.phase === 'play', `duel pop (${a.state}, ${g.phase})`);
  for (let i = 0; i < RESPAWN; i++) step(g, {});
  check(a.state === 'normal' && a.invT > 0, `duel respawn (${a.state})`);
  b.kills = 1;
  g.timer = 1; step(g, {});
  check(g.phase === 'end' && g.result.team === 5, `duel points decide (${JSON.stringify(g.result)})`);
  const d = createGame({ map, players: [{ id: 'a', char: 'C00', team: 0 }, { id: 'b', char: 'C00', team: 5 }], seed: 4, rule: 'duel' });
  d.phase = 'play'; d.timer = 1; step(d, {});
  check(d.result && d.result.draw, 'duel equal points draw');
}
// The stylesheet's braces balance (a stray one silently drops the rule after it).
{
  const css = (await import('node:fs')).readFileSync(new URL('../css/style.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  let depth = 0, ok = true;
  for (const ch of css) { if (ch === '{') depth++; else if (ch === '}' && --depth < 0) ok = false; }
  check(ok && depth === 0, 'style.css braces');
}
console.log(`${MAPS.length} maps, ${bad ? bad + ' problems' : 'all fine'}`);
process.exit(bad ? 1 : 0);
