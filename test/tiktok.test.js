// Tests für TikTok LIVE: npm test
// Läuft ohne Discord-Login mit nachgebauten Objekten und einem eigenen Datenordner. Es wird nie ein echter
// Live-Status vorgetäuscht – Live/Offline kommen ausschließlich von einem Test-Provider.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'enrp-test-'));
const { PermissionFlagsBits, ChannelType, Collection } = require('discord.js');
const settings = require('../src/lib/settings');
const db = require('../src/lib/db');
const service = require('../src/lib/tiktok/service');
const { PROVIDERS, STALE_AFTER } = require('../src/lib/tiktok/providers');

let guildCounter = 0;
function fakeGuild() {
  const id = `9${String(++guildCounter).padStart(17, '0')}`;
  settings.set(id, 'tiktok.enabled', true);
  settings.set(id, 'tiktok.channel', '555');
  return { id, channels: { cache: new Collection() } };
}
function fakeNotifier({ fail } = {}) {
  const calls = { live: [], end: [] };
  return {
    calls,
    async live(guild, payload) {
      if (fail) throw new Error(fail);
      calls.live.push(payload);
      return { channelId: '555', messageId: String(calls.live.length) };
    },
    async end(guild, username) {
      calls.end.push(username);
      return { channelId: '555', messageId: 'e' };
    },
  };
}
// Test-Provider: gibt vorgegebene Ergebnisse zurück oder wirft.
const providerReturning = (map) => ({ name: 'test', label: 'Test', status: () => ({ connected: true, detail: '' }), check: async () => new Map(Object.entries(map)) });
const failingProvider = { name: 'test', label: 'Test', status: () => ({ connected: false, detail: '' }), check: async () => Promise.reject(new Error('503 Service Unavailable')) };
const MIN = 60_000;

test('Creator hinzufügen und entfernen', () => {
  const g = fakeGuild();
  assert.equal(service.addCreator(g.id, '@Emden.Creator', '1').username, 'emden.creator');
  assert.throws(() => service.addCreator(g.id, 'emden.creator', '1'), /bereits/);
  assert.equal(service.addCreator(g.id, 'https://www.tiktok.com/@zweiter_creator/live', '1').username, 'zweiter_creator');
  assert.throws(() => service.addCreator(g.id, 'x', '1'), /Ungültiger/);
  assert.throws(() => service.addCreator(g.id, 'name mit leerzeichen', '1'), /Ungültiger/);
  service.removeCreator(g.id, '@emden.creator');
  assert.deepEqual(Object.keys(service.dataOf(g.id).creators), ['zweiter_creator']);
  assert.throws(() => service.removeCreator(g.id, 'emden.creator'), /nicht überwacht/);
});

test('Neue Live-Session wird erkannt und genau einmal angekündigt', async () => {
  const g = fakeGuild();
  service.addCreator(g.id, 'creator', '1');
  const notifier = fakeNotifier();
  const live = providerReturning({ creator: { status: 'live', url: 'https://www.tiktok.com/@creator/live' } });
  const t0 = Date.now();
  assert.deepEqual(await service.pollGuild(g, { provider: live, notifier, now: t0 }), ['live-started']);
  assert.deepEqual(await service.pollGuild(g, { provider: live, notifier, now: t0 + 2 * MIN }), ['still-live']);
  assert.deepEqual(await service.pollGuild(g, { provider: live, notifier, now: t0 + 4 * MIN }), ['still-live']);
  assert.equal(notifier.calls.live.length, 1);
  const session = service.dataOf(g.id).sessions[0];
  assert.equal(session.notified, true);
  assert.equal(session.messageId, '1');
  assert.equal(session.endedAt, null);
});

test('Unbekannter Status und Provider-Ausfall beenden keinen Stream', async () => {
  const g = fakeGuild();
  service.addCreator(g.id, 'creator', '1');
  const notifier = fakeNotifier();
  const t0 = Date.now();
  await service.pollGuild(g, { provider: providerReturning({ creator: { status: 'live' } }), notifier, now: t0 });
  assert.deepEqual(await service.pollGuild(g, { provider: providerReturning({ creator: { status: 'unknown', error: 'Timeout' } }), notifier, now: t0 + MIN }), ['unknown']);
  assert.deepEqual(await service.pollGuild(g, { provider: failingProvider, notifier, now: t0 + 2 * MIN }), ['unknown']);
  const data = service.dataOf(g.id);
  assert.equal(data.creators.creator.status, 'live', 'Status bleibt live');
  assert.equal(data.sessions[0].endedAt, null, 'Session bleibt offen');
  assert.equal(data.provider.failures, 1);
  assert.ok(data.provider.nextCheckAt > t0 + 2 * MIN + MIN, 'Backoff verlängert das Intervall');
  assert.match(data.events[0].message, /503/);
  // Erfolgreiche Prüfung setzt den Fehlerzähler zurück.
  await service.pollGuild(g, { provider: providerReturning({ creator: { status: 'live' } }), notifier, now: t0 + 10 * MIN });
  assert.equal(service.dataOf(g.id).provider.failures, 0);
  assert.equal(notifier.calls.live.length, 1);
});

