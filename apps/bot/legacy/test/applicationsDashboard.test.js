// Tests für Bewerbungen im Dashboard: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'enrp-appdash-'));
const { Collection } = require('discord.js');
const settings = require('../src/lib/settings');
const store = require('../src/lib/applications/store');
const dash = require('../src/lib/applications/dashboard');

const GUILD = '7001';
const sent = [];
const fakeUser = (id) => ({ id, tag: `user${id}`, username: `user${id}`, toString: () => `<@${id}>`, send: async (m) => sent.push({ to: id, m }) });
const guild = {
  id: GUILD,
  name: 'Test',
  client: { users: { fetch: async (id) => fakeUser(id) } },
  members: { cache: new Collection([['10', { user: fakeUser('10') }]]), fetch: async () => null },
  channels: { cache: new Collection(), fetch: async () => null },
};
const member = { id: '10', user: fakeUser('10') };

function newRecord(typeId, userId = '20') {
  const type = store.typeById(GUILD, typeId);
  return store.createRecord(GUILD, type, { userId, userTag: `user${userId}`, answers: [{ question: 'Frage', answer: 'Antwort' }], durationMs: 60_000 });
}

test('Liste enthält offene Bewerbungen mit Namen und Prüfschritten', () => {
  const r = newRecord('polizei');
  const { records, status } = dash.list(guild);
  const found = records.find((x) => x.number === r.number);
  assert.equal(found.userName, 'user20');
  assert.deepEqual(found.transitions, ['SCREENING', 'REJECTED', 'WITHDRAWN']);
  assert.equal(status.SUBMITTED, 'Eingereicht');
});

test('Annehmen mit Grund, zweite Entscheidung scheitert, eigene Bewerbung nicht', async () => {
  const r = newRecord('sek');
  await dash.decide(guild, { number: r.number, action: 'accept', reason: '  Gut gemacht ' }, member);
  assert.equal(r.status, 'ACCEPTED');
  assert.equal(r.reason, 'Gut gemacht');
  assert.equal(r.decidedBy, '10');
  assert.ok(sent.some((s) => s.to === '20'), 'DM an Bewerber');
  await assert.rejects(dash.decide(guild, { number: r.number, action: 'reject' }, member), /bereits entschieden/);

  const own = newRecord('sek', '10');
  await assert.rejects(dash.decide(guild, { number: own.number, action: 'accept' }, member), /eigene Bewerbung/);
  await assert.rejects(dash.decide(guild, { number: 'X-9999', action: 'accept' }, member), /gibt es nicht/);
});

test('Prüfschritte nur in erlaubter Reihenfolge', async () => {
  const r = newRecord('polizei', '21');
  await assert.rejects(dash.changeStatus(guild, { number: r.number, status: 'INTERVIEW' }, member), /geht es nicht/);
  await dash.changeStatus(guild, { number: r.number, status: 'SCREENING' }, member);
  assert.equal(r.status, 'SCREENING');
});

test('Notizen, Löschen', async () => {
  const r = newRecord('sek', '22');
  dash.addNote(guild, { number: r.number, text: 'ruft morgen an' }, member);
  assert.throws(() => dash.addNote(guild, { number: r.number, text: '   ' }, member), /leer/);
  assert.equal(dash.list(guild).records.find((x) => x.number === r.number).notes[0].byName, 'user10');
  await dash.remove(guild, { number: r.number }, member);
  assert.equal(store.getRecord(GUILD, r.number), null);
});

test('Sperren anlegen und aufheben', async () => {
  const ban = await dash.addBan(guild, { discordId: '123456789012345678', reason: 'Spam', days: 7 }, member);
  assert.ok(store.activeBan(GUILD, 'sek', { discordId: '123456789012345678' }));
  await assert.rejects(dash.addBan(guild, { discordId: 'abc', reason: 'x' }, member), /Discord-ID/);
  await assert.rejects(dash.addBan(guild, { discordId: '123456789012345678', reason: '' }, member), /Grund/);
  await dash.liftBan(guild, { id: ban.id }, member);
  assert.equal(store.activeBan(GUILD, 'sek', { discordId: '123456789012345678' }), null);
  assert.equal(dash.bans(guild).find((b) => b.id === ban.id).active, false);
});

test('Statistik', () => {
  const s = dash.stats(guild);
  assert.ok(s.periods[30].current.count >= 4);
  assert.equal(s.perDay.length, 90);
  assert.equal(s.heatmap.length, 7);
  assert.equal(s.topReviewers[0].id, '10');
});

test('Einstellungen werden vor dem Speichern geprüft', () => {
  const types = structuredClone(settings.forGuild(GUILD).applications.types);
  const check = (changes) => dash.checkConfig(settings.preview(GUILD, changes).config);
  assert.equal(check([{ path: 'applications.types', value: types }]), null);
  assert.match(check([{ path: 'applications.types', value: [] }]), /Mindestens eine/);
  assert.match(check([{ path: 'applications.types', value: [types[0], types[0]] }]), /eindeutig/);
  const noQuestions = structuredClone(types);
  noQuestions[1].questions = [];
  assert.match(check([{ path: 'applications.types', value: noQuestions }]), /keine Fragen/);
  const badPrefix = structuredClone(types);
  badPrefix[0].numberPrefix = 'zu-lang!';
  assert.match(check([{ path: 'applications.types', value: badPrefix }]), /Kürzel/);
  assert.equal(check([{ path: 'applications.panels.apply.title', value: 'Neu' }]), null);
});
