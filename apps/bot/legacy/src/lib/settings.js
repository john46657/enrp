// Einstellungen je Server. config.json ist die Vorlage für alle Server; was per /einstellungen in Discord
// geändert wird, gilt nur für den jeweiligen Server und wird in data/db.json gespeichert.
// Bewerbungsarten legt jeder Server selbst an (/bewerbung-verwalten); sie liegen in data/db.json unter appTypes.
// forGuild(guildId) liefert das fertige config-Objekt eines Servers. Es wird direkt verändert, damit alle
// Module sofort die neuen Werte sehen.
const base = require('../../config.json');
const db = require('./db');

const normalize = require('./applications/normalize');

normalize(base); // Standardwerte der Bewerbungsarten ergänzen

// Module, die später dazugekommen sind: fehlen sie in einer älteren config.json auf dem Host, gelten diese Standardwerte
// (sonst blendet das Dashboard die Seite aus und der Befehl findet keine Einstellungen).
const LATER_MODULES = {
  counting: { enabled: false, channel: '', resetOnFail: true, allowTwice: false },
  roblox: { game: '' },
};
for (const [key, defaults] of Object.entries(LATER_MODULES)) base[key] = { ...defaults, ...base[key] };

const isGuildIdKey = (key) => /^\d+$/.test(key);
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

// Gespeicherte Einzelwerte selbst erstellter Bewerbungsarten in die Art übernehmen (siehe set()).
function foldOwnTypeOverrides() {
  for (const [guildId, stored] of Object.entries(overrides)) {
    if (!isGuildIdKey(guildId) || !stored) continue;
    for (const [path, value] of Object.entries(stored)) {
      const own = ownTypePath(guildId, path);
      if (!own) continue;
      setInOwnType(own.type, own.rest, value ?? undefined);
      delete stored[path];
      db.save();
    }
  }
}

// Ältere Dashboard-Versionen speicherten die ganze Liste als Einstellung „applications.types“ – jetzt eigene Arten.
for (const [guildId, own] of Object.entries(overrides)) {
  if (!isGuildIdKey(guildId) || !own || !('applications.types' in own)) continue;
  const list = own['applications.types'] ?? [];
  const builtIn = new Set(base.applications.types.map((t) => t.id));
  appTypes[guildId] = list.filter((t) => !builtIn.has(t?.id)).map((t) => structuredClone(t));
  delete own['applications.types'];
  db.save();
}
foldOwnTypeOverrides();

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
// Ganze Liste der Bewerbungsarten (z. B. aus dem Dashboard der Plattform): wird zu den selbst erstellten
// Bewerbungsarten des Servers, statt als Einstellung die Liste zu überdecken. Archivierte Arten bleiben erhalten.
const TYPES_PATH = 'applications.types';
function replaceAppTypes(guildId, list) {
  if (!Array.isArray(list)) throw new Error('Bewerbungsarten müssen eine Liste sein.');
  const builtIn = new Set(base.applications.types.map((t) => t.id));
  const ids = new Set(list.map((t) => t?.id));
  const archived = (appTypes[guildId] ?? []).filter((t) => t.archived && !ids.has(t.id));
  appTypes[guildId] = [...list.filter((t) => !builtIn.has(t?.id)).map((t) => structuredClone(t)), ...archived];
  const own = overrides[guildId] ?? {};
  for (const key of Object.keys(own)) if (key === TYPES_PATH || key.startsWith(`${TYPES_PATH}.`)) delete own[key];
  configs.delete(guildId);
}

// Wert in einer selbst erstellten Bewerbungsart speichern (fehlende Zwischenobjekte werden angelegt,
// undefined entfernt den Wert, dann gilt wieder der Standardwert aus applications.defaults).
function setInOwnType(type, rest, value) {
  const keys = rest.split('.');
  let target = type;
  for (const key of keys.slice(0, -1)) {
    if (!target[key] || typeof target[key] !== 'object' || Array.isArray(target[key])) target[key] = {};
    target = target[key];
  }
  const last = keys.at(-1);
  if (value === undefined) delete target[last];
  else target[last] = structuredClone(value);
}

// Pfad „applications.types.<id>.…“ einer selbst erstellten Art → { type, rest } (sonst null).
function ownTypePath(guildId, path) {
  const match = path.match(/^applications\.types\.([^.]+)\.(.+)$/);
  const type = match && (appTypes[guildId] ?? []).find((t) => t.id === match[1]);
  return type ? { type, rest: match[2] } : null;
}

function set(guildId, path, value) {
  if (path === TYPES_PATH) {
    replaceAppTypes(guildId, value ?? []);
    db.save();
    return;
  }
  // Selbst erstellte Bewerbungsarten werden direkt geändert, damit /bewerbung-verwalten und das Dashboard
  // dieselben Werte sehen (eine Einstellung würde spätere Änderungen sonst überdecken).
  const ownType = ownTypePath(guildId, path);
  if (ownType) {
    if (!apply(structuredClone(forGuild(guildId)), path, value)) throw new Error(`Unbekannte Einstellung: ${path}`);
    setInOwnType(ownType.type, ownType.rest, value);
    const stored = overrides[guildId] ?? {};
    for (const key of Object.keys(stored)) if (key === path || key.startsWith(`${path}.`)) delete stored[key];
    configs.delete(guildId);
    db.save();
    return;
  }
  if (!apply(forGuild(guildId), path, value)) throw new Error(`Unbekannte Einstellung: ${path}`);
  const own = (overrides[guildId] ??= {});
  // Ältere Änderungen unterhalb dieses Pfads sind jetzt im neuen Wert enthalten (z. B. eine ganze Liste ersetzt).
  for (const key of Object.keys(own)) if (key.startsWith(`${path}.`)) delete own[key];
  delete own[path]; // neu einfügen, damit die Reihenfolge beim Laden stimmt
  own[path] = value === undefined ? null : value;
  db.save();
}

// Wendet Änderungen auf eine Kopie an, ohne zu speichern: { invalid: erster ungültiger Pfad oder null, config: Kopie }.
function preview(guildId, changes) {
  const config = structuredClone(forGuild(guildId));
  const invalid = changes.find(({ path, value }) => !apply(config, path, value ?? undefined))?.path ?? null;
  return { invalid, config };
}
const invalidPath = (guildId, changes) => preview(guildId, changes).invalid;
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
  invalidPath,
  preview,
  unset,
  reset,
  ownAppTypes,
  saveAppTypes,
  dropAppTypeOverrides,
  adoptLegacy,
  hasLegacy: () => Boolean(overrides._legacy),
  overrideCount: (guildId) => Object.keys(overrides[guildId] ?? {}).length,
};
