// Cloudflare Pages function: /api/* on the site goes to the room server's Durable Objects
// (bound in wrangler.toml), so the game and its server share one address.
export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  if (!env.ROOMS || !env.LOBBY) return json({ error: 'room server not bound' }, 503);
  if (url.pathname === '/api/rooms') return env.LOBBY.get(env.LOBBY.idFromName('lobby')).fetch('https://lobby/list');
  const m = url.pathname.match(/^\/api\/room\/(\d{4})$/);
  if (m) return env.ROOMS.get(env.ROOMS.idFromName(m[1])).fetch(request);
  // Accounts: sign up or in, read my rank, count a practice game (the room objects use the rest).
  const a = url.pathname.match(/^\/api\/account\/(enter|me|practice|buy|wear|char|import|missions|claim|spin)$/);
  if (a && request.method === 'POST') {
    if (!env.ACCOUNTS) return json({ error: 'accounts not bound' }, 503);
    return env.ACCOUNTS.get(env.ACCOUNTS.idFromName('accounts')).fetch(`https://accounts/${a[1]}`, { method: 'POST', body: await request.text() });
  }
  return json({ error: 'not found' }, 404);
}
