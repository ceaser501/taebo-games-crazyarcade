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
