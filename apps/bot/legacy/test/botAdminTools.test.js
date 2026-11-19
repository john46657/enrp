// Tests für die Werkzeuge im Admin-Bereich (Fehler-Log, Audit-Log, Server sperren/verlassen, Systemstatus, Backup): npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'enrp-botadmin-'));
process.env.DASHBOARD_SECRET = 'botadmin-secret-'.padEnd(40, 'x');
process.env.DASHBOARD_URL = 'http://localhost';
process.env.DISCORD_CLIENT_SECRET = 'client-secret';
const { Collection } = require('discord.js');
const { data, bucket, flush } = require('../src/lib/db');
const botAdmin = require('../src/lib/botAdmin');
const settings = require('../src/lib/settings');
const { createApp } = require('../src/dashboard/server');

const ADMIN = '111111111111111111';
const PLAYER = '444444444444444444';
const GUILD = '900000000000000001';
const OTHER = '900000000000000002';

const realFetch = global.fetch;
const discordUsers = {
  [`code-${ADMIN}`]: { id: ADMIN, username: 'john', global_name: 'John', avatar: null },
  [`code-${PLAYER}`]: { id: PLAYER, username: 'spieler', global_name: null, avatar: null },
};
let tokenFor = null;
global.fetch = async (url, init = {}) => {
  if (!String(url).startsWith('https://discord.com/api')) return realFetch(url, init);
  const json = (body) => ({ ok: true, status: 200, json: async () => body });
  if (String(url).endsWith('/oauth2/token')) {
    tokenFor = discordUsers[new URLSearchParams(init.body).get('code')];
    return json({ token_type: 'Bearer', access_token: 'token' });
  }
  if (String(url).endsWith('/users/@me')) return json(tokenFor);
  if (String(url).endsWith('/users/@me/guilds')) return json([]);
  if (String(url).endsWith('/users/@me/connections')) return json([]);
  throw new Error(`unerwartet: ${url}`);
};

const cache = new Collection();
const left = [];
function fakeGuild(id, name) {
  return {
    id,
    name,
    memberCount: 10,
    ownerId: '1',
    joinedTimestamp: 1,
    iconURL: () => null,
    members: { fetch: async () => Promise.reject(new Error('kein Mitglied')) },
    channels: { cache: new Collection() },
    roles: { cache: new Collection() },
    leave: async () => {
      left.push(id);
      cache.delete(id);
    },
  };
}
const client = {
  application: { id: '1' },
  user: { username: 'ENRP', id: '1', displayAvatarURL: () => '' },
  ws: { ping: 7 },
  users: { fetch: async (id) => ({ id, username: 'john' }) },
  generateInvite: () => '#',
  guilds: { cache },
};

