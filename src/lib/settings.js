// Einstellungen je Server. config.json ist die Vorlage für alle Server; was per /einstellungen in Discord
// geändert wird, gilt nur für den jeweiligen Server und wird in data/db.json gespeichert.
// forGuild(guildId) liefert das fertige config-Objekt eines Servers. Es wird direkt verändert, damit alle
// Module sofort die neuen Werte sehen.
const base = require('../../config.json');
const db = require('./db');

const normalizeApplications = require('./applications/normalize');

normalizeApplications(base); // Standardwerte der Bewerbungsarten ergänzen

const overrides = (db.data.settings ??= {}); // { guildId: { pfad: wert } }
const configs = new Map(); // guildId → config-Objekt

// Ältere Versionen speicherten die Änderungen nur für einen Server direkt unter "settings".
// Mit GUILD_ID werden sie diesem Server zugeordnet, sonst beim Start dem einzigen Server (adoptLegacy).
const isGuildId = (key) => /^\d+$/.test(key);
const legacyKeys = Object.keys(overrides).filter((key) => !isGuildId(key) && key !== '_legacy');
if (legacyKeys.length) {
  const legacy = (overrides._legacy ??= {});
  for (const key of legacyKeys) {
    legacy[key] = overrides[key];
    delete overrides[key];
  }
  db.save();
}
if (overrides._legacy && process.env.GUILD_ID) adoptLegacy(process.env.GUILD_ID);

function adoptLegacy(guildId) {
  if (!overrides._legacy) return false;
  overrides[guildId] = { ...overrides._legacy, ...overrides[guildId] };
  delete overrides._legacy;
  configs.delete(guildId);
  db.save();
  return true;
}

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

function apply(config, path, value) {
  const found = resolve(config, path);
  if (!found) return false;
  if (value === undefined) delete found.target[found.last];
  else found.target[found.last] = value;
  return true;
}

function forGuild(guildId) {
  if (!configs.has(guildId)) {
    const config = structuredClone(base);
    for (const [path, value] of Object.entries(overrides[guildId] ?? {})) {
      if (!apply(config, path, value ?? undefined)) {
        console.warn(`⚠️  Gespeicherte Einstellung ${path} (Server ${guildId}) passt nicht mehr zur config.json und wird ignoriert`);
      }
    }
    normalizeApplications(config); // in Discord angelegte Bewerbungsarten und Panels um neue Standardwerte ergänzen
    configs.set(guildId, config);
  }
  return configs.get(guildId);
}

function get(guildId, path) {
  const found = resolve(forGuild(guildId), path);
  return found ? found.target[found.last] : undefined;
}

// value === undefined entfernt den Schlüssel (z. B. eine Level-Belohnung).
// Ein gesetzter Pfad ersetzt ältere Änderungen darunter (z. B. "applications.types" alle "applications.types.x.y")
// und wird ans Ende gestellt, damit er beim nächsten Start nach den übergeordneten Pfaden angewendet wird.
function set(guildId, path, value) {
  const stored = value !== null && typeof value === 'object' ? structuredClone(value) : value;
  if (!apply(forGuild(guildId), path, value)) throw new Error(`Unbekannte Einstellung: ${path}`);
  const own = (overrides[guildId] ??= {});
  for (const key of Object.keys(own)) if (key === path || key.startsWith(`${path}.`)) delete own[key];
  own[path] = stored === undefined ? null : stored;
  db.save();
}

// Alle Änderungen eines Servers verwerfen und wieder die Werte aus config.json verwenden.
// keep: Pfade, die erhalten bleiben (z. B. ['applications'] für selbst angelegte Bewerbungsarten und Panels).
function reset(guildId, { keep = [] } = {}) {
  const kept = Object.fromEntries(Object.entries(overrides[guildId] ?? {}).filter(([path]) => keep.some((k) => path === k || path.startsWith(`${k}.`))));
  if (Object.keys(kept).length) overrides[guildId] = kept;
  else delete overrides[guildId];
  configs.delete(guildId);
  db.save();
}

// Baut das config-Objekt eines Servers beim nächsten Zugriff neu auf, wie nach einem Neustart.
const reload = (guildId) => configs.delete(guildId);

module.exports = {
  base,
  forGuild,
  reload,
  get,
  set,
  reset,
  adoptLegacy,
  hasLegacy: () => Boolean(overrides._legacy),
  overrideCount: (guildId) => Object.keys(overrides[guildId] ?? {}).length,
};
