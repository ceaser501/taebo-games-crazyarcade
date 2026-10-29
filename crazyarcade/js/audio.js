// Background music (the PC client's tracks, looped) and sound effects (Web Audio buffers).
// Phones only allow sound after a touch, so everything waits for unlock().
import { manifest } from './assets.js';

const BASE = 'assets/ca/';
let ctx = null;
const buffers = new Map();
let music = null, musicName = null, wanted = null, blocked = false;
const prefs = { music: true, sound: true };
try { Object.assign(prefs, JSON.parse(localStorage.getItem('ca-audio') || '{}')); } catch { /* private mode */ }
const save = () => { try { localStorage.setItem('ca-audio', JSON.stringify(prefs)); } catch { /* ignore */ } };

const ext = () => manifest.audio || 'ogg';

export function unlock() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) ctx = new AC();
  }
  if (ctx && ctx.state === 'suspended') ctx.resume();
  // Music the browser refused before the first touch starts now (a finished one-shot tune,
  // like the win jingle, is not played again).
  if (wanted && blocked) playMusic(wanted, true);
}

export function playMusic(name, force = false) {
  wanted = name;
  if (!prefs.music || !manifest.bgm.includes(name)) { stopMusic(false); return; }
  if (!force && musicName === name && music && !music.paused) return;
  stopMusic(false);
  const a = new Audio(`${BASE}bgm/${name}.${ext()}`);
  a.loop = !name.startsWith('Ntc_');
  a.volume = 0.55;
  blocked = false;
  a.play().catch(() => { if (music === a) blocked = true; });
  music = a; musicName = name;
}

export function stopMusic(forget = true) {
  if (music) { music.pause(); music.src = ''; }
  music = null; musicName = null; blocked = false;
  if (forget) wanted = null;
}

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
