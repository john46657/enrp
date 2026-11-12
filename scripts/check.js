// Prüft Konfiguration und Befehle ohne Discord-Login: npm run check
const fs = require('node:fs');
const path = require('node:path');
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
const ca = settings.forGuild(a);
if (ca.tickets.types[0].capacity !== 99 || ca.channels.ticketLog !== '123' || ca.leveling.roleRewards[7] !== '456') {
  fail('Einstellungen werden nicht übernommen');
}
const cb = settings.forGuild(b);
if (cb.tickets.types[0].capacity !== before.cap || cb.channels.ticketLog !== before.log || '7' in cb.leveling.roleRewards) {
  fail('Einstellungen eines Servers wirken sich auf einen anderen Server aus');
}
if (config.tickets.types[0].capacity !== before.cap || config.channels.ticketLog !== before.log) fail('Vorlage config.json wurde verändert');
settings.reset(a);
const reset = settings.forGuild(a);
if (reset.tickets.types[0].capacity !== before.cap || reset.channels.ticketLog !== before.log || '7' in reset.leveling.roleRewards) {
  fail('Einstellungen lassen sich nicht zurücksetzen');
}
console.log('✅ Einstellungen je Server setzen/zurücksetzen');

// Bewerbungen selbst anlegen: keine vorgefertigten, je Server getrennt
const appStore = require('../src/lib/applications/store');
const manage = require('../src/lib/applications/manage');
const expect = (condition, message) => condition || fail(`Bewerbung verwalten: ${message}`);
expect(config.applications.types.length === 0, 'config.json sollte keine vorgefertigten Bewerbungen enthalten');
expect(appStore.types(a).length === 0, 'neuer Server sollte keine Bewerbungen haben');

const created = manage.createType(a, { name: 'Sanitäter Ausbildung', emoji: '🚑' });
expect(!created.error, created.error);
const appId = created.type?.id;
expect(appId === 'sanitaeter-ausbildung', `id aus dem Namen: ${appId}`);
expect(created.type?.numberPrefix === 'SANI', `Kürzel aus dem Namen: ${created.type?.numberPrefix}`);
expect(manage.createType(a, { name: 'sanitäter ausbildung' }).error, 'doppelter Name sollte abgelehnt werden');
expect(appStore.types(b).length === 0, 'Bewerbung eines Servers taucht auf einem anderen auf');
expect(appStore.eligibility({ guild: { id: a }, id: 'u1', roles: { cache: new Map() } }, created.type)?.includes('keine Fragen'), 'ohne Fragen darf man sich nicht bewerben');
expect(appStore.typeChoices(a, 'sani')[0]?.value === appId, 'Autovervollständigung findet die Bewerbung nicht');