test('LIVE-Ende erst nach der Toleranzzeit, Endmeldung nur wenn aktiviert', async () => {
  const g = fakeGuild();
  settings.set(g.id, 'tiktok.endGraceMinutes', 10);
  settings.set(g.id, 'tiktok.endMessages', true);
  service.addCreator(g.id, 'creator', '1');
  const notifier = fakeNotifier();
  const live = providerReturning({ creator: { status: 'live' } });
  const offline = providerReturning({ creator: { status: 'offline' } });
  const t0 = Date.now();
  await service.pollGuild(g, { provider: live, notifier, now: t0 });
  assert.deepEqual(await service.pollGuild(g, { provider: offline, notifier, now: t0 + 2 * MIN }), ['offline-pending']);
  // Kurzer Aussetzer: wieder live innerhalb der Toleranz → keine neue Ankündigung, kein Ende.
  assert.deepEqual(await service.pollGuild(g, { provider: live, notifier, now: t0 + 4 * MIN }), ['still-live']);
  assert.deepEqual(await service.pollGuild(g, { provider: offline, notifier, now: t0 + 6 * MIN }), ['offline-pending']);
  assert.deepEqual(await service.pollGuild(g, { provider: offline, notifier, now: t0 + 12 * MIN }), ['offline-pending']);
  assert.deepEqual(await service.pollGuild(g, { provider: offline, notifier, now: t0 + 17 * MIN }), ['live-ended']);
  assert.deepEqual(notifier.calls.end, ['creator']);
  assert.equal(service.dataOf(g.id).sessions[0].endedAt, t0 + 6 * MIN, 'Ende = erster Offline-Zeitpunkt');
  assert.equal(notifier.calls.live.length, 1);

  // Ohne endMessages wird nichts gesendet.
  const g2 = fakeGuild();
  service.addCreator(g2.id, 'creator', '1');
  const n2 = fakeNotifier();
  await service.pollGuild(g2, { provider: live, notifier: n2, now: t0 });
  await service.pollGuild(g2, { provider: offline, notifier: n2, now: t0 + MIN });
  assert.deepEqual(await service.pollGuild(g2, { provider: offline, notifier: n2, now: t0 + 30 * MIN }), ['live-ended']);
  assert.deepEqual(n2.calls.end, []);
});

test('Spam-Schutz: schnelles Neustarten des Streams löst keine zweite Nachricht aus', async () => {
  const g = fakeGuild();
  settings.set(g.id, 'tiktok.endGraceMinutes', 1);
  service.addCreator(g.id, 'creator', '1');
  const notifier = fakeNotifier();
  const t0 = Date.now();
  await service.pollGuild(g, { provider: providerReturning({ creator: { status: 'live' } }), notifier, now: t0 });
  await service.pollGuild(g, { provider: providerReturning({ creator: { status: 'offline' } }), notifier, now: t0 + 1000 });
  await service.pollGuild(g, { provider: providerReturning({ creator: { status: 'offline' } }), notifier, now: t0 + 2 * MIN });
  assert.deepEqual(await service.pollGuild(g, { provider: providerReturning({ creator: { status: 'live' } }), notifier, now: t0 + 3 * MIN }), ['live-suppressed']);
  assert.equal(notifier.calls.live.length, 1);
});

