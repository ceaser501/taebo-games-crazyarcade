// Background music (the PC client's tracks, looped) and sound effects (Web Audio buffers).
// Phones only allow sound after a touch, so everything waits for unlock().
import { manifest } from './assets.js';

const BASE = 'assets/ca/';
let ctx = null;
const buffers = new Map();
// One <audio> element for every track: phones (iPhones above all) only let an element play after
// a touch, and once it has played it may change tracks freely. A new element per track would be
// silenced whenever a track starts on its own (a round's music, after loading) and could leave
// an old one playing beside the new.
let player = null, musicName = null, wanted = null, unlocked = false;
const el = () => {
  if (!player) { player = new Audio(); player.preload = 'auto'; player.volume = 0.55; }
  return player;
};
const prefs = { music: true, sound: true };
try { Object.assign(prefs, JSON.parse(localStorage.getItem('ca-audio') || '{}')); } catch { /* private mode */ }
const save = () => { try { localStorage.setItem('ca-audio', JSON.stringify(prefs)); } catch { /* ignore */ } };

const ext = () => manifest.audio || 'ogg';

export function unlock() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) ctx = new AC();
  }
  if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {});
  // The first touch unlocks the music element (silently when nothing is wanted yet), and any
  // track the browser held back starts now.
  const a = el();
  if (!unlocked) {
    unlocked = true;
    if (!musicName) { a.muted = true; a.play().then(() => { a.pause(); a.muted = false; }).catch(() => { a.muted = false; unlocked = false; }); }
  }
  if (musicName && a.paused && !document.hidden && prefs.music) a.play().catch(() => {});
}

// The result tunes (Ntc_Win, Ntc_Lose, Ntc_Draw) are short: they go as sound effects, which play
// whenever sound is unlocked, and the music stops for them.
const JINGLES = new Set(['Ntc_Win', 'Ntc_Lose', 'Ntc_Draw', 'Ntc_GameEnd']);

export function playMusic(name, force = false) {
  if (JINGLES.has(name)) { stopMusic(); sfx(name, 0.75); return; }
  wanted = name;
  if (!prefs.music || !manifest.bgm.includes(name)) { stopMusic(false); return; }
  const a = el();
  if (!force && musicName === name && !a.paused) return;
  musicName = name;
  a.loop = true;
  a.src = `${BASE}bgm/${name}.${ext()}`;
  a.currentTime = 0;
  if (!document.hidden) a.play().catch(() => { /* waits for the next touch (unlock) */ });
}

export function stopMusic(forget = true) {
  if (player) player.pause();
  musicName = null;
  if (forget) wanted = null;
}

// The app in the background (another app, the phone locked): quiet, and back where it was.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { if (player) player.pause(); if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {}); return; }
  if (ctx) ctx.resume().catch(() => {});
  if (musicName && player && prefs.music) player.play().catch(() => {});
});

async function buffer(name) {
  if (!buffers.has(name)) {
    buffers.set(name, fetch(`${BASE}sfx/${name}.${ext()}`).then((r) => r.arrayBuffer())
      .then((b) => new Promise((res, rej) => ctx.decodeAudioData(b, res, rej))).catch(() => null));
  }
  return buffers.get(name);
}

export async function sfx(name, volume = 0.8) {
  if (!prefs.sound || !ctx || !manifest.sfx.includes(name)) return;
  const b = await buffer(name);
  if (!b) return;
  const src = ctx.createBufferSource(), g = ctx.createGain();
  src.buffer = b; g.gain.value = volume;
  src.connect(g).connect(ctx.destination);
  src.start();
}

export function preload(names) { if (ctx) for (const n of names) if (manifest.sfx.includes(n)) buffer(n); }

export const musicOn = () => prefs.music;
export const soundOn = () => prefs.sound;
export function toggleMusic() { prefs.music = !prefs.music; save(); if (prefs.music && wanted) playMusic(wanted, true); else stopMusic(false); return prefs.music; }
export function toggleSound() { prefs.sound = !prefs.sound; save(); return prefs.sound; }
