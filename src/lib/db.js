// Einfache JSON-Datenbank (data/db.json) – braucht keinen externen Datenbankserver.
const fs = require('node:fs');
const path = require('node:path');

const DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data'); // DATA_DIR z. B. für Tests
const FILE = path.join(DIR, 'db.json');
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

module.exports = { data, save, flush, bucket, nextNumber };
