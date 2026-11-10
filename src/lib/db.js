// Einfache JSON-Datenbank (data/db.json) – braucht keinen externen Datenbankserver.
const fs = require('node:fs');
const path = require('node:path');

// ENRP_DB_FILE nur für Tests (npm run check), damit die echte Datenbank unangetastet bleibt.
const FILE = process.env.ENRP_DB_FILE ? path.resolve(process.env.ENRP_DB_FILE) : path.join(__dirname, '..', '..', 'data', 'db.json');
const DIR = path.dirname(FILE);
const DEFAULTS = { warnings: {}, levels: {}, tickets: {}, applications: {}, counters: {} };

function load() {
  try {
    return { ...structuredClone(DEFAULTS), ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
  } catch (err) {
    if (err.code !== 'ENOENT') {
      // Kaputte Datei nicht überschreiben, sondern sichern.
      const backup = `${FILE}.kaputt-${Date.now()}`;
      fs.copyFileSync(FILE, backup);
      console.error(`[db] db.json konnte nicht gelesen werden (${err.message}). Sicherung: ${backup}`);
    }
    return structuredClone(DEFAULTS);
  }
}

const data = load();
let timer = null;

// ---------- Migrationen ----------
// Jede Migration bringt data/db.json von Version n-1 auf n. Sie laufen beim Start einmalig und in Reihenfolge.
// Neue Bereiche entstehen sonst bei Bedarf von selbst (bucket()); hier steht nur, was umgebaut werden muss.
const MIGRATIONS = [
  // 1 → 2: Spiel-Anbindung (Bridge, CAD, BOLO): Bereiche anlegen, damit Übersichten sofort funktionieren
  (db) => {
    for (const key of ['gameBans', 'gameRights', 'gameConfig', 'secrets', 'cad', 'bolos', 'gameCommands', 'gameModcalls']) db[key] ??= {};
    for (const key of ['gameEvents', 'gameEventSeen', 'apiLogs']) db[key] ??= [];
  },
];
const SCHEMA_VERSION = MIGRATIONS.length + 1;

function migrate() {
  const from = data.schemaVersion ?? 1;
  if (from >= SCHEMA_VERSION) return [];
  const applied = [];
  for (let version = from; version < SCHEMA_VERSION; version++) {
    MIGRATIONS[version - 1](data);
    applied.push(version + 1);
  }
  data.schemaVersion = SCHEMA_VERSION;
  save();
  return applied;
}

function flush() {
  clearTimeout(timer);
  timer = null;
  fs.mkdirSync(DIR, { recursive: true });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, FILE);
}

// Schreibt gesammelt spätestens nach einer Sekunde.
function save() {
  if (!timer) timer = setTimeout(flush, 1000);
}

// Liefert den Datenbereich eines Servers, z. B. bucket('warnings', guildId).
function bucket(name, guildId) {
  data[name] ??= {};
  return (data[name][guildId] ??= {});
}

function nextNumber(name, guildId) {
  const counters = bucket('counters', guildId);
  counters[name] = (counters[name] ?? 0) + 1;
  save();
  return counters[name];
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (timer) flush();
    process.exit(0);
  });
}

const applied = migrate();
if (applied.length && !process.env.ENRP_DB_FILE) console.log(`🗄️  Datenbank auf Version ${SCHEMA_VERSION} gebracht (Migrationen: ${applied.join(', ')})`);

module.exports = { data, save, flush, bucket, nextNumber, SCHEMA_VERSION };