expect(!manage.addQuestion(a, appId, { type: 'TEXT', label: 'Warum?', min: 20, max: 500 }).error, 'Freitext-Frage');
expect(!manage.addQuestion(a, appId, { type: 'CHOICE', label: 'Wie oft?', options: [{ label: 'Oft' }, { label: 'Selten' }] }).error, 'Auswahl-Frage');
expect(manage.addQuestion(a, appId, { type: 'CHOICE', label: 'Ohne Optionen' }).error, 'Auswahl ohne Optionen sollte abgelehnt werden');
expect(!manage.addQuestion(a, appId, { type: 'ROBLOX', label: 'Roblox-Name?' }, 1).error, 'Roblox-Frage an Position 1');
expect(manage.addQuestion(a, appId, { type: 'ROBLOX', label: 'Noch mal?' }).error, 'zweite Roblox-Frage sollte abgelehnt werden');
expect(manage.addQuestion(a, appId, { type: 'TEXT', label: 'x', min: 50, max: 10 }).error, 'min > max sollte abgelehnt werden');
let app = appStore.typeById(a, appId);
expect(app.questions.map((q) => q.type).join() === 'ROBLOX,TEXT,CHOICE', `Reihenfolge: ${app.questions.map((q) => q.type)}`);
expect(new Set(app.questions.map((q) => q.key)).size === 3, 'Fragen-Schlüssel sind nicht eindeutig');
expect(!manage.moveQuestion(a, appId, 1, 3).error && appStore.typeById(a, appId).questions[2].type === 'ROBLOX', 'Frage verschieben');
expect(!manage.updateQuestion(a, appId, 1, { label: 'Warum willst du zu uns?', required: false }).error, 'Frage bearbeiten');
expect(appStore.typeById(a, appId).questions[0].label === 'Warum willst du zu uns?', 'Frage wurde nicht geändert');
expect(manage.updateQuestion(a, appId, 9, { label: 'x' }).error, 'nicht vorhandene Frage');
expect(!manage.removeQuestion(a, appId, 2).error && appStore.typeById(a, appId).questions.length === 2, 'Frage entfernen');
expect(!manage.updateType(a, appId, { name: 'Rettungsdienst', panel: 'quali', numberPrefix: 'rd' }).error, 'Bewerbung bearbeiten');
app = appStore.typeById(a, appId);
expect(app.name === 'Rettungsdienst' && app.panel === 'quali' && app.numberPrefix === 'RD', 'Bewerbung wurde nicht geändert');
expect(manage.updateType(a, appId, { numberPrefix: 'zu-lang!' }).error, 'ungültiges Kürzel sollte abgelehnt werden');
expect(!manage.setMessages(a, appId, { accept: 'Willkommen {applicant}!', reject: '' }).error, 'Texte speichern');
app = appStore.typeById(a, appId);
expect(app.messages.accept === 'Willkommen {applicant}!' && app.messages.reject === config.applications.defaults.messages.reject, 'Texte / Standardtext');
settings.set(a, `applications.types.${appId}.enabled`, false);
expect(appStore.typeById(a, appId).enabled === false, '/einstellungen bewerbung wirkt nicht auf eigene Bewerbungen');
expect(!validateType(app).length, `eigene Bewerbung ungültig: ${validateType(app).join(', ')}`);

const { parseOptions } = require('../src/commands/applications/manage');
const fakeRoles = { roles: { cache: new Map([['123456789012345678', { name: 'Streife' }]]) } };
expect(parseOptions('Täglich; Selten ;', 'CHOICE', fakeRoles).length === 2, 'Optionen trennen');
expect(parseOptions('<@&123456789012345678>', 'ROLE', fakeRoles)[0]?.label === 'Streife', 'Rollen-Optionen');
let threw = false;
try {
  parseOptions('A; a', 'CHOICE', fakeRoles);
} catch {
  threw = true;
}
expect(threw, 'doppelte Optionen sollten abgelehnt werden');

// Löschen: ohne Bewerbungen ganz weg, mit alten Bewerbungen nur archiviert, mit offenen gar nicht
const record = appStore.createRecord(a, appStore.typeById(a, appId), { userId: 'u1', answers: [] });
expect(record.number === 'RD-0001', `Bewerbungsnummer: ${record.number}`);
expect(manage.deleteType(a, appId).error, 'Löschen mit offener Bewerbung sollte abgelehnt werden');
appStore.setStatus(record, 'REJECTED', 'u2');
const deleted = manage.deleteType(a, appId);
expect(!deleted.error && deleted.archived, 'Löschen mit alter Bewerbung sollte archivieren');
expect(!appStore.types(a).length && appStore.typeById(a, appId)?.archived, 'archivierte Bewerbung');
expect(!Object.keys(require('../src/lib/db').data.settings[a] ?? {}).some((p) => p.includes(appId)), 'Einstellungen der gelöschten Bewerbung bleiben übrig');
expect(manage.createType(a, { name: 'Rettungsdienst' }).type?.id === 'rettungsdienst', 'Name nach dem Löschen wieder frei');
expect(!manage.deleteType(a, 'rettungsdienst').archived && !appStore.typeById(a, 'rettungsdienst'), 'Löschen ohne Bewerbungen');
console.log('✅ Bewerbungen selbst anlegen, bearbeiten, löschen');

if (failed) process.exit(1);
console.log('✅ Alles in Ordnung');
process.exit(0);
