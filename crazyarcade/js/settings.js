// Settings, opened from the home screen and from the game: background music, sound effects and
// how the game screen shows the map (all of it, or bigger with the camera on my character).
// Kept in this browser; the sound switches live in audio.js.
import { sfx, musicOn, soundOn, toggleMusic, toggleSound } from './audio.js';
import * as Account from './account.js';

const $ = (id) => document.getElementById(id);
const KEY = 'ca-settings';
const prefs = { view: null };
try { Object.assign(prefs, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { /* private mode */ }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* ignore */ } };

// 'full': the whole map as on the PC; 'big': 1.2 times larger, following me; 'fill': the map
// fills the screen and follows me.
const VIEWS = ['full', 'big', 'fill'];
// Until a view is picked: 'big' where the full view's cells would be under 40 px (phones),
// 'full' on tablets and computers, judged on the screen held sideways.
function autoView() {
  const w = Math.max(innerWidth, innerHeight), h = Math.min(innerWidth, innerHeight);
  const k = Math.min((h - 8) / 520, (w - 260) / 600, w / 600);
  return 40 * k < 40 ? 'big' : 'full';
}
export const viewMode = () => (VIEWS.includes(prefs.view) ? prefs.view : autoView());
export function setViewMode(v) { prefs.view = VIEWS.includes(v) ? v : 'big'; save(); }

export const settingsShown = () => !$('settings').hidden;

// onClose runs when the popup is closed (the home screen redraws its music state from it).
export function showSettings(onClose) {
  const box = $('settings');
  const render = () => {
    const sw = (id, on) => { $(id).classList.toggle('on', on); $(id).setAttribute('aria-checked', String(on)); $(id).querySelector('i').textContent = on ? '켜짐' : '꺼짐'; };
    sw('set-music', musicOn());
    sw('set-sound', soundOn());
    for (const b of document.querySelectorAll('#set-view button')) b.classList.toggle('on', b.dataset.view === viewMode());
    $('set-account').textContent = Account.signedIn() ? `${Account.name()} · Lv.${Account.rank().level}` : '계정 없이 하는 중 (계급 없음)';
    $('set-signout').textContent = Account.signedIn() ? '다른 이름으로' : '계정 만들기';
    $('set-signout').hidden = document.body.classList.contains('canvas-mode'); // not in the middle of a game
  };
  // Signs out and starts over at the nickname screen (any phone gets back in with name and PIN).
  $('set-signout').onclick = () => { Account.signOut(); location.reload(); };
  $('set-music').onclick = () => { toggleMusic(); sfx('Bt_c_Pop', 0.6); render(); };
  $('set-sound').onclick = () => { toggleSound(); sfx('Bt_c_Pop', 0.6); render(); };
  for (const b of document.querySelectorAll('#set-view button')) b.onclick = () => { setViewMode(b.dataset.view); sfx('Bt_c_Pop', 0.6); render(); };
  const close = () => { box.hidden = true; onClose?.(); };
  $('set-close').onclick = () => { sfx('Bt_c_Pop', 0.6); close(); };
  box.onclick = (e) => { if (e.target === box) close(); };
  render();
  box.hidden = false;
}
