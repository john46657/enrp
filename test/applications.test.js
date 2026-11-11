const { fakeWorld, fakeUser, fakeMember, fakeChannel, fakeInteraction, textOf } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');

const settings = require('../src/lib/settings');
const db = require('../src/lib/db');
const store = require('../src/lib/applications/store');
const flow = require('../src/lib/applications/flow');
const decisions = require('../src/lib/applications/decide');
const serviceNumbers = require('../src/lib/applications/serviceNumbers');
const typesCommand = require('../src/commands/applications/types');
const { parseLocalDate } = require('../src/lib/time');

// Roblox-Suche ohne Netzwerk
globalThis.fetch = async (url) => ({
  ok: true,
  json: async () => (String(url).includes('usernames') ? { data: [{ id: 4711, name: 'TestRoblox', displayName: 'Test' }] } : { data: [{ imageUrl: 'https://example.com/a.png' }] }),
});

const { client, guild } = fakeWorld();
const teamChannel = fakeChannel(guild, 'bewerbungen');
const MANAGER_ROLE = '900000000000000001';
const ACCEPT_ROLE = '900000000000000002';
const admin = fakeMember(guild, fakeUser('Admin'), { manageGuild: true });
const manager = fakeMember(guild, fakeUser('Manager'), { roles: [MANAGER_ROLE] });

settings.set(guild.id, 'applications.qualiChannel', teamChannel.id);

// Legt eine kleine Bewerbungsart mit zwei Fragen an und gibt ihren Schlüssel zurück.
async function createType(key, extra = {}) {
  const run = (sub, options) => typesCommand.execute(fakeInteraction(guild, admin, { sub, options }));
  await run('erstellen', { schluessel: key, name: `Art ${key}`, emoji: '🚓', ...extra });
  await run('frage-hinzufuegen', { art: key, typ: 'TEXT', frage: 'Warum möchtest du zu uns?', min: 5 });
  await run('frage-hinzufuegen', { art: key, typ: 'CHOICE', frage: 'Wie oft bist du da?', optionen: 'Täglich; Selten' });
  await run('rollen', { art: key, liste: 'managers', aktion: 'add', rolle: { roleId: MANAGER_ROLE } });
  await run('rollen', { art: key, liste: 'acceptAdd', aktion: 'add', rolle: { roleId: ACCEPT_ROLE } });
  return key;
}

// Spielt die DM-Bewerbung bis zum Einreichen durch.
async function applyViaDm(member, typeId) {
  await flow.offer(fakeInteraction(guild, member), typeId);
  await flow.start(fakeInteraction(guild, member, { channelId: `dm-${member.id}` }), guild.id, typeId);
  await flow.handleDirectMessage({ author: member.user, client, content: 'Weil mir Roleplay Spaß macht.', attachments: { size: 0 }, reply: (p) => member.user.send(p) });
  await flow.handleSelect(fakeInteraction(guild, member, { values: ['Täglich'], message: { embeds: [] } }), '1');
  return Object.values(store.recordsOf(guild.id)).find((r) => r.userId === member.id && r.type === typeId && store.isOpenStatus(r.status));
}

test('Bewerbungsart in Discord anlegen und Fragen bearbeiten', async () => {
  const key = await createType('hundestaffel');
  const type = store.typeById(guild.id, key);
  assert.equal(type.questions.length, 2);
  assert.equal(type.questions[0].key, 'warum_moechtest_du_zu_un');
  assert.deepEqual(type.roles.managers, [MANAGER_ROLE]);
  assert.equal(settings.base.applications.types.some((t) => t.id === key), false, 'die Vorlage bleibt unverändert');
  assert.equal(store.typeById('anderer-server', key), undefined, 'andere Server sehen die Art nicht');

  const run = (sub, options) => typesCommand.execute(fakeInteraction(guild, admin, { sub, options }));
  await run('frage-verschieben', { art: key, nummer: 2, position: 1 });
  assert.equal(store.typeById(guild.id, key).questions[0].type, 'CHOICE');
  await run('frage-verschieben', { art: key, nummer: 2, position: 1 });

  const reply = fakeInteraction(guild, admin, { sub: 'frage-hinzufuegen', options: { art: key, typ: 'CHOICE', frage: 'Ohne Optionen' } });
  await typesCommand.execute(reply);
  assert.match(textOf(reply.replies[0]), /optionen/);
  assert.equal(store.typeById(guild.id, key).questions.length, 2);
});

test('Einstellungen überstehen einen Neustart in der richtigen Reihenfolge', async () => {
  const key = await createType('neustart');
  settings.set(guild.id, `applications.types.${key}.enabled`, false);
  // Neustart nachstellen: Einstellungen aus den gespeicherten Änderungen neu aufbauen
  delete require.cache[require.resolve('../src/lib/settings')];
  const fresh = require('../src/lib/settings');
  const type = fresh.forGuild(guild.id).applications.types.find((t) => t.id === key);
  assert.ok(type, 'die neue Art ist noch da');
  assert.equal(type.enabled, false);
  assert.equal(type.questions.length, 2);
  settings.set(guild.id, `applications.types.${key}.enabled`, true);
});

