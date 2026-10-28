// Einstellungen je Server. config.json ist die Vorlage für alle Server; was per /einstellungen in Discord
// geändert wird, gilt nur für den jeweiligen Server und wird in data/db.json gespeichert.
// forGuild(guildId) liefert das fertige config-Objekt eines Servers. Es wird direkt verändert, damit alle
// Module sofort die neuen Werte sehen.
const base = require('../../config.json');
const db = require('./db');

require('./applications/normalize')(base); // Standardwerte der Bewerbungsarten ergänzen

// Module, die später dazugekommen sind: fehlen sie in einer älteren config.json auf dem Host, gelten diese Standardwerte
// (sonst blendet das Dashboard die Seite aus und der Befehl findet keine Einstellungen).
const LATER_MODULES = {
  counting: { enabled: false, channel: '', resetOnFail: true, allowTwice: false },
  roblox: { game: '' },
};
for (const [key, defaults] of Object.entries(LATER_MODULES)) base[key] = { ...defaults, ...base[key] };

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
    configs.set(guildId, config);
  }
  return configs.get(guildId);
}

function get(guildId, path) {
  const found = resolve(forGuild(guildId), path);
  return found ? found.target[found.last] : undefined;
}

// value === undefined entfernt den Schlüssel (z. B. eine Level-Belohnung).
function set(guildId, path, value) {
  if (!apply(forGuild(guildId), path, value)) throw new Error(`Unbekannte Einstellung: ${path}`);
  const own = (overrides[guildId] ??= {});
  // Ältere Änderungen unterhalb dieses Pfads sind jetzt im neuen Wert enthalten (z. B. eine ganze Liste ersetzt).
  for (const key of Object.keys(own)) if (key.startsWith(`${path}.`)) delete own[key];
  delete own[path]; // neu einfügen, damit die Reihenfolge beim Laden stimmt
  own[path] = value === undefined ? null : value;
  db.save();
}

// Prüft Änderungen an einer Kopie, ohne zu speichern. Gibt den ersten ungültigen Pfad zurück (oder null).
function invalidPath(guildId, changes) {
  const copy = structuredClone(forGuild(guildId));
  return changes.find(({ path, value }) => !apply(copy, path, value))?.path ?? null;
}

// Alle Änderungen eines Servers verwerfen und wieder die Werte aus config.json verwenden.
function reset(guildId) {
  delete overrides[guildId];
  configs.delete(guildId);
  db.save();
}

module.exports = {
  base,
  forGuild,
  get,
  set,
  invalidPath,
  reset,
  adoptLegacy,
  hasLegacy: () => Boolean(overrides._legacy),
  overrideCount: (guildId) => Object.keys(overrides[guildId] ?? {}).length,
};
