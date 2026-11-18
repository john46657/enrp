// Tests für Schutz vor Massenlöschung und Lockdown: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'enrp-antinuke-'));
const { AuditLogEvent, ChannelType, Collection, PermissionFlagsBits } = require('discord.js');
const settings = require('../src/lib/settings');
const antiNuke = require('../src/lib/antiNuke');
const lockdown = require('../src/lib/lockdown');

const GUILD = '7100';
const BOT = 'bot';
const roles = (ids) => ({ cache: new Collection(ids.map((id) => [id, { id }])) });

function fakeGuild({ executor = 'evil', memberRoles = ['r1', 'r2'] } = {}) {
  const removed = [];
  const sent = [];
  const roleObjs = new Collection(memberRoles.map((id) => [id, { id, editable: id !== 'high', managed: false }]));
  const member = {
    roles: {
      cache: roleObjs,
      remove: async (ids) => removed.push(...ids),
    },
  };
  const log = { isTextBased: () => true, send: async (m) => sent.push(m) };
  const guild = {
    id: GUILD,
    ownerId: 'owner',
    client: { user: { id: BOT } },
    fetchAuditLogs: async () => ({
      entries: new Collection([['e', { targetId: guild._target, executorId: executor, createdTimestamp: Date.now() }]]),
    }),
    members: { fetch: async () => ({ ...member, guild }) },
    channels: { cache: new Collection([['log', log]]), fetch: async (id) => (id === 'log' ? log : null) },
  };
  member.guild = guild;
  return { guild, removed, sent, member };
}

async function destroy(guild, id) {
  guild._target = id;
  return antiNuke.handleDestructive(guild, AuditLogEvent.ChannelDelete, id, `kanal-${id}`);
}

test.beforeEach(() => {
  antiNuke._reset();
  settings.reset(GUILD);
  settings.set(GUILD, 'security.enabled', true);
  settings.set(GUILD, 'security.logChannel', 'log');
  settings.set(GUILD, 'security.antiNuke.enabled', true);
  settings.set(GUILD, 'security.antiNuke.actions', 3);
});

test('track zählt nur innerhalb des Zeitfensters', () => {
  assert.equal(antiNuke.track('k', 0, 10), 1);
  assert.equal(antiNuke.track('k', 5_000, 10), 2);
  assert.equal(antiNuke.track('k', 16_000, 10), 1);
});

test('ab der Schwelle werden Rollen einmal entfernt und gemeldet', async () => {
  const { guild, removed, sent } = fakeGuild({ memberRoles: ['r1', 'high'] });
  assert.deepEqual(await destroy(guild, 'c1'), { count: 1, punished: false });
  assert.deepEqual(await destroy(guild, 'c2'), { count: 2, punished: false });
  const third = await destroy(guild, 'c3');
  assert.equal(third.punished, true);
  assert.deepEqual(removed, ['r1']); // Rolle über dem Bot bleibt
  assert.equal(sent.length, 1);
  assert.match(sent[0].embeds[0].data.description, /3 destruktive Aktionen/);
  assert.equal((await destroy(guild, 'c4')).punished, false); // nicht doppelt bestrafen
});

test('Besitzer, Bot, vertrauenswürdige Rollen und „nur melden“', async () => {
  assert.equal(await destroy(fakeGuild({ executor: 'owner' }).guild, 'x'), null);
  assert.equal(await destroy(fakeGuild({ executor: BOT }).guild, 'x'), null);
  settings.set(GUILD, 'security.antiNuke.trustedRoles', ['r2']);
  assert.equal(await destroy(fakeGuild().guild, 'x'), null);
  settings.set(GUILD, 'security.antiNuke.trustedRoles', []);
  settings.set(GUILD, 'security.antiNuke.punish', 'log');
  const { guild, removed, sent } = fakeGuild();
  for (const id of ['a', 'b', 'c']) await destroy(guild, id);
  assert.deepEqual(removed, []);
  assert.match(sent[0].embeds[0].data.description, /nur gemeldet/);
});

test('ausgeschaltet → keine Prüfung', async () => {
  settings.set(GUILD, 'security.antiNuke.enabled', false);
  assert.equal(await destroy(fakeGuild().guild, 'x'), null);
});

function fakeChannel(id, overwrite) {
  const edits = [];
  const ow = overwrite && {
    allow: { has: (f) => overwrite.allow?.includes(f) ?? false },
    deny: { has: (f) => overwrite.deny?.includes(f) ?? false },
  };
  return {
    id,
    type: ChannelType.GuildText,
    edits,
    permissionsFor: () => ({ has: () => true }),
    permissionOverwrites: { cache: new Map(ow ? [['g2', ow]] : []), edit: async (_id, values) => edits.push(values) },
  };
}

test('Lockdown sperrt Kanäle und stellt vorherige Rechte wieder her', async () => {
  const open = fakeChannel('a');
  const denied = fakeChannel('b', { deny: [PermissionFlagsBits.SendMessages] });
  const guild = { id: 'g2', members: { me: {} }, channels: { cache: new Collection([['a', open], ['b', denied]]) } };
  assert.deepEqual(await lockdown.lock(guild, 'u1', 'Raid'), { locked: 2, failed: 0 });
  assert.equal(lockdown.isLocked('g2'), true);
  await assert.rejects(lockdown.lock(guild, 'u1', 'nochmal'), /bereits gesperrt/);
  assert.deepEqual(open.edits[0], { SendMessages: false, SendMessagesInThreads: false, CreatePublicThreads: false });
  assert.deepEqual(await lockdown.unlock(guild, 'vorbei'), { restored: 2 });
  assert.deepEqual(open.edits[1], { SendMessages: null, SendMessagesInThreads: null, CreatePublicThreads: null });
  assert.deepEqual(denied.edits[1], { SendMessages: false, SendMessagesInThreads: null, CreatePublicThreads: null });
  assert.equal(lockdown.isLocked('g2'), false);
  await assert.rejects(lockdown.unlock(guild, 'x'), /kein Lockdown/);
});
