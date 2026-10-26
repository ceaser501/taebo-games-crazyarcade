// Plays a short bot match on every map with the shared simulation and room code, to catch
// crashes and maps nobody can move on. `npm test`.
import { MAPS } from '../js/shared/maps.js';
import { createGame, step, isOver } from '../js/shared/sim.js';
import { Bot } from '../js/shared/ai.js';
import { RoomCore } from '../js/shared/room.js';
import { HZ } from '../js/shared/const.js';

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
console.log(`${MAPS.length} maps, ${bad ? bad + ' problems' : 'all fine'}`);
process.exit(bad ? 1 : 0);