test('DM-Bewerbung, Neustart mittendrin, Annahme mit Dienstnummer', async () => {
  const key = await createType('streife');
  await typesCommand.execute(fakeInteraction(guild, admin, { sub: 'dienstnummer', options: { art: key, aktiv: true, format: 'PD-{n}', stellen: 2, nickname: '[{serviceNumber}] {name}' } }));
  const applicant = fakeMember(guild, fakeUser('Bewerber'));

  await flow.offer(fakeInteraction(guild, applicant), key);
  assert.match(textOf(applicant.user.sent.at(-1)), /2 Fragen/);
  await flow.start(fakeInteraction(guild, applicant, { channelId: 'dm' }), guild.id, key);
  assert.match(textOf(applicant.user.sent.at(-1)), /Frage 1\/2/);
  await flow.handleDirectMessage({ author: applicant.user, client, content: 'kurz', attachments: { size: 0 }, reply: (p) => applicant.user.send(p) });
  assert.match(textOf(applicant.user.sent.at(-1)), /mindestens 5/);
  await flow.handleDirectMessage({ author: applicant.user, client, content: 'Weil mir Roleplay Spaß macht.', attachments: { size: 0 }, reply: (p) => applicant.user.send(p) });

  // Neustart: die Sitzung liegt in der Datenbank und wird fortgesetzt
  assert.equal(db.data.appSessions[applicant.id].step, 1);
  await flow.restore(client);
  assert.match(textOf(applicant.user.sent.at(-2)), /neu gestartet/);
  assert.match(textOf(applicant.user.sent.at(-1)), /Frage 2\/2/);
  assert.equal(Object.values(store.progressOf(guild.id)).some((p) => p.userId === applicant.id), true);

  await flow.handleSelect(fakeInteraction(guild, applicant, { values: ['Täglich'], message: { embeds: [] } }), '1');
  const record = Object.values(store.recordsOf(guild.id)).find((r) => r.userId === applicant.id);
  assert.ok(record, 'Bewerbung wurde angelegt');
  assert.equal(record.status, 'OPEN');
  assert.equal(db.data.appSessions[applicant.id], undefined);
  assert.equal(teamChannel.sent.at(-1).id, record.messageId);

  const type = store.typeById(guild.id, key);
  assert.equal(await decisions.decideAs(guild, record, type, applicant.user, 'ACCEPTED'), 'Über deine eigene Bewerbung kannst du nicht entscheiden.');
  assert.equal(await decisions.decideAs(guild, record, type, manager.user, 'ACCEPTED', 'Gute Antworten'), null);
  assert.equal(record.status, 'ACCEPTED');
  assert.equal(record.serviceNumber, 'PD-01');
  assert.equal(applicant.nickname, '[PD-01] Bewerber');
  assert.ok(applicant.held.has(ACCEPT_ROLE));
  assert.match(textOf(applicant.user.sent.at(-1)), /PD-01/);
  assert.match(textOf(applicant.user.sent.at(-1)), /Gute Antworten/);
  assert.match(await decisions.decideAs(guild, record, type, manager.user, 'REJECTED'), /bereits entschieden/);

  // Zweite Person bekommt die nächste Nummer; nach dem Verlassen wird die erste wieder frei
  const second = fakeMember(guild, fakeUser('Zweiter'));
  const secondRecord = await applyViaDm(second, key);
  await decisions.decideAs(guild, secondRecord, type, manager.user, 'ACCEPTED');
  assert.equal(secondRecord.serviceNumber, 'PD-02');
  await decisions.handleMemberLeave(applicant);
  assert.equal(serviceNumbers.getNumber(guild.id, applicant.id), null);
  assert.equal(serviceNumbers.nextFree(guild.id, type.serviceNumber), 1);
});

test('Bewerbungsphasen: öffnet später, schließt, Plätze begrenzt', async () => {
  const key = await createType('phase');
  const type = () => store.typeById(guild.id, key);
  const person = fakeMember(guild, fakeUser('Phase'));
  const run = (options) => typesCommand.execute(fakeInteraction(guild, admin, { sub: 'phase', options: { art: key, ...options } }));

  settings.set(guild.id, `applications.types.${key}.phase.opensAt`, Date.now() + 3_600_000);
  assert.equal(store.phaseOf(guild.id, type()).state, 'before');
  assert.match(store.eligibility(person, type()), /öffnen/);

  settings.set(guild.id, `applications.types.${key}.phase.opensAt`, Date.now() - 7_200_000);
  settings.set(guild.id, `applications.types.${key}.phase.closesAt`, Date.now() - 3_600_000);
  assert.equal(store.phaseOf(guild.id, type()).state, 'after');
  assert.match(store.eligibility(person, type()), /geschlossen/);

  await run({ schliesst: '-', plaetze: 1 });
  assert.equal(store.phaseOf(guild.id, type()).state, 'open');
  assert.equal(store.eligibility(person, type()), null);
  assert.ok(await applyViaDm(person, key));
  assert.equal(store.phaseOf(guild.id, type()).state, 'full');
  assert.match(store.eligibility(fakeMember(guild, fakeUser('Zu spät')), type()), /alle 1 Plätze/);

  const bad = fakeInteraction(guild, admin, { sub: 'phase', options: { art: key, oeffnet: '01.02.2030 10:00', schliesst: '01.01.2030 10:00' } });
  await typesCommand.execute(bad);
  assert.match(textOf(bad.replies[0]), /nach dem Öffnen/);
  assert.equal(new Date(parseLocalDate('24.12.2026 18:00')).toISOString(), '2026-12-24T17:00:00.000Z');
  assert.equal(new Date(parseLocalDate('01.07.2026 18:00')).toISOString(), '2026-07-01T16:00:00.000Z');
});

test('Geänderte Fragen brechen laufende Bewerbungen sauber ab', async () => {
  const key = await createType('aenderung');
  const person = fakeMember(guild, fakeUser('Mittendrin'));
  await flow.offer(fakeInteraction(guild, person), key);
  await flow.start(fakeInteraction(guild, person, { channelId: 'dm' }), guild.id, key);
  await typesCommand.execute(fakeInteraction(guild, admin, { sub: 'frage-entfernen', options: { art: key, nummer: 1 } }));
  assert.equal(db.data.appSessions[person.id], undefined);
  assert.match(textOf(person.user.sent.at(-1)), /geändert/);
});
