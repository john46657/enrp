// Prüft Konfiguration und Befehle ohne Discord-Login: npm run check
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

// Roblox: Dauer, Bereiche der Discord-Server und die Anfragen an Roblox (mit gestelltem fetch, es geht nichts raus)
async function checkRoblox() {
  Object.assign(process.env, { ROBLOX_UNIVERSE_ID: '999', ROBLOX_API_KEY: 'test-key', ROBLOX_MAIN_GUILD_IDS: '100, 101' });
  const cloud = require('../src/lib/roblox/openCloud');
  const links = require('../src/lib/roblox/links');
  const rights = require('../src/lib/roblox/rights');
  const expectError = async (label, fn) => {
    try {
      await fn();
    } catch {
      return;
    }
    fail(label);
  };

  for (const [input, expected] of [['30m', 1800], ['12h', 43_200], ['7d', 604_800], ['2w', 1_209_600], ['perm', null], ['Dauerhaft', null]]) {
    if (cloud.parseDuration(input) !== expected) fail(`Dauer „${input}“ sollte ${expected} Sekunden sein`);
  }
  for (const bad of ['', 'abc', '0m', '5x']) await expectError(`Dauer „${bad}“ sollte ungültig sein`, () => cloud.parseDuration(bad));
  if (cloud.formatDuration(604_800) !== '1 Woche(n)' || cloud.formatDuration(null) !== 'dauerhaft') fail('formatDuration falsch');

  // Bereiche: Haupt-Discord aus der .env, Privatserver-Discords per Verknüpfung, sonst nichts
  if (links.scopeOf('100').type !== 'main' || links.scopeOf('101').type !== 'main') fail('Haupt-Discords aus ROBLOX_MAIN_GUILD_IDS werden nicht erkannt');
  if (links.scopeOf('200').type !== 'none') fail('Unverknüpfter Discord darf keine Rechte im Spiel haben');
  links.linkPrivateServer('200', { ownerId: '5', ownerName: 'Besitzer', name: 'Nord', linkedBy: '1' });
  const scope = links.scopeOf('200');
  if (scope.type !== 'private' || scope.ownerId !== '5') fail('Privatserver-Verknüpfung wird nicht übernommen');
  await expectError('Ein Besitzer darf nur mit einem Discord verknüpft sein', () =>
    links.linkPrivateServer('201', { ownerId: '5', ownerName: 'Besitzer', name: 'Doppelt', linkedBy: '1' }),
  );
  await expectError('Ein Haupt-Discord darf nicht auf einen Privatserver beschränkt werden', () =>
    links.linkPrivateServer('100', { ownerId: '6', ownerName: 'X', name: 'X', linkedBy: '1' }),
  );
  links.unlinkPrivateServer('200');
  if (links.scopeOf('200').type !== 'none') fail('Privatserver-Verknüpfung lässt sich nicht entfernen');

  links.setAccount('u1', { id: '77', name: 'Spieler' });
  links.setAccount('u2', { id: '77', name: 'Spieler' });
  if (links.getAccount('u1') || links.discordIdForRoblox('77') !== 'u2') fail('Ein Roblox-Konto darf nur zu einem Discord-Nutzer gehören');
  links.removeAccount('u2');

  // Gestelltes Roblox
  const calls = [];
  const store = {};
  const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
  const realFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    const method = options.method ?? 'GET';
    calls.push({ url: String(url), method, headers: options.headers ?? {}, body: options.body ? JSON.parse(options.body) : null });
    const entry = new URL(url).pathname.match(/data-stores\/([^/]+)\/entries\/([^/]+)$/);
    if (entry && method === 'GET') return store[entry[2]] === undefined ? json({ code: 'NOT_FOUND' }, 404) : json({ value: store[entry[2]] });
    if (entry && method === 'PATCH') {
      store[entry[2]] = JSON.parse(options.body).value;
      return json({});
    }
    return new Response('', { status: 200 });
  };

  try {
    await cloud.publish('kick', cloud.privateTarget('5'), { userId: '77', reason: 'Test' });
    let call = calls.at(-1);
    if (call.url !== 'https://apis.roblox.com/cloud/v2/universes/999:publishMessage' || call.method !== 'POST' || call.headers['x-api-key'] !== 'test-key') {
      fail(`publishMessage-Anfrage falsch: ${call.method} ${call.url}`);
    }
    const message = JSON.parse(call.body.message);
    if (call.body.topic !== cloud.TOPIC || message.v !== 1 || message.action !== 'kick' || message.target !== 'owner:5' || message.userId !== '77') {
      fail(`Nachricht ans Spiel falsch: ${call.body.message}`);
    }
    await expectError('Zu lange Nachrichten ans Spiel müssen abgelehnt werden', () => cloud.publish('announce', 'all', { text: 'x'.repeat(2000) }));

    await cloud.banUser('77', { seconds: 3600, displayReason: 'Grund', privateReason: 'Notiz' });
    call = calls.at(-1);
    const restriction = call.body?.gameJoinRestriction;
    if (call.method !== 'PATCH' || !call.url.endsWith('/universes/999/user-restrictions/77') || restriction?.active !== true || restriction.duration !== '3600s') {
      fail(`Bann-Anfrage falsch: ${call.method} ${call.url} ${JSON.stringify(call.body)}`);
    }
    await cloud.banUser('77', { seconds: null, displayReason: 'Grund', privateReason: '' });
    if ('duration' in calls.at(-1).body.gameJoinRestriction) fail('Ein dauerhafter Bann darf keine Dauer mitschicken');
    await cloud.unbanUser('77');
    if (calls.at(-1).body.gameJoinRestriction.active !== false) fail('Unban-Anfrage falsch');

    const now = Math.floor(Date.now() / 1000);
    store['5'] = { 1: { name: 'abgelaufen', expires: now - 10 }, 2: { name: 'dauerhaft', expires: 0 } };
    await cloud.updatePrivateBans('5', (bans) => {
      bans['77'] = { name: 'Neu', reason: 'r', expires: now + 60 };
    });
    if ('1' in store['5'] || !('2' in store['5']) || !('77' in store['5'])) fail(`Privatserver-Banns falsch gespeichert: ${JSON.stringify(store['5'])}`);
    if (!calls.some((c) => c.method === 'PATCH' && c.url.endsWith(`/data-stores/${cloud.PRIVATE_BANS_STORE}/entries/5?allowMissing=true`))) {
      fail('Privatserver-Banns werden nicht in den richtigen Datastore geschrieben');
    }
    if (Object.keys(await cloud.getPrivateBans('404')).length) fail('Unbekannter Besitzer sollte keine Banns haben');

    // Spielrechte (nur Privatserver): Discord-Rolle → Recht im Datastore + live ans Spiel; Rolle weg → Recht weg
    const ids = config.roblox.rights.map((r) => r.id);
    for (const r of config.roblox.rights) if (!rights.RIGHT_NAME.test(r.id) || !r.name) fail(`Spielrecht ungültig: ${JSON.stringify(r)}`);
    if (new Set(ids).size !== ids.length) fail('Doppelte Spielrechte in roblox.rights');

    links.linkPrivateServer('300', { ownerId: '5', ownerName: 'Besitzer', name: 'Nord', linkedBy: '1' });
    settings.set('300', 'roblox.rightRoles.polizei', 'rolePol');
    settings.set('300', 'roblox.rightRoles.sek', 'roleSek');
    const memberRoles = new Set(['rolePol']);
    let memberPresent = true;
    const fakeMember = { id: 'd1', roles: { cache: { has: (id) => memberRoles.has(id), some: (fn) => [...memberRoles].some((id) => fn({ id })) } } };
    const privateGuild = {
      id: '300',
      name: 'Nord',
      members: {
        fetch: async (id) => {
          if (!id) return new Map(memberPresent ? [['d1', fakeMember]] : []);
          if (!memberPresent) throw new Error('Unknown Member');
          return fakeMember;
        },
      },
    };
    const rightsOf = (robloxId) => JSON.stringify(store[rights.rightsKey('5', robloxId)]?.rights);
    const expectRights = (robloxId, expected, label) => {
      if (rightsOf(robloxId) !== JSON.stringify(expected)) fail(`Spielrechte ${label}: ${rightsOf(robloxId)} statt ${JSON.stringify(expected)}`);
    };

    links.setAccount('d1', { id: '77', name: 'Spieler' });
    await rights.syncMember(privateGuild, 'd1');
    expectRights('77', ['polizei'], 'nach Rolle');
    const live = JSON.parse(calls.at(-1).body.message);
    if (live.action !== 'rights' || live.target !== 'owner:5' || live.userId !== '77' || JSON.stringify(live.rights) !== '["polizei"]') {
      fail(`Live-Nachricht Spielrechte falsch: ${calls.at(-1).body.message}`);
    }
    const callCount = calls.length;
    await rights.syncMember(privateGuild, 'd1');
    if (calls.length !== callCount) fail('Unveränderte Spielrechte dürfen nicht erneut an Roblox gehen');

    memberRoles.add('roleSek');
    await rights.syncMember(privateGuild, 'd1');
    expectRights('77', ['polizei', 'sek'], 'nach zweiter Rolle');

    links.setAccount('d1', { id: '78', name: 'NeuesKonto' }); // neu verifiziert → altes Konto verliert die Rechte
    await rights.syncMember(privateGuild, 'd1');
    expectRights('77', [], 'altes Konto nach neuer Verifizierung');
    expectRights('78', ['polizei', 'sek'], 'neues Konto nach neuer Verifizierung');

    memberPresent = false; // Discord verlassen
    await rights.syncMember(privateGuild, 'd1');
    expectRights('78', [], 'nach Verlassen des Discords');

    links.removeAccount('d1'); // nicht verifiziert → Konto aus der angenommenen Bewerbung
    Object.assign(bucket('apps', '300'), {
      'APP-0001': { number: 'APP-0001', type: 'polizei', userId: 'd1', status: 'ACCEPTED', createdAt: 1, decidedAt: 2, roblox: { id: '79', name: 'Bewerber' } },
    });
    if (rights.accountFor('300', 'd1')?.id !== '79') fail('Roblox-Konto aus der angenommenen Bewerbung wird nicht genutzt');
    memberPresent = true;
    await rights.syncMember(privateGuild, 'd1');
    expectRights('79', ['polizei', 'sek'], 'mit Konto aus der Bewerbung');

    if ((await rights.syncMember({ ...privateGuild, id: '100' }, 'd1')) !== null) fail('Der Haupt-Discord darf keine Spielrechte vergeben (nur Privatserver)');
    if ((await rights.syncMember({ ...privateGuild, id: '200' }, 'd1')) !== null) fail('Ein unverknüpfter Discord darf keine Spielrechte vergeben');

    await rights.clearGuild('300', '5'); // vom Privatserver getrennt → vergebene Rechte entfernen
    expectRights('79', [], 'nach dem Trennen des Discords');
    links.unlinkPrivateServer('300');
  } finally {
    global.fetch = realFetch;
  }

  // Das Spiel-Skript muss dieselben Namen benutzen wie der Bot
  const lua = fs.readFileSync(path.join(__dirname, '..', 'roblox', 'ENRPBridge.server.lua'), 'utf8');
  if (!lua.includes(`local TOPIC = "${cloud.TOPIC}"`) || !lua.includes(`local PRIVATE_BANS_STORE = "${cloud.PRIVATE_BANS_STORE}"`)) {
    fail('roblox/ENRPBridge.server.lua passt nicht zu src/lib/roblox/openCloud.js (TOPIC / PRIVATE_BANS_STORE)');
  }
  if (!lua.includes(`local RIGHTS_STORE = "${rights.RIGHTS_STORE}"`)) fail('roblox/ENRPBridge.server.lua: RIGHTS_STORE passt nicht zu src/lib/roblox/rights.js');
  if (rights.rightsKey('5', '77') !== 'owner-5-user-77' || !lua.includes('"owner-" .. tostring(ownerId) .. "-user-" .. tostring(player.UserId)')) {
    fail('Schlüssel der Spielrechte passt nicht zum Spiel-Skript');
  }
  for (const action of ['announce', 'kick', 'ban', 'refresh', 'shutdown', 'rights']) {
    if (!lua.includes(`function handlers.${action}(`)) fail(`Spiel-Skript kennt die Aktion „${action}“ nicht`);
  }
  console.log('✅ Roblox-Anbindung');
}

checkRoblox()
  .catch((err) => fail(`Roblox: ${err.stack}`))
  .then(() => {
    if (failed) process.exit(1);
    console.log('✅ Alles in Ordnung');
    process.exit(0);
  });
