// Prüft Konfiguration und Befehle ohne Discord-Login: npm run check
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Eigene Test-Datenbank: Die Prüfung darf data/db.json (z. B. auf dem Bot-Hoster) nie verändern.
const TEST_DB = path.join(os.tmpdir(), `enrp-check-${process.pid}.json`);
process.env.ENRP_DB_FILE = TEST_DB;
process.on('exit', () => fs.rmSync(TEST_DB, { force: true }));
const { InteractionContextType } = require('discord.js');

let failed = false;
const fail = (msg) => {
  failed = true;
  console.error(`❌ ${msg}`);
};

const settings = require('../src/lib/settings');
const config = settings.base;
for (const t of config.tickets.types) {
  if (!t.id || !t.label || !t.emoji || !t.description) fail(`Ticket-Kategorie unvollständig: ${JSON.stringify(t)}`);
}
if (new Set(config.tickets.types.map((t) => t.id)).size !== config.tickets.types.length) fail('Doppelte Ticket-Kategorie-IDs');
const { validateType } = require('../src/lib/applications/forms');
for (const problem of config.applications.types.flatMap(validateType)) fail(`Bewerbung: ${problem}`);

const names = new Set();
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.js')) {
      try {
        const cmd = require(full);
        cmd.data.setContexts(InteractionContextType.Guild);
        const json = cmd.data.toJSON();
        if (names.has(json.name)) fail(`Doppelter Befehl /${json.name}`);
        names.add(json.name);
      } catch (err) {
        fail(`${path.relative(process.cwd(), full)}: ${err.message}`);
      }
    }
  }
}
walk(path.join(__dirname, '..', 'src', 'commands'));
console.log(`✅ ${names.size} Befehle: ${[...names].map((n) => `/${n}`).join(' ')}`);

for (const file of fs.readdirSync(path.join(__dirname, '..', 'src', 'events'))) require(`../src/events/${file}`);

// Ticket-Panel mit Beispiel-Server bauen (2 offene Tickets in der ersten Kategorie)
const { bucket } = require('../src/lib/db');
const { buildPanel } = require('../src/lib/tickets');
const fakeGuild = { id: 'check', channels: { cache: new Map([['c1', {}], ['c2', {}]]) } };
Object.assign(bucket('tickets', 'check'), { c1: { type: config.tickets.types[0].id }, c2: { type: config.tickets.types[0].id } });
try {
  const panel = buildPanel(fakeGuild);
  const json = panel.components.map((c) => c.toJSON());
  if (process.argv.includes('--panel')) console.log(JSON.stringify(json, null, 2));
  console.log('✅ Ticket-Panel lässt sich bauen');
} catch (err) {
  fail(`Ticket-Panel: ${err.message}`);
}

// Öffnungszeiten mit festen Zeitpunkten testen
const hours = {
  enabled: true,
  timezone: 'Europe/Berlin',
  periods: [
    { days: ['mo', 'di', 'mi', 'do', 'fr'], from: '15:00', to: '23:00' },
    { days: ['sa'], from: '20:00', to: '02:00' },
  ],
};
const { isOpen, nextOpening } = require('../src/lib/openingHours');
const cases = [
  ['2026-10-26T14:30:00Z', true], // Mo 15:30 Berlin (Winterzeit)
  ['2026-10-26T13:30:00Z', false], // Mo 14:30
  ['2026-07-06T13:30:00Z', true], // Mo 15:30 Berlin (Sommerzeit)
  ['2026-10-31T23:30:00Z', true], // So 00:30 – Samstagsschicht über Mitternacht
  ['2026-11-01T02:30:00Z', false], // So 03:30
];
for (const [iso, expected] of cases) {
  if (isOpen(hours, new Date(iso)) !== expected) fail(`Öffnungszeiten: ${iso} sollte ${expected ? 'offen' : 'geschlossen'} sein`);
}
const next = nextOpening(hours, new Date('2026-10-26T13:30:00Z'));
if (next?.toISOString() !== '2026-10-26T14:00:00.000Z') fail(`nextOpening falsch: ${next?.toISOString()}`);
console.log('✅ Öffnungszeiten-Logik');

