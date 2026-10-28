// Tests für den Rang-Aufstieg: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'enrp-careers-'));
const { Collection } = require('discord.js');
const settings = require('../src/lib/settings');
const db = require('../src/lib/db');
const activity = require('../src/lib/activity');
const careers = require('../src/lib/careers');

function fakeMember(id, roleIds) {
  const roles = new Collection(roleIds.map((r) => [r, {}]));
  return {
    id,
    user: { id, bot: false, username: `user${id}` },
    roles: { cache: roles, add: async (r) => roles.set(r, {}), remove: async (r) => roles.delete(r) },
    displayAvatarURL: () => '',
    send: async () => {},
  };
}
function fakeGuild(id, members) {
  return {
    id,
    members: { cache: new Collection(members.map((m) => [m.id, m])), fetch: async () => null },
    roles: { cache: new Collection() },
    channels: { cache: new Collection(), fetch: async () => null },
  };
}
function setup(guildId, track, extra = {}) {
  settings.set(guildId, 'team.enabled', true);
  settings.set(guildId, 'team.careers', { ...settings.forGuild(guildId).team.careers, enabled: true, tracks: [track], ...extra });
}
const TRACK = { id: 'sup', name: 'Support', baseRole: 'base', mode: 'auto', approvalChannel: '', approverRoles: [], stages: [{ role: 'junior', minDays: 0, tickets: 2, modActions: 0 }, { role: 'senior', minDays: 0, tickets: 3, modActions: 1 }] };

test('Automatisch befördern, sobald die Voraussetzungen erfüllt sind – gezählt ab dem Rangwechsel', async () => {
  const member = fakeMember('1', ['base']);
  const guild = fakeGuild('7000000000000000001', [member]);
  setup(guild.id, TRACK);
  activity.record(guild.id, '1', 'ticket', Date.now() - 1000); // vor dem ersten Erfassen → zählt nicht
  assert.deepEqual(await careers.checkGuild(guild), { promoted: 0, suggested: 0 });
  activity.record(guild.id, '1', 'ticket');
  assert.equal((await careers.checkGuild(guild)).promoted, 0, 'erst 1 von 2 Tickets');
  activity.record(guild.id, '1', 'ticket');
  assert.equal((await careers.checkGuild(guild)).promoted, 1);
  assert.ok(member.roles.cache.has('junior'));
  // Nächste Stufe zählt ab der Beförderung neu.
  assert.equal((await careers.checkGuild(guild)).promoted, 0);
  for (let i = 0; i < 3; i++) activity.record(guild.id, '1', 'ticket', Date.now() + 10);
  activity.record(guild.id, '1', 'mod', Date.now() + 10);
  assert.equal((await careers.checkGuild(guild)).promoted, 1);
  assert.ok(member.roles.cache.has('senior') && !member.roles.cache.has('junior') && member.roles.cache.has('base'));
  assert.equal(careers.historyOf(guild.id)[0].mode, 'auto');
});

test('Vorhandene Daten mitzählen und Abwesende auslassen', async () => {
  const member = fakeMember('2', ['base']);
  const away = fakeMember('3', ['base']);
  const guild = fakeGuild('7000000000000000002', [member, away]);
  setup(guild.id, TRACK, { countExisting: true });
  for (const id of ['2', '3']) for (let i = 0; i < 2; i++) activity.record(guild.id, id, 'ticket', Date.now() - 86_400_000);
  require('../src/lib/team').absencesOf(guild.id)['3'] = { from: Date.now(), until: Date.now() + 86_400_000, reason: '' };
  assert.equal((await careers.checkGuild(guild)).promoted, 1);
  assert.ok(member.roles.cache.has('junior'));
  assert.ok(!away.roles.cache.has('junior'), 'Abwesende werden nicht befördert');
});

test('Freigabe-Modus schlägt nur einmal vor und befördert nicht ohne Freigabe', async () => {
  const member = fakeMember('4', ['base']);
  const guild = fakeGuild('7000000000000000003', [member]);
  const sent = [];
  guild.channels.cache.set('99', { isTextBased: () => true, send: async (p) => (sent.push(p), { id: 'm1' }) });
  setup(guild.id, { ...TRACK, mode: 'approval', approvalChannel: '99' }, { countExisting: true });
  activity.record(guild.id, '4', 'ticket', 1);
  activity.record(guild.id, '4', 'ticket', 2);
  assert.equal((await careers.checkGuild(guild)).suggested, 1);
  assert.equal((await careers.checkGuild(guild)).suggested, 0, 'kein zweiter Vorschlag, solange einer offen ist');
  assert.equal(sent.length, 1);
  assert.ok(!member.roles.cache.has('junior'), 'ohne Freigabe keine Beförderung');
  assert.match(sent[0].components[0].components[0].data.custom_id, /^career:ok:sup:4$/);
});

test('Manueller Rangwechsel setzt die Zählung zurück', async () => {
  const member = fakeMember('5', ['base']);
  const guild = fakeGuild('7000000000000000004', [member]);
  setup(guild.id, TRACK, { countExisting: true });
  activity.record(guild.id, '5', 'ticket', 1);
  await careers.checkGuild(guild); // erfasst, 1/2 Tickets
  member.roles.cache.set('junior', {}); // von Hand befördert
  activity.record(guild.id, '5', 'ticket');
  activity.record(guild.id, '5', 'ticket');
  assert.equal((await careers.checkGuild(guild)).promoted, 0, 'Zählung beginnt nach dem manuellen Wechsel neu');
});

test.after(() => {
  db.flush();
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
});