async function withServer(fn) {
  const server = createApp(client).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = async (userId) => {
    const start = await realFetch(`${base}/login`, { redirect: 'manual' });
    const state = new URL(start.headers.get('location')).searchParams.get('state');
    const callback = await realFetch(`${base}/auth/callback?code=code-${userId}&state=${state}`, { redirect: 'manual', headers: { Cookie: `oauth_state=${state}` } });
    return callback.headers.getSetCookie().find((c) => c.startsWith('session=')).split(';')[0];
  };
  const call = async (method, url, cookie, body) => {
    const r = await realFetch(base + url, {
      method,
      headers: { Cookie: cookie, 'X-Dashboard': '1', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
    return { status: r.status, body: parsed, headers: r.headers };
  };
  try {
    await fn({ login, call });
  } finally {
    server.close();
  }
}

test('Fehler-Log: Meldungen mit Bereich, Wiederholungen zusammengefasst, Stack von Errors', () => {
  botAdmin.recordError(['[event:messageCreate]', new Error('kaputt')]);
  botAdmin.recordError(['[event:messageCreate]', new Error('kaputt')].map(String));
  botAdmin.recordError(['[x] gleich']);
  botAdmin.recordError(['[x] gleich']);
  const list = botAdmin.errorList();
  assert.equal(list[0].text, '[x] gleich');
  assert.equal(list[0].count, 2, 'direkt wiederholt → zusammengefasst');
  assert.equal(list[0].label, 'x');
  assert.match(list.at(-1).text, /Error: kaputt\n\s+at /, 'Stack wird gespeichert');
  for (let i = 0; i < 350; i++) botAdmin.recordError([`Fehler ${i}`]);
  assert.equal(data.botAdmin.all.errors.length, 300, 'begrenzt');
  botAdmin.clearErrors();
  assert.equal(botAdmin.errorList().length, 0);
});

test('Fehler-Log: console.error wird mitgeschrieben', (t) => {
  t.mock.method(process.stderr, 'write', () => true); // Ausgabe im Test unterdrücken
  botAdmin.captureErrors();
  console.error('[test] etwas ging schief', { code: 42 });
  assert.equal(botAdmin.errorList()[0].text, '[test] etwas ging schief {"code":42}');
  botAdmin.clearErrors();
});

test('Gesperrte Server: sperren, prüfen, gesperrten Server sofort verlassen, entsperren', async () => {
  const guild = fakeGuild('900000000000000099', 'Böse');
  cache.set(guild.id, guild);
  assert.equal(await botAdmin.leaveIfBlocked(guild), false);
  botAdmin.block(guild, { id: ADMIN, username: 'john' }, 'Spam');
  assert.equal(botAdmin.isBlocked(guild.id), true);
  assert.equal(await botAdmin.leaveIfBlocked(guild), true);
  assert.ok(left.includes(guild.id));
  assert.equal(botAdmin.blockedList()[0].reason, 'Spam');
  assert.equal(botAdmin.unblock(guild.id), true);
  assert.equal(botAdmin.unblock(guild.id), false);
});

test('Admin-Bereich im Dashboard: Status, Audit, Verlassen/Sperren, Backup – nur für Bot-Admins', async () => {
  process.env.BOT_ADMINS = ADMIN;
  cache.set(GUILD, fakeGuild(GUILD, 'ENRP'));
  cache.set(OTHER, fakeGuild(OTHER, 'Fremd'));
  try {
    await withServer(async ({ login, call }) => {
      const admin = await login(ADMIN);
      const player = await login(PLAYER);

      for (const url of ['/api/admin/status', '/api/admin/errors', '/api/admin/audit', '/api/admin/blocked', '/api/admin/backup']) {
        assert.equal((await call('GET', url, player)).status, 403, `${url} nur für Bot-Admins`);
      }
      assert.equal((await call('POST', `/api/admin/guilds/${GUILD}/leave`, player, {})).status, 403);

      const status = await call('GET', '/api/admin/status', admin);
      assert.equal(status.status, 200);
      assert.equal(status.body.bot.ping, 7);
      assert.equal(status.body.bot.guilds, 2);
      assert.ok(status.body.process.memory.rss > 0);
      assert.match(status.body.process.node, /^v\d+/);

      // Einstellung auf fremdem Server ändern → Audit mit vorher/nachher, als Bot-Admin ohne Mitgliedschaft
      const before = settings.forGuild(GUILD).welcome.message;
      const put = await call('PUT', `/api/guilds/${GUILD}/settings`, admin, { changes: [{ path: 'welcome.message', value: 'Hallo {user}' }] });
      assert.equal(put.status, 200);
      const audit = await call('GET', '/api/admin/audit?admins=1', admin);
      const change = audit.body.events.find((e) => e.type === 'settings.change');
      assert.equal(change.guild.id, GUILD);
      assert.equal(change.actor.id, ADMIN);
      assert.equal(change.actor.botAdmin, true);
      assert.equal(change.actor.member, false, 'kein Mitglied auf dem Server');
      assert.deepEqual(change.changes[0], { path: 'welcome.message', before, after: 'Hallo {user}' });

      // Verlassen ohne Sperre, dann per ID sperren (Bot ist drauf → verlässt sofort)
      assert.equal((await call('POST', `/api/admin/guilds/${GUILD}/leave`, admin, { block: false })).status, 200);
      assert.ok(left.includes(GUILD));
      assert.equal(botAdmin.isBlocked(GUILD), false);
      assert.equal((await call('POST', `/api/admin/guilds/${GUILD}/leave`, admin, {})).status, 404, 'nicht mehr drauf');
      assert.equal((await call('POST', '/api/admin/blocked', admin, { id: 'abc' })).status, 400);
      const blocked = await call('POST', '/api/admin/blocked', admin, { id: OTHER, reason: 'Regelverstoß' });
      assert.equal(blocked.status, 200);
      assert.equal(blocked.body.left, true);
      assert.ok(left.includes(OTHER));
      assert.equal((await call('GET', '/api/admin/blocked', admin)).body.blocked[0].name, 'Fremd');
      assert.equal((await call('DELETE', `/api/admin/blocked/${OTHER}`, admin)).status, 200);
      assert.equal((await call('DELETE', `/api/admin/blocked/${OTHER}`, admin)).status, 404);
      const types = (await call('GET', '/api/admin/audit', admin)).body.events.map((e) => e.type);
      assert.deepEqual(types.slice(0, 4), ['guild.unblock', 'guild.block', 'guild.leave', 'settings.change']);

      // Backup: ohne Sitzungen herunterladen, wieder einspielen
      bucket('warnings', GUILD).u1 = [{ reason: 'alt' }];
      const download = await call('GET', '/api/admin/backup', admin);
      assert.equal(download.status, 200);
      assert.match(download.headers.get('content-disposition'), /attachment; filename="db-backup-/);
      assert.equal(download.body.dashboardSessions, undefined, 'keine Sitzungen im Backup');
      assert.deepEqual(download.body.warnings[GUILD].u1, [{ reason: 'alt' }]);

      const overrides = data.settings; // Module halten diese Referenz – muss nach dem Einspielen gültig bleiben
      bucket('warnings', GUILD).u2 = [{ reason: 'neu' }];
      data.nurNachDemBackup = { x: 1 };
      assert.equal((await call('POST', '/api/admin/backup', admin, { backup: [] })).status, 400);
      const restored = await call('POST', '/api/admin/backup', admin, { backup: download.body });
      assert.equal(restored.status, 200);
      assert.match(restored.body.safety, /^db\.json\.vor-wiederherstellung-\d+$/);
      assert.ok(fs.existsSync(path.join(process.env.DATA_DIR, restored.body.safety)), 'vorheriger Stand gesichert');
      assert.equal(data.warnings[GUILD].u2, undefined, 'neuere Daten ersetzt');
      assert.deepEqual(data.warnings[GUILD].u1, [{ reason: 'alt' }]);
      assert.deepEqual(data.nurNachDemBackup, {}, 'Bereiche, die das Backup nicht kennt, werden geleert');
      assert.equal(data.settings, overrides, 'gleiches Objekt, nur der Inhalt ersetzt');
      assert.equal(settings.forGuild(GUILD).welcome.message, 'Hallo {user}');
      assert.equal((await call('GET', '/api/me', admin)).status, 200, 'eigene Sitzung bleibt bestehen');
      flush();
      assert.equal(JSON.parse(fs.readFileSync(path.join(process.env.DATA_DIR, 'db.json'), 'utf8')).warnings[GUILD].u2, undefined);
    });
  } finally {
    delete process.env.BOT_ADMINS;
  }
});
