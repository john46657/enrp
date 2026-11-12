// Einstellungen je Server. config.json ist die Vorlage für alle Server; was per /einstellungen in Discord
// geändert wird, gilt nur für den jeweiligen Server und wird in data/db.json gespeichert.
// Bewerbungsarten legt jeder Server selbst an (/bewerbung-verwalten); sie liegen in data/db.json unter appTypes.
// forGuild(guildId) liefert das fertige config-Objekt eines Servers. Es wird direkt verändert, damit alle
// Module sofort die neuen Werte sehen.
const base = require('../../config.json');
const db = require('./db');

const normalize = require('./applications/normalize');

normalize(base); // Standardwerte der Bewerbungsarten ergänzen

const overrides = (db.data.settings ??= {}); // { guildId: { pfad: wert } }
const appTypes = (db.data.appTypes ??= {}); // { guildId: [Bewerbungsart, …] } – selbst erstellt
const configs = new Map(); // guildId → config-Objekt

// Früher waren Polizei, SEK, Flugstaffel und Ausbilder fest in der config.json. Server, die sie schon benutzt
// haben (Bewerbungen oder geänderte Einstellungen), bekommen sie einmalig als eigene Bewerbungsarten.
function migrateLegacyTypes() {
  const legacy = require('./applications/legacyTypes.json');
  const builtIn = new Set(base.applications.types.map((t) => t.id));
  const guildIds = new Set([...Object.keys(db.data.apps ?? {}), ...Object.keys(overrides)].filter((id) => /^\d+$/.test(id)));
  let changed = false;
  for (const guildId of guildIds) {
    const used = new Set(Object.values(db.data.apps?.[guildId] ?? {}).map((r) => r.type));
    for (const path of Object.keys(overrides[guildId] ?? {})) {
      const match = path.match(/^applications\.types\.([^.]+)\./);
      if (match) used.add(match[1]);
    }
    const own = (appTypes[guildId] ??= []);
    for (const type of legacy) {
      if (!used.has(type.id) || builtIn.has(type.id) || own.some((t) => t.id === type.id)) continue;
      own.push(structuredClone(type));
      changed = true;
      console.log(`ℹ️  Bewerbung „${type.name}“ für Server ${guildId} übernommen (war früher fest eingebaut)`);
    }
    if (!own.length) delete appTypes[guildId];
  }
  if (changed) db.save();
}
migrateLegacyTypes();

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
    const apps = config.applications;
    apps.types.push(...(appTypes[guildId] ?? []).map((type) => normalize.merge(apps.defaults, type)));
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
  (overrides[guildId] ??= {})[path] = value === undefined ? null : value;
  db.save();
}

// Einzelne gespeicherte Änderung entfernen, damit wieder der eigentliche Wert gilt.
function unset(guildId, path) {
  if (!overrides[guildId] || !(path in overrides[guildId])) return;
  delete overrides[guildId][path];
  configs.delete(guildId);
  db.save();
}

// Selbst erstellte Bewerbungsarten eines Servers (Rohdaten ohne Standardwerte). Nach Änderungen saveAppTypes() aufrufen.
const ownAppTypes = (guildId) => (appTypes[guildId] ??= []);

function saveAppTypes(guildId) {
  configs.delete(guildId);
  db.save();
}

// Entfernt alle gespeicherten Änderungen, die zu einer Bewerbungsart gehören.
function dropAppTypeOverrides(guildId, typeId) {
  const prefix = `applications.types.${typeId}.`;
  for (const path of Object.keys(overrides[guildId] ?? {})) if (path.startsWith(prefix)) delete overrides[guildId][path];
  saveAppTypes(guildId);
}

// Alle Änderungen eines Servers verwerfen und wieder die Werte aus config.json verwenden.
// Selbst erstellte Bewerbungsarten bleiben erhalten.
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
  unset,
  reset,
  ownAppTypes,
  saveAppTypes,
  dropAppTypeOverrides,
  adoptLegacy,
  hasLegacy: () => Boolean(overrides._legacy),
  overrideCount: (guildId) => Object.keys(overrides[guildId] ?? {}).length,
};