// Einstellungen in Discord: je Server setzen, lesen, zurücksetzen
const firstType = config.tickets.types[0].id;
const [a, b] = ['111', '222'];
const before = { cap: config.tickets.types[0].capacity, log: config.channels.ticketLog };
settings.set(a, `tickets.types.${firstType}.capacity`, 99);
settings.set(a, 'channels.ticketLog', '123');
settings.set(a, 'leveling.roleRewards.7', '456');
settings.set(a, `applications.types.${config.applications.types[0].id}.enabled`, false);
const ca = settings.forGuild(a);
if (ca.tickets.types[0].capacity !== 99 || ca.channels.ticketLog !== '123' || ca.leveling.roleRewards[7] !== '456') {
  fail('Einstellungen werden nicht übernommen');
}
const cb = settings.forGuild(b);
if (cb.tickets.types[0].capacity !== before.cap || cb.channels.ticketLog !== before.log || '7' in cb.leveling.roleRewards) {
  fail('Einstellungen eines Servers wirken sich auf einen anderen Server aus');
}
const appStore = require('../src/lib/applications/store');
if (appStore.typeById(a, config.applications.types[0].id).enabled || !appStore.typeById(b, config.applications.types[0].id).enabled) {
  fail('Bewerbungsarten sind nicht je Server getrennt');
}
if (config.tickets.types[0].capacity !== before.cap || config.channels.ticketLog !== before.log) fail('Vorlage config.json wurde verändert');
settings.reset(a);
const reset = settings.forGuild(a);
if (reset.tickets.types[0].capacity !== before.cap || reset.channels.ticketLog !== before.log || '7' in reset.leveling.roleRewards) {
  fail('Einstellungen lassen sich nicht zurücksetzen');
}
console.log('✅ Einstellungen je Server setzen/zurücksetzen');

