// Tests für die Brücke zum Dashboard der Plattform: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'enrp-bridge-'));
const { Collection } = require('discord.js');
const settings = require('../src/lib/settings');
const { bucket } = require('../src/lib/db');
const bridge = require('../src/lib/platformBridge');

const GUILD = '7100';
const ROLE = '111111111111111111';
const sent = [];
const role = (id, name, extra = {}) => ({ id, name, hexColor: '#000000', position: 1, managed: false, editable: true, ...extra });
const textChannel = { id: '500', name: 'panel', type: 0, guild: null, isTextBased: () => true, isVoiceBased: () => false, send: async (m) => (sent.push(m), { id: '900' }) };
const guild = {
  id: GUILD,
  name: 'Test',
  memberCount: 3,
  iconURL: () => null,
  members: { cache: new Collection([['10', { id: '10', user: { id: '10', username: 'anna' } }]]), fetch: async (id) => guild.members.cache.get(id) ?? null },
  channels: { cache: new Collection([['500', textChannel]]), fetch: async (id) => guild.channels.cache.get(id) ?? null },
  roles: { cache: new Collection([[ROLE, role(ROLE, 'Events')], ['222222222222222222', role('222222222222222222', 'Bot', { managed: true })]]) },
};
textChannel.guild = guild;
const request = (kind, name, payload = {}, actorDiscordId = '10') => ({ kind, name, payload, actorDiscordId });

test('Einstellungen lesen: nur ladbare Module, Kanäle und Rollen für die Auswahl', async () => {
  const data = await bridge.handle(guild, request('live', 'guild'));
  assert.deepEqual(Object.keys(data.config).sort(), [...bridge.EDITABLE].sort());
  assert.equal(data.channels[0].name, 'panel');
  assert.equal(data.roles.length, 2);
  assert.ok(data.questionTypes);
});

test('Einstellungen speichern: alle oder keine, geprüft wie in Discord', async () => {
  const save = (changes) => bridge.handle(guild, request('settings', 'save', { changes }));
  await assert.rejects(save([{ path: 'moderation.warnLimit', value: 3 }]), /kann im Dashboard nicht geändert werden/);
  await assert.rejects(save([{ path: 'tickets.gibtEsNicht.x', value: 1 }]), /Unbekannte Einstellung/);
  await assert.rejects(save([{ path: 'timezone', value: 'Mars/Olympus' }]), /Unbekannte Zeitzone/);
  await assert.rejects(save([{ path: 'tickets.panel.title', value: 'Neu' }, { path: 'tickets.maxOpenPerUser', value: 999 }]), /Tickets pro Nutzer/);
  assert.notEqual(settings.forGuild(GUILD).tickets.panel.title, 'Neu', 'nichts gespeichert, wenn eine Änderung ungültig ist');
  await assert.rejects(save([{ path: 'tickets.openingHours.periods', value: [{ days: ['xx'], from: '10:00', to: '12:00' }] }]), /Tage/);
  await assert.rejects(save([{ path: 'leveling.roleRewards', value: { 5: 'keine-id' } }]), /ungültige Rolle/);

  const result = await save([
    { path: 'tickets.panel.title', value: 'Support' },
    { path: 'tickets.openingHours.periods', value: [{ days: ['mo', 'di'], from: '15:00', to: '24:00' }] },
    { path: 'leveling.roleRewards', value: { 5: ROLE } },
    { path: 'channels.welcome', value: '500' },
  ]);
  assert.equal(result.changed, 4);
  const config = settings.forGuild(GUILD);
  assert.equal(config.tickets.panel.title, 'Support');
  assert.equal(config.leveling.roleRewards[5], ROLE);

  assert.deepEqual(await bridge.handle(guild, request('reset', 'reset')), { changed: 0 });
  assert.notEqual(settings.forGuild(GUILD).tickets.panel.title, 'Support');
});

test('Level: Rangliste, XP setzen und zurücksetzen', async () => {
  bucket('levels', GUILD)['10'] = { xp: 250 };
  bucket('levels', GUILD)['11'] = { xp: 50 };
  const data = await bridge.handle(guild, request('live', 'levels'));
  assert.equal(data.total, 2);
  assert.deepEqual([data.top[0].userId, data.top[0].userName, data.top[0].level], ['10', 'anna', 1]);
  assert.equal(data.top[1].userName, null);

  await assert.rejects(bridge.handle(guild, request('action', 'level-set', { userId: '11111111111111111', xp: -1 })), /XP/);
  await assert.rejects(bridge.handle(guild, request('action', 'level-set', { userId: 'x', xp: 1 })), /Discord-ID/);
  const set = await bridge.handle(guild, request('action', 'level-set', { userId: '11111111111111111', xp: 100 }));
  assert.equal(set.level, 1);
  await bridge.handle(guild, request('action', 'level-reset', { userId: '11111111111111111' }));
  assert.equal(bucket('levels', GUILD)['11111111111111111'], undefined);
});

test('Rollenpanel posten: geprüfte Rollen, Buttons mit role:<id>', async () => {
  const post = (payload) => bridge.handle(guild, request('action', 'role-panel-post', payload));
  await assert.rejects(post({ channelId: '500', title: '', roleIds: [ROLE] }), /Überschrift/);
  await assert.rejects(post({ channelId: '404', title: 'Rollen', roleIds: [ROLE] }), /Textkanal/);
  await assert.rejects(post({ channelId: '500', title: 'Rollen', roleIds: [] }), /mindestens eine Rolle/);
  await assert.rejects(post({ channelId: '500', title: 'Rollen', roleIds: ['222222222222222222'] }), /kann ich nicht vergeben/);
  await assert.rejects(post({ channelId: '500', title: 'Rollen', roleIds: ['333333333333333333'] }), /gibt es nicht mehr/);
  const result = await post({ channelId: '500', title: 'Rollen', description: '', roleIds: [ROLE, ROLE] });
  assert.equal(result.messageId, '900');
  const buttons = sent.at(-1).components[0].toJSON().components;
  assert.deepEqual(buttons.map((b) => b.custom_id), [`role:${ROLE}`]);
});

test('Aktionen brauchen ein Mitglied des Servers, unbekannte Anfragen werden abgelehnt', async () => {
  await assert.rejects(bridge.handle(guild, request('action', 'ticket-panels-refresh', {}, '99')), /nicht auf dem Discord-Server/);
  await assert.rejects(bridge.handle(guild, request('action', 'gibt-es-nicht')), /kennt der Bot nicht/);
  await assert.rejects(bridge.handle(guild, request('live', 'gibt-es-nicht')), /kennt der Bot nicht/);
});