test('Bot-Neustart: gespeicherter Status wird übernommen, keine doppelte Nachricht', async () => {
  const g = fakeGuild();
  service.addCreator(g.id, 'creator', '1');
  const t0 = Date.now();
  await service.pollGuild(g, { provider: providerReturning({ creator: { status: 'live' } }), notifier: fakeNotifier(), now: t0 });
  db.flush();
  // Module neu laden = Neustart; Daten kommen aus der gespeicherten db.json.
  for (const key of Object.keys(require.cache)) if (key.includes(`${path.sep}src${path.sep}`)) delete require.cache[key];
  const fresh = require('../src/lib/tiktok/service');
  const notifier = fakeNotifier();
  assert.equal(fresh.dataOf(g.id).creators.creator.status, 'live');
  assert.deepEqual(await fresh.pollGuild(g, { provider: providerReturning({ creator: { status: 'live' } }), notifier, now: t0 + 5 * MIN }), ['still-live']);
  assert.equal(notifier.calls.live.length, 0);
});

test('Fehlende Discord-Berechtigungen werden als Fehler protokolliert', async () => {
  const g = fakeGuild();
  const channel = { id: '555', type: ChannelType.GuildText, permissionsFor: () => ({ has: (flag) => flag === PermissionFlagsBits.ViewChannel }), send: async () => assert.fail('darf nicht senden') };
  g.channels.cache.set('555', channel);
  g.members = { me: {} };
  service.addCreator(g.id, 'creator', '1');
  const outcome = await service.pollGuild(g, { provider: providerReturning({ creator: { status: 'live' } }), now: Date.now() }); // echter Discord-Notifier
  assert.deepEqual(outcome, ['live-started']);
  const data = service.dataOf(g.id);
  assert.equal(data.sessions[0].notified, false);
  assert.match(data.sessions[0].notifyError, /Nachrichten senden, Links einbetten/);
  assert.equal(data.events[0].level, 'error');
  // Kein Kanal eingestellt
  const g2 = fakeGuild();
  settings.set(g2.id, 'tiktok.channel', '');
  await assert.rejects(service.sendTest(g2, 'tester'), /Kein Benachrichtigungskanal/);
});

test('Rolle wird nur erwähnt, wenn eingestellt – nie @everyone', async () => {
  const g = fakeGuild();
  const sent = [];
  g.channels.cache.set('555', { id: '555', type: ChannelType.GuildText, permissionsFor: () => ({ has: () => true }), send: async (p) => (sent.push(p), { id: 'm1' }) });
  g.members = { me: {} };
  service.addCreator(g.id, 'creator', '1');
  await service.pollGuild(g, { provider: providerReturning({ creator: { status: 'live' } }), now: Date.now() });
  assert.equal(sent[0].content, undefined);
  assert.deepEqual(sent[0].allowedMentions, { parse: [], roles: [] });
  settings.set(g.id, 'tiktok.role', '777');
  await service.sendTest(g, 'tester');
  assert.equal(sent[1].content, undefined, 'Testnachricht erwähnt niemanden');
  assert.match(sent[1].embeds[0].data.footer.text, /Testnachricht – kein echter Livestream/);
  await service.announceManual(g, { url: 'https://www.tiktok.com/@other/live', by: '1', byTag: 'mod' });
  assert.equal(sent[2].content, '<@&777>');
  assert.deepEqual(sent[2].allowedMentions, { parse: [], roles: ['777'] });
  assert.match(sent[2].embeds[0].data.footer.text, /Manuell angekündigt von mod/);
});

test('Manuelle Ankündigung: Links prüfen und Doppelungen begrenzen', async () => {
  for (const bad of ['http://www.tiktok.com/@name/live', 'https://tiktok.com.evil.de/@name', 'https://evil.de/?https://tiktok.com/@a', 'javascript:alert(1)', 'https://www.tiktok.com/', 'kein link', 'https://user:pw@www.tiktok.com/@name']) {
    assert.throws(() => service.parseLiveUrl(bad), Error, bad);
  }
  assert.deepEqual(service.parseLiveUrl('https://www.tiktok.com/@Emden.Network/live#x'), { url: 'https://www.tiktok.com/@Emden.Network/live', username: 'emden.network' });
  assert.equal(service.parseLiveUrl('https://vm.tiktok.com/ZMabc123/').username, null);

  const g = fakeGuild();
  const notifier = fakeNotifier();
  const now = Date.now();
  const session = await service.announceManual(g, { url: 'https://www.tiktok.com/@creator/live', by: '1', byTag: 'mod' }, { notifier, now });
  assert.equal(session.source, 'manual');
  assert.equal(session.by, '1');
  assert.equal(notifier.calls.live[0].manual, true);
  await assert.rejects(service.announceManual(g, { url: 'https://www.tiktok.com/@creator', by: '2', byTag: 'mod2' }, { notifier, now: now + 5 * MIN }), /bereits/);
  await service.announceManual(g, { url: 'https://www.tiktok.com/@creator/live', by: '1', byTag: 'mod' }, { notifier, now: now + service.MANUAL_DUPLICATE + 1 });
  assert.equal(notifier.calls.live.length, 2);
  // Manuelle Ankündigungen setzen keinen automatischen Live-Status.
  assert.equal(service.dataOf(g.id).creators.creator, undefined);
});

