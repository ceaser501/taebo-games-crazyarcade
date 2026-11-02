// The 대기실 (channel) every player sits in between rooms: the open rooms (each room reports
// itself), who is on (here or in a room), and the lobby chat. The same core runs in the Lobby
// Durable Object and in the local dev server; send(pid, msg) and broadcast(msg) deliver.
const ROOM_TTL = 60000; // a room that stops reporting is gone
const CHAT_KEEP = 30;

export class LobbyCore {
  constructor({ send, broadcast }) {
    Object.assign(this, { send, broadcast });
    this.rooms = new Map(); // code -> summary from the room
    this.users = new Map(); // pid -> { name, lv, title, said: [] } of players in the lobby
    this.chatLog = [];
  }

  // Rooms with someone in them, waiting ones first, newest first.
  roomList(now = Date.now()) {
    for (const [k, r] of this.rooms) if (now - r.at > ROOM_TTL) this.rooms.delete(k);
    return [...this.rooms.values()].sort((a, b) => a.playing - b.playing || b.at - a.at);
  }
  // Everyone on: lobby players, then players in rooms (from the rooms' reports).
  userList() {
    const here = [...this.users.values()].map(({ name, lv, title }) => ({ name, lv, title, at: 'lobby' }));
    const away = this.roomList().flatMap((r) => (r.people || []).map((p) => ({ ...p, at: r.playing ? 'game' : r.code })));
    const seen = new Set(away.map((p) => p.name));
    return [...here.filter((p) => !seen.has(p.name)), ...away];
  }

  roomUpdate(r) {
    if (r.closed) this.rooms.delete(r.code); else this.rooms.set(r.code, { ...r, at: Date.now() });
    this.broadcast({ t: 'rooms', rooms: this.roomList(), users: this.userList() });
  }

  join(pid, user) {
    this.users.set(pid, { name: String(user.name || '플레이어').slice(0, 10), lv: user.lv || null, title: user.title || null, said: [] });
    this.send(pid, { t: 'hello', rooms: this.roomList(), users: this.userList(), chat: this.chatLog });
    this.broadcast({ t: 'users', users: this.userList() });
  }
  leave(pid) {
    if (!this.users.delete(pid)) return;
    this.broadcast({ t: 'users', users: this.userList() });
  }

  // A chat line: at most 5 in 5 seconds from one player.
  chat(pid, text) {
    const u = this.users.get(pid);
    if (!u || typeof text !== 'string' || !text.trim()) return;
    const now = Date.now();
    u.said = u.said.filter((t) => now - t < 5000);
    if (u.said.length >= 5) { this.send(pid, { t: 'notice', text: '채팅을 조금 천천히 보내 주세요.' }); return; }
    u.said.push(now);
    const line = { name: u.name, text: text.trim().replace(/[\u0000-\u001f]/g, ' ').slice(0, 80) };
    this.chatLog.push(line); if (this.chatLog.length > CHAT_KEEP) this.chatLog.shift();
    this.broadcast({ t: 'chat', ...line });
  }

  message(pid, msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'chat') this.chat(pid, msg.text);
  }
}
