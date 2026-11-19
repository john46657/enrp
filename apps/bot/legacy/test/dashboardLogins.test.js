// Tests für Anmeldungen im Dashboard (Verlauf, aktive Sitzungen, Roblox-Konto): npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'enrp-logins-'));
process.env.DASHBOARD_SECRET = 'login-secret-'.padEnd(40, 'x');
process.env.DASHBOARD_URL = 'http://localhost';
process.env.DISCORD_CLIENT_SECRET = 'client-secret';
const { Collection } = require('discord.js');
const { data, bucket } = require('../src/lib/db');
const logins = require('../src/dashboard/logins');
const { createApp } = require('../src/dashboard/server');

const ADMIN = '111111111111111111';
const PLAYER = '444444444444444444';
const NO_ROBLOX = '555555555555555555';

// Discord-API nachbauen: jeder Code steht für einen Nutzer.
const realFetch = global.fetch;
const discordUsers = {
  [`code-${ADMIN}`]: { user: { id: ADMIN, username: 'john', global_name: 'John', avatar: null }, connections: [{ type: 'roblox', id: '9001', name: 'JohnRBX', verified: true }] },
  [`code-${PLAYER}`]: { user: { id: PLAYER, username: 'spieler', global_name: null, avatar: 'abc' }, connections: [{ type: 'steam', id: '1', name: 'x' }] },
  [`code-${NO_ROBLOX}`]: { user: { id: NO_ROBLOX, username: 'leer', global_name: null, avatar: null }, connections: [] },
};
let tokenFor = null;
global.fetch = async (url, init = {}) => {
  if (!String(url).startsWith('https://discord.com/api')) return realFetch(url, init);
  const json = (body) => ({ ok: true, status: 200, json: async () => body });
  if (String(url).endsWith('/oauth2/token')) {
    tokenFor = discordUsers[new URLSearchParams(init.body).get('code')];
    return json({ token_type: 'Bearer', access_token: 'token' });
  }
  if (String(url).endsWith('/users/@me')) return json(tokenFor.user);
  if (String(url).endsWith('/users/@me/guilds')) return json([]);
  if (String(url).endsWith('/users/@me/connections')) return json(tokenFor.connections);
  throw new Error(`unerwartet: ${url}`);
};

const client = {
  application: { id: '1' },
  user: { username: 'ENRP', id: '1', displayAvatarURL: () => '' },
  ws: { ping: 1 },
  users: { fetch: async (id) => ({ id, username: 'x' }) },
  generateInvite: () => '#',
  guilds: { cache: new Collection() },
};

async function withServer(fn) {
  const server = createApp(client).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  // Anmelden wie im Browser: /login (state-Cookie) → /auth/callback → Sitzungs-Cookie
  const login = async (userId) => {
    const start = await realFetch(`${base}/login`, { redirect: 'manual' });
    const state = new URL(start.headers.get('location')).searchParams.get('state');
    assert.match(new URL(start.headers.get('location')).searchParams.get('scope'), /connections/, 'Scope connections angefragt');
    const callback = await realFetch(`${base}/auth/callback?code=code-${userId}&state=${state}`, { redirect: 'manual', headers: { Cookie: `oauth_state=${state}` } });
    assert.equal(callback.status, 302, 'Login klappt');
    return callback.headers.getSetCookie().find((c) => c.startsWith('session=')).split(';')[0];
  };
  const call = (method, url, cookie) =>
    realFetch(base + url, { method, headers: { Cookie: cookie, 'X-Dashboard': '1' } }).then(async (r) => ({ status: r.status, body: await r.json() }));
  try {
    await fn({ login, call });
  } finally {
    server.close();
  }
}

test('Roblox-Konto: Discord-Verbindung zuerst, sonst aus einer Bewerbung', () => {
  assert.deepEqual(logins.robloxFromConnections([{ type: 'roblox', id: 7, name: 'A', verified: true }]), { id: '7', name: 'A', verified: true, source: 'discord' });
  assert.equal(logins.robloxFromConnections([{ type: 'steam', id: 1 }]), null);
  bucket('apps', 'g1')['APP-0001'] = { userId: PLAYER, createdAt: 1, roblox: { id: 1, name: 'Alt' } };
  bucket('apps', 'g2')['APP-0002'] = { userId: PLAYER, createdAt: 2, roblox: { id: 2, name: 'Neu' } };
  assert.equal(logins.robloxFromApplications(PLAYER).name, 'Neu', 'neueste Bewerbung über alle Server');
  assert.equal(logins.findRoblox(NO_ROBLOX, []), null);
});

test('An- und Abmeldungen werden mit Uhrzeit, Discord- und Roblox-Konto aufgezeichnet', async () => {
  process.env.BOT_ADMINS = ADMIN;
  try {
    await withServer(async ({ login, call }) => {
      const before = Date.now();
      const adminCookie = await login(ADMIN);
      const playerCookie = await login(PLAYER);
      await login(NO_ROBLOX);

      const sessions = await call('GET', '/api/admin/sessions', adminCookie);
      assert.equal(sessions.status, 200);
      assert.equal(sessions.body.sessions.length, 3, 'alle drei angemeldet');
      const admin = sessions.body.sessions.find((x) => x.user.id === ADMIN);
      assert.equal(admin.roblox.name, 'JohnRBX');
      assert.equal(admin.roblox.source, 'discord');
      assert.equal(admin.current, true);
      assert.ok(admin.loginAt >= before && admin.online);
      assert.equal(sessions.body.sessions.find((x) => x.user.id === PLAYER).roblox.name, 'Neu', 'Fallback aus Bewerbung');
      assert.equal(sessions.body.sessions.find((x) => x.user.id === NO_ROBLOX).roblox, null);
      assert.ok(sessions.body.sessions.every((x) => x.id.length === 16), 'nur Kürzel, keine Sitzungs-IDs');

      assert.equal((await call('GET', '/api/admin/sessions', playerCookie)).status, 403, 'nur für Bot-Admins');
      assert.equal((await call('GET', '/api/admin/logins', playerCookie)).status, 403);

      // Sitzung eines anderen beenden → Person ist abgemeldet
      const player = sessions.body.sessions.find((x) => x.user.id === PLAYER);
      assert.equal((await call('DELETE', `/api/admin/sessions/${player.id}`, adminCookie)).status, 200);
      assert.equal((await call('GET', '/api/me', playerCookie)).status, 401);
      assert.equal((await call('DELETE', `/api/admin/sessions/${admin.id}`, adminCookie)).status, 400, 'eigene Sitzung nicht hier');

      const history = await call('GET', '/api/admin/logins', adminCookie);
      const types = history.body.events.map((e) => `${e.type}:${e.user.username}`);
      assert.deepEqual(types.slice(0, 4), ['ended:spieler', 'login:leer', 'login:spieler', 'login:john']);
      assert.equal(history.body.events[0].by.id, ADMIN);
      assert.ok(history.body.events.every((e) => typeof e.at === 'number'));

    });
  } finally {
    delete process.env.BOT_ADMINS;
  }
});

test('Abmelden wird aufgezeichnet, Verlauf ist auf 1000 Einträge begrenzt', () => {
  const user = { id: ADMIN, username: 'john' };
  logins.record('logout', user);
  assert.equal(logins.history({ limit: 1 })[0].type, 'logout');
  for (let i = 0; i < 1100; i++) logins.record('login', user);
  assert.equal(data.dashboardLogins.all.events.length, 1000);
  assert.equal(logins.history({ userId: '999' }).length, 0);
});