test('Webhook-Provider: veraltete Meldungen gelten als unbekannt', async () => {
  const provider = PROVIDERS.webhook;
  provider.reset();
  process.env.TIKTOK_WEBHOOK_SECRET = 'geheim';
  assert.equal(provider.status().connected, false);
  const now = Date.now();
  provider.report({ username: 'creator', status: 'live', url: null }, now);
  assert.equal((await provider.check(['creator'], now + MIN)).get('creator').status, 'live');
  assert.equal((await provider.check(['creator'], now + STALE_AFTER + 1)).get('creator').status, 'unknown');
  assert.equal((await provider.check(['andere'], now)).get('andere').status, 'unknown');
  assert.equal((await PROVIDERS.none.check(['creator'])).get('creator').status, 'unknown');
  assert.equal(PROVIDERS.none.status().connected, false);
});

test('Unberechtigte Slash-Commands werden abgelehnt', async () => {
  // Nach dem Neustart-Test sind die Module neu geladen – hier dieselben Instanzen wie der Befehl verwenden.
  const command = require('../src/commands/social/tiktok');
  const settings = require('../src/lib/settings');
  const service = require('../src/lib/tiktok/service');
  const g = { id: '8000000000000000001', channels: { cache: new Collection() } };
  settings.set(g.id, 'tiktok.enabled', true);
  const replies = [];
  const interaction = (sub, perms = 0n, roles = []) => ({
    guild: g,
    guildId: g.id,
    user: { id: '123', tag: 'user' },
    member: { id: '123', guild: { id: g.id, ownerId: '1' }, permissions: { has: (flag) => (perms & flag) === flag }, roles: { cache: new Collection(roles.map((r) => [r, {}])) } },
    options: { getSubcommand: () => sub, getString: () => 'creator', getChannel: () => ({ id: '1' }), getRole: () => null },
    reply: async (p) => replies.push(p),
    replied: false,
    deferred: false,
  });
  await command.execute(interaction('add'));
  assert.match(replies.at(-1).content, /Nur Admins/);
  await command.execute(interaction('announce'));
  assert.match(replies.at(-1).content, /Berechtigung/);
  assert.equal(Object.keys(service.dataOf(g.id).creators).length, 0);
  // Mit „Server verwalten“ klappt es.
  await command.execute(interaction('add', PermissionFlagsBits.ManageGuild));
  assert.equal(Object.keys(service.dataOf(g.id).creators).length, 1);
  // Freigegebene Rolle darf ankündigen, aber keine Creator verwalten.
  settings.set(g.id, 'tiktok.manualRoles', ['42']);
  await command.execute(interaction('remove', 0n, ['42']));
  assert.match(replies.at(-1).content, /Nur Admins/);
});

test('Dashboard: Eingaben werden serverseitig geprüft', () => {
  const { validateChange } = require('../src/dashboard/server');
  assert.equal(validateChange({ path: 'tiktok.channel', value: '1' }), null);
  assert.match(validateChange({ path: 'applications.channel', value: '1' }), /nicht geändert/);
  assert.match(validateChange({ path: 'tiktok.__proto__.x', value: 1 }), /Ungültiger Pfad/);
  assert.match(validateChange({ path: 'tiktok..x', value: 1 }), /Ungültiger Pfad/);
  assert.match(validateChange({ path: 'tiktok.template.text', value: 'x'.repeat(70_000) }), /zu groß/);
  assert.equal(settings.invalidPath('1', [{ path: 'tiktok.gibtsnicht.x', value: 1 }]), 'tiktok.gibtsnicht.x');
  assert.equal(settings.invalidPath('1', [{ path: 'tiktok.endGraceMinutes', value: 5 }]), null);
  assert.equal(validateChange({ path: 'timezone', value: 'Europe/Vienna' }), null);
  assert.match(validateChange({ path: 'timezone', value: 'Mars/Olympus' }), /Unbekannte Zeitzone/);
  assert.match(validateChange({ path: 'tickets.openingHours.timezone', value: 42 }), /Unbekannte Zeitzone/);
});

test.after(() => {
  db.flush();
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
});
