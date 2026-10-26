// Einstellungen, die per /einstellungen in Discord geändert wurden. Sie werden in data/db.json gespeichert
// und beim Start über config.json gelegt. Das config-Objekt wird direkt verändert, damit alle Module
// sofort die neuen Werte sehen.
const config = require('../../config.json');
const db = require('./db');

const overrides = (db.data.settings ??= {});
const defaults = structuredClone(config);

// Pfade wie "channels.welcome" oder "tickets.types.general.capacity" (in Listen wird per id gesucht).
function resolve(root, path) {
  const keys = path.split('.');
  const last = keys.pop();
  let target = root;
  for (const key of keys) {
    target = Array.isArray(target) ? target.find((entry) => entry.id === key) : target?.[key];
    if (target === undefined) return null;
  }
  return { target, last };
}

function apply(path, value) {
  const found = resolve(config, path);
  if (!found) return false;
  if (value === undefined) delete found.target[found.last];
  else found.target[found.last] = value;
  return true;
}

function get(path) {
  const found = resolve(config, path);
  return found ? found.target[found.last] : undefined;
}

// value === undefined entfernt den Schlüssel (z. B. eine Level-Belohnung).
function set(path, value) {
  if (!apply(path, value)) throw new Error(`Unbekannte Einstellung: ${path}`);
  overrides[path] = value === undefined ? null : value;
  db.save();
}

// Alle Änderungen verwerfen und wieder die Werte aus config.json verwenden.
function reset() {
  for (const path of Object.keys(overrides)) {
    const original = resolve(defaults, path);
    apply(path, original ? structuredClone(original.target[original.last]) : undefined);
    delete overrides[path];
  }
  db.save();
}

for (const [path, value] of Object.entries(overrides)) {
  if (!apply(path, value ?? undefined)) console.warn(`⚠️  Gespeicherte Einstellung ${path} passt nicht mehr zur config.json und wird ignoriert`);
}

module.exports = { get, set, reset, overrideCount: () => Object.keys(overrides).length };
