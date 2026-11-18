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

// Roblox-Spiel: Link oder Place-ID
const { parsePlaceId } = require('../src/lib/robloxGame');
const places = [['920587237', '920587237'], ['https://www.roblox.com/games/920587237/Adopt-Me', '920587237'], ['roblox.com/de/games/123/x', '123'], ['https://cfx.re/join/abc', null], ['', null]];
for (const [text, id] of places) if (parsePlaceId(text) !== id) fail(`parsePlaceId(${text}) = ${parsePlaceId(text)}`);
console.log('✅ Roblox-Spiel-Link');

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

// Panels als eigene Objekte und die Übersicht in Discord
const panels = require('../src/lib/applications/panels');
const appMessages = require('../src/lib/applications/messages');
const dashboard = require('../src/lib/applications/discordOverview');
const c = '333';
expect(panels.createPanel(c, { name: 'Leer' }).error, 'Panel ohne Bewerbungen auf dem Server sollte abgelehnt werden');
const police = manage.createType(c, { name: 'Polizei', workflow: 'police' }).type;
manage.addQuestion(c, police.id, { type: 'TEXT', label: 'Warum?' });
const panel = panels.createPanel(c, { name: 'Polizei-Panel', description: 'Hier bewerben', types: [police.id] }).panel;
expect(panel?.title === 'Polizei-Panel' && panel.types[0] === police.id, 'Panel anlegen');
expect(panels.createPanel(c, { name: 'polizei-panel' }).error, 'doppelter Panel-Name');
expect(panels.updatePanel(c, panel.id, { types: ['gibtsnicht'] }).error, 'unbekannte Bewerbung im Panel');
expect(panels.updatePanel(c, panel.id, { image: 'kein-link' }).error, 'ungültiges Bild');
const built = appMessages.buildPanel(c, panel.id).components.map((x) => x.toJSON());
expect(built[1]?.components?.[0]?.custom_id === `quali:apply:${police.id}`, 'Panel mit einer Bewerbung zeigt den Button');
const second = manage.createType(c, { name: 'SEK' });
expect(second.panel?.id === panel.id && panels.getPanel(c, panel.id).types.length === 2, 'neue Bewerbung kommt ins erste Panel');
manage.deleteType(c, second.type.id);
expect(panels.getPanel(c, panel.id).types.length === 1, 'gelöschte Bewerbung bleibt im Panel');
for (const view of [dashboard.homeView(c, 'u'), dashboard.appView(c, police.id), dashboard.questionView(c, police.id, 1), dashboard.panelsView(c), dashboard.panelView(c, panel.id), dashboard.panelsView('444')]) {
  view.components.forEach((x) => x.toJSON());
}
expect(dashboard.panelsView('444').embeds[0].toJSON().description.includes('Keine Bewerbungen gefunden'), 'leerer Panel-Zustand');
expect(JSON.stringify(dashboard.parseLength('20-500')) === '{"min":20,"max":500}', 'Länge aus Formular');
expect(!manage.setQuestions(c, police.id, [{ type: 'TEXT', label: 'A', min: 5, max: 50 }, { type: 'CHOICE', label: 'B', options: [{ label: 'x' }, { label: 'y' }] }]).error, 'Fragen auf einmal setzen');
expect(manage.setQuestions(c, police.id, [{ type: 'ROBLOX', label: 'R' }, { type: 'ROBLOX', label: 'R2' }]).error, 'zwei Roblox-Fragen');
expect(manage.setQuestions(c, police.id, [{ type: 'ROLE', label: 'R', options: [{ label: 'x', roleId: 'kaputt' }] }]).error, 'Rolle ohne gültige ID');
expect(appStore.typeById(c, police.id).questions.map((q) => q.key).join() === 'f1,f2', 'Fragen-Schlüssel nach setQuestions');

// Alte feste Panels („apply“/„quali“) werden zu Panel-Objekten
require('../src/lib/db').data.appPanelDefs['555'] = undefined;
settings.ownAppTypes('555').push({ id: 'alt', name: 'Alt', panel: 'quali', numberPrefix: 'A', questions: [{ key: 'a', type: 'TEXT', label: 'x' }] });
settings.saveAppTypes('555');
expect(panels.panelsOf('555').map((p) => `${p.id}:${p.types}`).join() === 'quali:alt', 'Übernahme der alten Panels');
console.log('✅ Panels und Übersicht in Discord');
// Bewerbungsphasen und Dienstnummern
{
  const created = require('../src/lib/applications/manage').createType('777', { name: 'Phasen-Test' });
  const id = created.type.id;
  const phaseOf = () => appStore.phaseOf('777', appStore.typeById('777', id));
  if (phaseOf().state !== 'open') fail(`Phase ohne Einschränkung: ${phaseOf().state}`);
  settings.set('777', `applications.types.${id}.phase.opensAt`, Date.now() + 60_000);
  if (phaseOf().state !== 'before') fail('Bewerbungsphase „öffnet später“ wird nicht erkannt');
  settings.set('777', `applications.types.${id}.phase.opensAt`, null);
  settings.set('777', `applications.types.${id}.phase.closesAt`, Date.now() - 1000);
  if (phaseOf().state !== 'after') fail('Bewerbungsphase „geschlossen“ wird nicht erkannt');
  settings.set('777', `applications.types.${id}.phase.closesAt`, null);
  settings.set('777', `applications.types.${id}.phase.maxApplications`, 1);
  appStore.createRecord('777', appStore.typeById('777', id), { userId: 'u1', answers: [] });
  if (phaseOf().state !== 'full' || phaseOf().used !== 1) fail(`Plätze werden nicht gezählt: ${JSON.stringify(phaseOf())}`);
  if (!appStore.phaseLabel({ state: 'full' }).includes('Plätze')) fail('phaseLabel falsch');

  const sn = require('../src/lib/applications/serviceNumbers');
  const cfg = { enabled: true, format: 'PD-{n}', digits: 2, start: 1, end: 3 };
  if (sn.formatNumber(cfg, 7) !== 'PD-07' || sn.formatNumber({ format: 'A', digits: 3 }, 5) !== 'A005') fail('formatNumber falsch');
  if (sn.nextFree('777', cfg) !== 1) fail('nextFree sollte 1 sein');
  require('../src/lib/db').bucket('serviceNumbers', '777').x = { userId: 'x', value: 'PD-01' };
  if (sn.nextFree('777', cfg) !== 2) fail('nextFree überspringt vergebene Nummern nicht');
  const { parseLocalDate } = require('../src/lib/time');
  if (new Date(parseLocalDate('24.12.2026 18:00', 'Europe/Berlin')).toISOString() !== '2026-12-24T17:00:00.000Z') fail('parseLocalDate falsch');
  let threw = false;
  try {
    parseLocalDate('31.02.2027');
  } catch {
    threw = true;
  }
  if (!threw) fail('parseLocalDate akzeptiert ungültige Daten');
  console.log('✅ Bewerbungsphasen und Dienstnummern');
}

if (failed) process.exit(1);
console.log('✅ Alles in Ordnung');
process.exit(0);
