// Prüft Konfiguration und Befehle ohne Discord-Login: npm run check
const fs = require('node:fs');
const path = require('node:path');
const { InteractionContextType } = require('discord.js');

let failed = false;
const fail = (msg) => {
  failed = true;
  console.error(`❌ ${msg}`);
};

require('../src/lib/settings');
const config = require('../config.json');
const branding = require('../src/lib/branding');
if (!config.branding?.name) fail('branding.name fehlt');
for (const key of ['bot', 'dashboard', 'admin', 'backend', 'roblox']) {
  if (!branding.product(key).includes(branding.name())) fail(`branding.products.${key} enthält den Projektnamen nicht`);
}
for (const [key, value] of Object.entries(config.colors)) {
  if (!/^#[0-9a-f]{6}$/i.test(value)) fail(`colors.${key} ist keine Hex-Farbe: ${value}`);
}
console.log(`✅ Branding: ${branding.name()} (${['bot', 'dashboard', 'admin', 'backend', 'roblox'].map(branding.product).join(', ')})`);
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
const hours = config.tickets.openingHours;
const wasEnabled = hours.enabled;
hours.enabled = true;
hours.periods = [
  { days: ['mo', 'di', 'mi', 'do', 'fr'], from: '15:00', to: '23:00' },
  { days: ['sa'], from: '20:00', to: '02:00' },
];
const { isOpen, nextOpening } = require('../src/lib/openingHours');
const cases = [
  ['2026-10-26T14:30:00Z', true], // Mo 15:30 Berlin (Winterzeit)
  ['2026-10-26T13:30:00Z', false], // Mo 14:30
  ['2026-07-06T13:30:00Z', true], // Mo 15:30 Berlin (Sommerzeit)
  ['2026-10-31T23:30:00Z', true], // So 00:30 – Samstagsschicht über Mitternacht
  ['2026-11-01T02:30:00Z', false], // So 03:30
];
for (const [iso, expected] of cases) {
  if (isOpen(new Date(iso)) !== expected) fail(`Öffnungszeiten: ${iso} sollte ${expected ? 'offen' : 'geschlossen'} sein`);
}
const next = nextOpening(new Date('2026-10-26T13:30:00Z'));
if (next?.toISOString() !== '2026-10-26T14:00:00.000Z') fail(`nextOpening falsch: ${next?.toISOString()}`);
hours.enabled = wasEnabled;
console.log('✅ Öffnungszeiten-Logik');

// Einstellungen in Discord: setzen, lesen, zurücksetzen
const settings = require('../src/lib/settings');
const firstType = config.tickets.types[0].id;
const before = { cap: config.tickets.types[0].capacity, log: config.channels.ticketLog };
settings.set(`tickets.types.${firstType}.capacity`, 99);
settings.set('channels.ticketLog', '123');
settings.set('leveling.roleRewards.7', '456');
if (config.tickets.types[0].capacity !== 99 || config.channels.ticketLog !== '123' || config.leveling.roleRewards[7] !== '456') {
  fail('Einstellungen werden nicht übernommen');
}
settings.reset();
if (config.tickets.types[0].capacity !== before.cap || config.channels.ticketLog !== before.log || '7' in config.leveling.roleRewards) {
  fail('Einstellungen lassen sich nicht zurücksetzen');
}
console.log('✅ Einstellungen setzen/zurücksetzen');

if (failed) process.exit(1);
console.log('✅ Alles in Ordnung');
process.exit(0);
