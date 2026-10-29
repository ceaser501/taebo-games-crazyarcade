// Chat: the room's lines, kept for the waiting room's panel and the game's list under the
// players. Lines from a player carry their id (for the bubble over their head); the room's own
// notices (joins, leaves) have none.
const MAX = 60;
export const lines = []; // { id, name, text, at }
const listeners = new Set();

export function add(m) {
  const line = { id: m.id || null, name: m.name || null, text: String(m.text || ''), at: performance.now() };
  lines.push(line);
  if (lines.length > MAX) lines.shift();
  for (const f of listeners) f(line);
}
export function clear() { lines.length = 0; for (const f of listeners) f(null); }
export function onLine(f) { listeners.add(f); return () => listeners.delete(f); }

// The last line each player said, while it should still show over their head.
export const BUBBLE_MS = 3500;
export function bubbleFor(id, now = performance.now()) {
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (now - l.at > BUBBLE_MS) return null;
    if (l.id === id) return l;
  }
  return null;
}