// ---------- Spiel-Anbindung (Bridge, Banns, Rechte, Befehle, CAD, BOLO) – alles offline ----------
async function checkGame() {
  Object.assign(process.env, {
    ROBLOX_UNIVERSE_ID: '999',
    ROBLOX_API_KEY: 'test-key',
    ROBLOX_MAIN_GUILD_IDS: '100, 101',
    ENRP_SECRET: 'x'.repeat(40),
    BRIDGE_SECRET: 'b'.repeat(43),
  });
  delete process.env.PUBLIC_URL;
  const cloud = require('../src/lib/roblox/openCloud');
  const links = require('../src/lib/roblox/links');
  const rights = require('../src/lib/roblox/rights');
  const secrets = require('../src/lib/secrets');
  const auth = require('../src/lib/web/auth');
  const protocol = require('../src/lib/game/protocol');
  const live = require('../src/lib/game/live');
  const events = require('../src/lib/game/events');
  const outbox = require('../src/lib/game/outbox');
  const bans = require('../src/lib/game/bans');
  const commands = require('../src/lib/game/commands');
  const permissions = require('../src/lib/game/permissions');
  const cad = require('../src/lib/game/cad');
  const bolo = require('../src/lib/game/bolo');
  const web = require('../src/lib/web/server');
  const expectError = async (label, fn) => {
    try {
      await fn();
    } catch {
      return;
    }
    fail(label);
  };

  // Dauer
  for (const [input, expected] of [['30m', 1800], ['12h', 43_200], ['7d', 604_800], ['2w', 1_209_600], ['perm', null], ['Dauerhaft', null]]) {
    if (cloud.parseDuration(input) !== expected) fail(`Dauer „${input}“ sollte ${expected} Sekunden sein`);
  }
  for (const bad of ['', 'abc', '0m', '5x']) await expectError(`Dauer „${bad}“ sollte ungültig sein`, () => cloud.parseDuration(bad));
  if (cloud.formatDuration(604_800) !== '1 Woche(n)' || cloud.formatDuration(null) !== 'dauerhaft') fail('formatDuration falsch');

  // Bereiche der Discords
  if (links.scopeOf('100').type !== 'main' || links.scopeOf('101').type !== 'main') fail('Haupt-Discords aus ROBLOX_MAIN_GUILD_IDS werden nicht erkannt');
  if (links.scopeOf('200').type !== 'none') fail('Unverknüpfter Discord darf keine Rechte im Spiel haben');
  links.linkPrivateServer('300', { ownerId: '5', ownerName: 'Besitzer', name: 'Nord', linkedBy: '1' });
  if (links.scopeOf('300').ownerId !== '5') fail('Privatserver-Verknüpfung wird nicht übernommen');
  await expectError('Ein Besitzer darf nur mit einem Discord verknüpft sein', () => links.linkPrivateServer('301', { ownerId: '5', ownerName: 'B', name: 'X', linkedBy: '1' }));
  await expectError('Ein Haupt-Discord darf nicht auf einen Privatserver beschränkt werden', () => links.linkPrivateServer('100', { ownerId: '6', ownerName: 'X', name: 'X', linkedBy: '1' }));
  links.setAccount('u1', { id: '77', name: 'Spieler' });
  links.setAccount('u2', { id: '77', name: 'Spieler' });
  if (links.getAccount('u1') || links.discordIdForRoblox('77') !== 'u2') fail('Ein Roblox-Konto darf nur zu einem Discord-Nutzer gehören');
  links.removeAccount('u2');

  // Verschlüsselte Geheimnisse
  secrets.setSecret('test', 'geheim-123');
  const stored = JSON.stringify(require('../src/lib/db').data.secrets.test);
  if (stored.includes('geheim-123')) fail('Geheimnis wird im Klartext gespeichert');
  if (secrets.decrypt(require('../src/lib/db').data.secrets.test.value) !== 'geheim-123') fail('Geheimnis lässt sich nicht entschlüsseln');
  const realSecret = process.env.ENRP_SECRET;
  process.env.ENRP_SECRET = 'y'.repeat(40);
  if (secrets.decrypt(require('../src/lib/db').data.secrets.test.value) !== null) fail('Falscher ENRP_SECRET darf nichts entschlüsseln');
  process.env.ENRP_SECRET = realSecret;
  secrets.deleteSecret('test');

  // Signatur (HMAC), Zeitstempel, Nonce/Replay
  const now = Date.now();
  const signed = (overrides = {}) => {
    const parts = { timestamp: String(Math.floor(now / 1000)), nonce: crypto.randomUUID(), method: 'POST', path: '/bridge/v1/events', body: '{"events":[]}', ...overrides };
    const headers = { 'x-enrp-timestamp': parts.timestamp, 'x-enrp-nonce': parts.nonce, 'x-enrp-signature': auth.sign(process.env.BRIDGE_SECRET, parts) };
    return { parts, request: { headers, method: parts.method, path: parts.path, body: parts.body } };
  };
  const ok1 = signed();
  if (auth.verify(ok1.request, now) !== null) fail('Gültige Signatur wird abgelehnt');
  if (auth.verify(ok1.request, now) === null) fail('Replay (gleiche Nonce) wird nicht erkannt');
  const tampered = signed();
  if (auth.verify({ ...tampered.request, body: '{"events":[1]}' }, now) === null) fail('Veränderter Body wird nicht erkannt');
  const otherPath = signed();
  if (auth.verify({ ...otherPath.request, path: '/bridge/v1/live' }, now) === null) fail('Veränderter Pfad wird nicht erkannt');
  const old = signed({ timestamp: String(Math.floor(now / 1000) - 600) });
  if (auth.verify(old.request, now) === null) fail('Alter Zeitstempel (10 Min.) wird nicht abgelehnt');
  if (auth.verify({ headers: {}, method: 'GET', path: '/x', body: '' }, now) === null) fail('Fehlende Header werden nicht abgelehnt');

  // Protokoll: Prüfung der Daten aus dem Spiel
  if (!protocol.parseEvent({ v: 1, id: 'abcdefgh-1', type: 'call', at: Math.floor(now / 1000) + 3600 }).error) fail('Zeitstempel in der Zukunft wird nicht abgelehnt');
  if (!protocol.parseEvent({ v: 1, id: 'abcdefgh-1', type: 'hack', at: Math.floor(now / 1000) }).error) fail('Unbekannter Ereignis-Typ wird nicht abgelehnt');
  if (protocol.parseSnapshot({ v: 1, job: 'x', players: [{ id: 'abc' }] }).players.length !== 0) fail('Ungültige Spieler im Snapshot werden nicht verworfen');

  // Webserver Ende-zu-Ende: echter HTTP-Server, signierte Anfragen wie vom Spiel
  const port = 38_000 + Math.floor(Math.random() * 1000);
  process.env.WEB_PORT = String(port);
  const fakeClient = { guilds: { cache: new Map() }, user: null };
  events.start(fakeClient);
  const server = web.start();
  await new Promise((resolve) => server.once('listening', resolve));
  const call = async (method, path, bodyObject, { secret = process.env.BRIDGE_SECRET } = {}) => {
    const body = bodyObject === undefined ? '' : JSON.stringify(bodyObject);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = crypto.randomUUID();
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: {
        'X-ENRP-Timestamp': timestamp,
        'X-ENRP-Nonce': nonce,
        'X-ENRP-Signature': auth.sign(secret, { timestamp, nonce, method, path, body }),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body || undefined,
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  try {
    const health = await fetch(`http://127.0.0.1:${port}/health`).then((r) => r.json());
    if (health.service !== 'enrp-bridge') fail('/health antwortet falsch');
    if ((await call('GET', '/bridge/v1/bans', undefined, { secret: 'f'.repeat(43) })).status !== 401) fail('Falscher Bridge-Schlüssel wird nicht abgelehnt');

    const nowS = Math.floor(Date.now() / 1000);
    const snapshot = {
      v: 1,
      job: 'job-public-1',
      owner: 0,
      max: 30,
      at: nowS,
      ver: 12,
      teams: ['Polizei', 'Zivilisten'],
      players: [
        { id: 77, n: 'Spieler', d: 'Spieli', t: 'Zivilisten', w: 2 },
        { id: 88, n: 'Officer', d: 'Off', t: 'Polizei', s: 'Admin' },
      ],
      vehicles: [{ m: 'Streifenwagen', o: 88, on: 'Officer', p: 'EN-A1234', c: 'Blau', h: '#0000ff' }],
    };
    if ((await call('POST', '/bridge/v1/live', snapshot)).status !== 200) fail('Live-Snapshot wird nicht angenommen');
    const privateSnapshot = { ...snapshot, job: 'job-private-5', owner: 5, ps: true, players: [{ id: 99, n: 'Privat', d: 'P', t: 'Polizei' }], vehicles: [] };
    await call('POST', '/bridge/v1/live', privateSnapshot);
    if (live.serversFor({ type: 'main' }).length !== 2) fail('Haupt-Discord sieht nicht alle Server');
    if (live.serversFor({ type: 'private', ownerId: '5' }).length !== 1) fail('Privatserver-Discord sieht fremde Server');
    if (live.findPlayers({ type: 'private', ownerId: '5' }, 'Spieler').length) fail('Privatserver-Discord findet Spieler fremder Server');
    if (live.findVehicles({ type: 'main' }, { plate: 'en a1234' }).length !== 1) fail('Kennzeichen-Suche findet das Fahrzeug nicht');

    const ev = (type, extra = {}) => ({ v: 1, id: crypto.randomUUID(), type, at: nowS, job: 'job-public-1', owner: 0, u: 77, n: 'Spieler', ...extra });
    const joinEvent = ev('join');
    const first = await call('POST', '/bridge/v1/events', { events: [joinEvent, ev('call', { num: 1, team: 'Polizei', text: 'Überfall', x: 10, z: 20 }), { v: 1, id: 'x', type: 'join' }] });
    if (first.json?.accepted !== 2 || first.json?.rejected !== 1) fail(`Ereignisse falsch angenommen: ${JSON.stringify(first.json)}`);
    const again = await call('POST', '/bridge/v1/events', { events: [joinEvent] });
    if (again.json?.duplicates !== 1) fail('Doppeltes Ereignis wird nicht erkannt');
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (!events.historyFor({ type: 'main' }, { userId: '77' }).length) fail('Ereignisse landen nicht in der Historie');

    // Befehle: Ziel ist der Server, auf dem der Spieler ist; das Spiel holt sie per /sync ab
    const firstSync = (await call('GET', '/bridge/v1/sync?job=job-public-1&owner=0&cursor=-1&boot=')).json;
    if (!firstSync?.boot || firstSync.commands.length !== 0 || !firstSync.config) fail('Erster Sync muss Zähler/Konfiguration liefern, aber keine alten Befehle');
    const prepared = commands.prepare({ type: 'main' }, 'jail', { spieler: 'spieler', minuten: 5, grund: 'Raub' });
    if (prepared.target?.job !== 'job-public-1' || prepared.data.minutes !== 5) fail('Befehl wird falsch vorbereitet');
    await expectError('Unbekanntes Team muss abgelehnt werden', () => commands.prepare({ type: 'main' }, 'team', { spieler: 'Spieler', team: 'Mafia' }));
    await expectError('Offline-Spieler muss abgelehnt werden', () => commands.prepare({ type: 'main' }, 'heal', { spieler: 'Niemand' }));
    await expectError('Privatserver-Discord darf keine Spieler fremder Server erreichen', () => commands.prepare({ type: 'private', ownerId: '5' }, 'kick', { spieler: 'Spieler' }));
    const parsed = commands.parseFreeCommand(':jail Spieler 10 bewaffneter Raub');
    if (parsed.name !== 'jail' || parsed.params.minuten !== 10 || parsed.params.grund !== 'bewaffneter Raub') fail('Freier Befehl wird falsch gelesen');
    await expectError('Unbekannter freier Befehl muss abgelehnt werden', () => commands.parseFreeCommand(':nuke alle'));

    const fakeGuild = { id: '100', name: 'Haupt', client: fakeClient, channels: { cache: new Map(), fetch: async () => null } };
    const execution = commands.execute(fakeGuild, 'staff1', { type: 'main' }, 'jail', prepared);
    const pulled = (await call('GET', `/bridge/v1/sync?job=job-public-1&owner=0&cursor=${firstSync.cursor}&boot=${firstSync.boot}`)).json;
    const jail = pulled.commands.find((c) => c.action === 'jail');
    if (!jail || jail.userId !== '77' || jail.minutes !== 5) fail(`Befehl kommt nicht beim Spielserver an: ${JSON.stringify(pulled.commands)}`);
    const otherServer = (await call('GET', `/bridge/v1/sync?job=job-private-5&owner=5&cursor=${firstSync.cursor}&boot=${firstSync.boot}`)).json;
    if (otherServer.commands.some((c) => c.action === 'jail')) fail('Spieler-Befehl geht an den falschen Server');
    await call('POST', '/bridge/v1/events', { events: [ev('ack', { cmd: jail.cmd, ok: true, msg: 'Für 5 Minuten im Gefängnis.' })] });
    const result = await execution;
    if (!result.ok || !result.text.includes('Gefängnis')) fail(`Bestätigung aus dem Spiel kommt nicht an: ${result.text}`);
    if (commands.findHistory('100', { command: 'jail' })[0]?.status !== 'ok') fail('Befehls-Historie fehlt');

    // Banns: im Bot gespeichert, global zusätzlich Roblox-Ban-API (gestellt)
    const robloxCalls = [];
    const realFetch = global.fetch;
    global.fetch = async (url, options = {}) => {
      if (String(url).startsWith('https://apis.roblox.com')) {
        robloxCalls.push({ url: String(url), method: options.method, body: JSON.parse(options.body ?? 'null') });
        return new Response('{}', { status: 200 });
      }
      return realFetch(url, options);
    };
    try {
      const ban = await bans.add('global', { id: '77', name: 'Spieler' }, { seconds: 3600, reason: 'Cheaten', by: 'test' });
      if (!ban.mirrored || robloxCalls.at(-1)?.body?.gameJoinRestriction?.duration !== '3600s') fail('Globaler Bann wird nicht an die Roblox-Ban-API gespiegelt');
      await bans.add('owner:5', { id: '66', name: 'Troll' }, { seconds: null, reason: 'Trollen', by: 'test' });
      const forPrivate = (await call('GET', '/bridge/v1/bans?owner=5')).json;
      const forPublic = (await call('GET', '/bridge/v1/bans?owner=0')).json;
      if (!forPrivate.bans['77'] || !forPrivate.bans['66'] || forPublic.bans['66'] || !forPublic.bans['77']) fail('Bannliste je Server falsch');
      const player = (await call('GET', '/bridge/v1/player?id=66&owner=5')).json;
      if (player.ban?.r !== 'Trollen') fail('Bann-Prüfung beim Beitreten falsch');
      await bans.remove('global', '77');
      if (bans.get('global', '77') || robloxCalls.at(-1)?.body?.gameJoinRestriction?.active !== false) fail('Unbann funktioniert nicht');
    } finally {
      global.fetch = realFetch;
    }

    // Spielrechte (nur Privatserver): Rolle → Recht, live ans Spiel, Rolle weg → Recht weg
    settings.set('300', 'roblox.rightRoles.polizei', 'rolePol');
    const memberRoles = new Set(['rolePol']);
    const fakeMember = { id: 'd1', roles: { cache: { has: (id) => memberRoles.has(id), some: (fn) => [...memberRoles].some((id) => fn({ id })) } } };
    const privateGuild = { id: '300', name: 'Nord', members: { fetch: async (id) => (id ? fakeMember : new Map([['d1', fakeMember]])) } };
    links.setAccount('d1', { id: '99', name: 'Privat' });
    const before = outbox.pull({ job: 'job-private-5', ownerId: '5', cursor: -1, boot: '' });
    await rights.syncMember(privateGuild, 'd1');
    if (JSON.stringify(rights.getRights('5', '99')) !== '["polizei"]') fail('Spielrecht wird nicht vergeben');
    const pushed = outbox.pull({ job: 'job-private-5', ownerId: '5', cursor: before.cursor, boot: before.boot }).commands.find((c) => c.action === 'rights');
    if (!pushed || pushed.userId !== '99') fail('Spielrecht geht nicht live an den Privatserver');
    if ((await call('GET', '/bridge/v1/player?id=99&owner=5')).json.rights?.[0] !== 'polizei') fail('Spielrechte beim Beitreten fehlen');
    // Teamsperre: Extra-Funktion je Privatserver, Standard aus (wie im Hauptspiel darf jeder in jedes Team)
    if ((await call('GET', '/bridge/v1/player?id=99&owner=5')).json.teamLock !== false) fail('Teamsperre muss standardmäßig aus sein');
    settings.set('300', 'roblox.teamLock', true);
    const lockedSync = (await call('GET', '/bridge/v1/sync?job=job-private-5&owner=5&cursor=-1&boot=')).json;
    const publicSync = (await call('GET', '/bridge/v1/sync?job=job-public-1&owner=0&cursor=-1&boot=')).json;
    if (lockedSync.teamLock !== true || (await call('GET', '/bridge/v1/player?id=99&owner=5')).json.teamLock !== true) fail('Eingeschaltete Teamsperre kommt nicht beim Privatserver an');
    if (publicSync.teamLock !== false) fail('Im Hauptspiel darf es keine Teamsperre geben');
    settings.set('300', 'roblox.teamLock', false);
    memberRoles.clear();
    await rights.syncMember(privateGuild, 'd1');
    if (rights.getRights('5', '99').length) fail('Spielrecht bleibt nach Rollenverlust');
    if ((await rights.syncMember({ ...privateGuild, id: '100' }, 'd1')) !== null) fail('Der Haupt-Discord darf keine Spielrechte vergeben');
  } finally {
    web.stop();
  }

  // Berechtigungen
  const member = (roles, staff = false) => ({ guild: { id: '100' }, roles: { cache: { has: (id) => roles.includes(id) } }, permissions: { has: () => staff } });
  settings.set('100', 'game.permissions.moderation', ['modRole']);
  if (!permissions.can(member(['modRole']), 'moderation') || permissions.can(member(['modRole']), 'admin')) fail('Berechtigungsstufen falsch');
  if (!permissions.can(member([], true), 'admin')) fail('„Server verwalten“ muss Admin sein');
  if (!permissions.can(member([]), 'view') || permissions.can(member([]), 'dispatch')) fail('Standard-Berechtigungen falsch');

  // CAD
  const incident = cad.createIncident('100', { title: 'Raub', location: 'Bank' }, 'u1');
  const guildStub = { id: '100', members: { fetch: async () => null } };
  await cad.assign(guildStub, incident, 'u1', 'u1');
  await cad.setStatus(guildStub, incident, 'vor_ort', 'u1');
  await cad.close(guildStub, incident, 'Täter festgenommen', 'u1');
  if (incident.status !== 'abgeschlossen' || cad.units('100').u1.status !== 'verfuegbar' || cad.stats('100').closed !== 1) fail('CAD-Ablauf falsch');
  if (cad.search('100', 'festgenommen')[0]?.number !== incident.number) fail('CAD-Suche findet den Bericht nicht');
  await expectError('Abgeschlossener Einsatz darf nicht erneut zugewiesen werden', () => cad.assign(guildStub, incident, 'u2', 'u2'));

  // BOLO
  const entry = bolo.create('100', { type: 'fahrzeug', plate: 'en-b 777', reason: 'Fahrerflucht', expiresAt: Date.now() - 1 }, 'u1');
  if (entry.plateKey !== 'ENB777') fail('BOLO-Kennzeichen wird nicht normalisiert');
  bolo.expire('100');
  if (entry.status !== 'abgelaufen') fail('BOLO läuft nicht ab');
  if (bolo.search('100', 'ENB 777')[0]?.id !== entry.id) fail('BOLO-Suche nach Kennzeichen falsch');

  // Spiel-Skript passt zum Bot
  const lua = fs.readFileSync(path.join(__dirname, '..', 'roblox', 'ENRPBridge.server.lua'), 'utf8');
  for (const route of ['/bridge/v1/live', '/bridge/v1/events', '/bridge/v1/sync', '/bridge/v1/bans', '/bridge/v1/player', '/bridge/v1/bye']) {
    if (!lua.includes(`"${route}`)) fail(`Spiel-Skript nutzt ${route} nicht`);
  }
  const actions = new Set([...Object.values(commands.COMMANDS).map((c) => c.action), 'rights', 'refresh']);
  for (const action of actions) if (!lua.includes(`function handlers.${action}(`)) fail(`Spiel-Skript kennt den Befehl „${action}“ nicht`);
  if (!lua.includes('timestamp .. "\\n" .. nonce .. "\\n" .. method .. "\\n" .. path .. "\\n" .. body')) fail('Signatur-Kanon im Spiel-Skript passt nicht zu web/auth.js');
  if (!lua.includes(`local PROTOCOL = ${protocol.VERSION}`)) fail('Protokoll-Version im Spiel-Skript passt nicht');
  if (!lua.includes('if not isPrivateServer or not teamLock or not rightsLoaded[player]') || !lua.includes('setTeamLock(data.teamLock)')) {
    fail('Spiel-Skript: Teamsperre muss vom Bot gesteuert werden (Standard aus, nur Privatserver)');
  }
  for (const type of Object.keys(protocol.EVENT_TYPES)) if (!lua.includes(`"${type}"`)) fail(`Spiel-Skript sendet kein „${type}“-Ereignis`);
  console.log('✅ Spiel-Anbindung (Bridge, Signatur, Banns, Rechte, Befehle, CAD, BOLO)');
}

checkGame()
  .catch((err) => fail(`Spiel-Anbindung: ${err.stack}`))
  .then(() => {
    if (failed) process.exit(1);
    console.log('✅ Alles in Ordnung');
    process.exit(0);
  });
