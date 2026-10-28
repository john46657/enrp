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

// Ticket-Kategorien: Formular beim Schließen und Panel ohne aktive Kategorie
for (const t of config.tickets.types) {
  if ((t.closeForm ?? []).length > 5) fail(`Ticket-Kategorie ${t.id}: höchstens 5 Formularfelder`);
  for (const field of t.closeForm ?? []) if (!field.label) fail(`Ticket-Kategorie ${t.id}: Formularfeld ohne label`);
}
const { closeFormModal } = require('../src/lib/tickets');
try {
  closeFormModal([{ label: 'Wurde dir geholfen?', style: 'short' }, { label: 'Feedback', style: 'paragraph', required: false, maxLength: 1000 }]).toJSON();
  for (const t of config.tickets.types) settings.set('check', `tickets.types.${t.id}.enabled`, false);
  const empty = buildPanel(fakeGuild);
  if (empty.components.length !== 1) fail('Panel ohne aktive Kategorie darf kein Auswahlmenü haben');
  empty.components[0].toJSON();
  settings.reset('check');
  console.log('✅ Schließ-Formular und Panel ohne aktive Kategorie');
} catch (err) {
  fail(`Ticket-Kategorien: ${err.message}`);
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

// Statistik-Namen und ganze Listen ersetzen
const { statName, TYPES } = require('../src/lib/stats');
if (statName('👥 Mitglieder: {count}', 1284) !== '👥 Mitglieder: 1.284') fail(`statName falsch: ${statName('👥 Mitglieder: {count}', 1284)}`);
for (const c of config.stats.counters) if (!TYPES[c.type]) fail(`Unbekannte Statistik-Art: ${c.type}`);
settings.set(a, `tickets.types.${firstType}.capacity`, 5);
settings.set(a, 'tickets.types', [{ ...config.tickets.types[0], capacity: 7 }]);
if (settings.forGuild(a).tickets.types.length !== 1 || settings.forGuild(a).tickets.types[0].capacity !== 7) fail('Liste ersetzen funktioniert nicht');
settings.reset(a);
console.log('✅ Statistik-Namen');

// Giveaways: Dauer und gewichtete Ziehung
const gw = require('../src/lib/giveaways');
const durations = [['30m', 1_800_000], ['1d12h', 129_600_000], ['2w', 1_209_600_000], ['10s', null], ['abc', null], ['100d', null]];
for (const [text, ms] of durations) if (gw.parseDuration(text) !== ms) fail(`parseDuration(${text}) = ${gw.parseDuration(text)}`);
const seq = [0.0, 0.99];
const drawn = gw.drawWinners([{ id: 'a', weight: 1 }, { id: 'b', weight: 3 }, { id: 'c', weight: 1 }], 2, () => seq.shift());
if (drawn.join() !== 'a,c' || new Set(drawn).size !== 2) fail(`drawWinners falsch: ${drawn}`);
if (gw.drawWinners([{ id: 'a', weight: 1 }], 3).length !== 1) fail('drawWinners zieht mehr Gewinner als Teilnehmer');
const day = gw.localNow(new Date('2026-10-30T17:00:00Z'), 'Europe/Berlin');
if (day.day !== 'fr' || day.time !== '18:00') fail(`localNow falsch: ${JSON.stringify(day)}`);
const ny = gw.localNow(new Date('2026-10-30T03:30:00Z'), 'America/New_York');
if (ny.day !== 'do' || ny.time !== '23:30' || ny.date !== '2026-10-29') fail(`localNow (New York) falsch: ${JSON.stringify(ny)}`);

// Zeitzonen: Ortszeit → Zeitpunkt (mit Sommer-/Winterzeit) und /abwesend-Datum
const time = require('../src/lib/time');
const zoned = [
  [{ year: 2026, month: 7, day: 1, hour: 12 }, 'Europe/Berlin', '2026-07-01T10:00:00.000Z'],
  [{ year: 2026, month: 12, day: 1, hour: 12 }, 'Europe/Berlin', '2026-12-01T11:00:00.000Z'],
  [{ year: 2026, month: 12, day: 31, hour: 23, minute: 59 }, 'America/New_York', '2027-01-01T04:59:00.000Z'],
  [{ year: 2026, month: 3, day: 29, hour: 12 }, 'Asia/Tokyo', '2026-03-29T03:00:00.000Z'],
];
for (const [parts, zone, iso] of zoned) {
  const got = new Date(time.fromZoned(parts, zone)).toISOString();
  if (got !== iso) fail(`fromZoned(${JSON.stringify(parts)}, ${zone}) = ${got}, erwartet ${iso}`);
}
if (!time.isValidTimeZone('Europe/Berlin') || time.isValidTimeZone('Mars/Olympus') || time.isValidTimeZone('')) fail('isValidTimeZone falsch');
const { parseUntil } = require('../src/lib/team');
const ref = Date.parse('2026-10-28T12:00:00Z');
if (new Date(parseUntil('31.12.2026', ref, 'Europe/Berlin')).toISOString() !== '2026-12-31T22:59:00.000Z') fail('parseUntil (Berlin) falsch');
if (parseUntil('31.02.2027', ref, 'Europe/Berlin') !== null || parseUntil('01.01.2020', ref) !== null) fail('parseUntil akzeptiert ungültige Daten');
if (parseUntil('7', ref) !== ref + 7 * 86_400_000) fail('parseUntil (Tage) falsch');
console.log('✅ Zeitzonen');
console.log('✅ Giveaways: Dauer, Ziehung, Wochentag');

if (failed) process.exit(1);
console.log('✅ Alles in Ordnung');
process.exit(0);
