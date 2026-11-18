// Tests für Bot-Admins (BOT_ADMINS) und den Admin-Bereich im Dashboard: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'enrp-botadmin-'));
process.env.DASHBOARD_SECRET = 'test-secret-'.padEnd(40, 'x');
const { Collection, PermissionFlagsBits } = require('discord.js');
const { bucket } = require('../src/lib/db');
const { botAdmins, isBotAdmin, isStaff } = require('../src/lib/util');
const { createApp } = require('../src/dashboard/server');

const ADMIN = '111111111111111111';
const NOBODY = '222222222222222222';
const MEMBER_ADMIN = '333333333333333333';

// Nachgebauter Bot mit zwei Servern. ADMIN ist auf keinem Mitglied.
function fakeClient() {
  const users = new Map([ADMIN, NOBODY, MEMBER_ADMIN].map((id) => [id, { id, username: `u${id.slice(0, 3)}`, globalName: null, toString: () => `<@${id}>` }]));
  const makeGuild = (id, name, memberCount) => {
    const guild = {
      id,
      name,
      memberCount,
      ownerId: '999',
      joinedTimestamp: Date.now() - 86_400_000,
      iconURL: () => null,
      channels: { cache: new Collection() },
      roles: { cache: new Collection() },
      members: {
        fetch: async (userId) => {
          if (userId !== MEMBER_ADMIN) throw new Error('Unknown Member');
          return { id: userId, guild, permissions: { has: (p) => p === PermissionFlagsBits.ManageGuild }, roles: { cache: new Collection() } };
        },
      },
    };
    return guild;
  };
  return {
    application: { id: '1' },
    user: { username: 'ENRP', id: '1', displayAvatarURL: () => '' },
    ws: { ping: 42 },
    users: { fetch: async (id) => users.get(id) },
    generateInvite: () => 'https://discord.com/invite',
    guilds: { cache: new Collection([['g1', makeGuild('g1', 'Polizei', 120)], ['g2', makeGuild('g2', 'Leitstelle', 30)]]) },
  };
}

// Sitzung wie nach dem Discord-Login anlegen und das signierte Cookie bauen.
function sessionCookie(userId) {
  const id = crypto.randomBytes(12).toString('base64url');
  bucket('dashboardSessions', 'all')[id] = { user: { id: userId, username: `u${userId.slice(0, 3)}` }, guilds: [], expiresAt: Date.now() + 60_000 };
  const signed = `${id}.${crypto.createHmac('sha256', process.env.DASHBOARD_SECRET).update(id).digest('base64url')}`;
  return `session=${encodeURIComponent(signed)}`;
}

async function withServer(fn) {
  const server = createApp(fakeClient()).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn((url, userId) => fetch(base + url, { headers: { Cookie: sessionCookie(userId) } }).then(async (r) => ({ status: r.status, body: await r.json() })));
  } finally {
    server.close();
  }
}

test('BOT_ADMINS: nur gültige Discord-IDs, mehrere Trennzeichen', () => {
  assert.deepEqual([...botAdmins({ BOT_ADMINS: `${ADMIN}, 123,${NOBODY};abc` })], [ADMIN, NOBODY]);
  assert.equal(botAdmins({}).size, 0);
});

test('Bot-Admin gilt in Discord überall als Staff', () => {
  process.env.BOT_ADMINS = ADMIN;
  const guild = { id: 'g1' };
  const noRights = (id) => ({ id, guild, permissions: { has: () => false }, roles: { cache: new Collection() } });
  assert.equal(isBotAdmin(ADMIN), true);
  assert.equal(isStaff(noRights(ADMIN)), true);
  assert.equal(isStaff(noRights(NOBODY)), false);
  delete process.env.BOT_ADMINS;
  assert.equal(isStaff(noRights(ADMIN)), false, 'ohne Eintrag keine Sonderrechte');
});

test('Dashboard: Admin-Bereich und Zugriff auf jeden Server nur für Bot-Admins', async () => {
  process.env.BOT_ADMINS = ADMIN;
  try {
    await withServer(async (get) => {
      const me = await get('/api/me', ADMIN);
      assert.equal(me.body.user.isBotAdmin, true);
      assert.equal((await get('/api/me', NOBODY)).body.user.isBotAdmin, false);

      const list = await get('/api/admin/guilds', ADMIN);
      assert.equal(list.status, 200);
      assert.deepEqual(list.body.guilds.map((g) => g.name), ['Polizei', 'Leitstelle'], 'alle Server, nach Mitgliedern sortiert');
      assert.equal(list.body.totals.members, 150);
      assert.equal(list.body.guilds[0].member, false);
      assert.equal((await get('/api/admin/guilds', NOBODY)).status, 403, 'Admin-Liste nur für Bot-Admins');

      assert.equal((await get('/api/guilds/g1', ADMIN)).status, 200, 'Bot-Admin darf ohne Mitgliedschaft auf den Server');
      assert.equal((await get('/api/guilds/g1', NOBODY)).status, 403, 'andere nicht');
      assert.equal((await get('/api/guilds/g1', MEMBER_ADMIN)).status, 200, 'normale Verwalter weiterhin');
    });
  } finally {
    delete process.env.BOT_ADMINS;
  }
});
