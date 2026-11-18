// Bewerbungsarten und Panels je Server anlegen, bearbeiten, umbenennen und löschen (/bewerbungsart, /bewerbungspanel).
// Gespeichert wird die komplette Liste eines Servers als Einstellung "applications.types" bzw. "applications.panels".
// Ab der ersten Änderung gilt für diesen Server diese Liste statt der Vorlage aus config.json.
const settings = require('../settings');
const { save } = require('../db');
const store = require('./store');
const { validateType, TYPE_ID, PANEL_ID, NUMBER_PREFIX } = require('./forms');
const { normalizeType, normalizePanel } = require('./normalize');
const templates = require('./templates');

const MAX_TYPES = 50;
const MAX_PANELS = 25;

const typesCopy = (guildId) => structuredClone(store.types(guildId));
const panelsCopy = (guildId) => structuredClone(settings.forGuild(guildId).applications.panels);

class EditError extends Error {}
const fail = (message) => {
  throw new EditError(message);
};

// Prüft eine komplette Liste; wirft bei Problemen eine EditError mit allen Meldungen.
function check(types, panels) {
  const problems = types.flatMap((t) => validateType(t, { panels: Object.keys(panels) }));
  const ids = types.map((t) => t.id);
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dup) problems.push(`Die ID „${dup}“ ist doppelt vergeben`);
  if (types.length > MAX_TYPES) problems.push(`Höchstens ${MAX_TYPES} Bewerbungsarten`);
  if (Object.keys(panels).length > MAX_PANELS) problems.push(`Höchstens ${MAX_PANELS} Panels`);
  if (problems.length) fail(problems.slice(0, 10).join('\n'));
}

function saveTypes(guildId, types) {
  check(types, settings.forGuild(guildId).applications.panels);
  settings.set(guildId, 'applications.types', types);
}

// ---------- Bewerbungsarten ----------

function normalizeId(raw) {
  const id = String(raw ?? '').trim().toLowerCase();
  if (!TYPE_ID.test(id)) fail('Die ID muss 2–24 Zeichen haben: Kleinbuchstaben, Zahlen, _ oder - (z. B. `feuerwehr`).');
  return id;
}

function normalizePrefix(raw) {
  const prefix = String(raw ?? '').trim().toUpperCase();
  if (!NUMBER_PREFIX.test(prefix)) fail('Das Nummern-Präfix muss 1–10 Zeichen haben: A-Z oder 0-9 (z. B. `FW` → FW-0001).');
  return prefix;
}

// Neue Art aus einer Vorlage oder als Kopie einer vorhandenen Art.
function createType(guildId, { id, name, template = 'leer', copyFrom, panel, prefix, emoji }) {
  const types = typesCopy(guildId);
  const panels = settings.forGuild(guildId).applications.panels;
  id = normalizeId(id);
  if (types.some((t) => t.id === id)) fail(`Die ID „${id}“ gibt es schon.`);

  let source;
  if (copyFrom) {
    source = types.find((t) => t.id === copyFrom) ?? fail(`Die Bewerbungsart „${copyFrom}“ gibt es nicht.`);
    source = structuredClone(source);
  } else {
    source = templates.build(template) ?? fail(`Die Vorlage „${template}“ gibt es nicht.`);
  }

  const type = normalizeType({ ...source, id }, settings.base.applications.defaults);
  delete type.workflow; // Prüfschritte stehen jetzt in stages
  type.name = name?.trim() || type.name || id;
  type.enabled = copyFrom ? type.enabled : true;
  if (emoji !== undefined && emoji !== null) type.emoji = emoji.trim();
  // Präfix: angegeben > aus der Vorlage (wenn noch frei) > aus der ID abgeleitet
  const templatePrefixFree = !copyFrom && type.numberPrefix && !types.some((t) => t.numberPrefix === type.numberPrefix);
  type.numberPrefix = prefix ? normalizePrefix(prefix) : templatePrefixFree ? type.numberPrefix : defaultPrefix(id, types);
  type.panel = panel ?? (panels[type.panel] ? type.panel : Object.keys(panels)[0]);
  if (!type.panel) fail('Es gibt noch kein Panel. Lege zuerst eins an: `/bewerbungspanel erstellen`.');
  // Kanäle und Rollen gehören zum Server und werden nie aus einer Vorlage übernommen, bei Kopien schon.
  if (!copyFrom) {
    type.channels = structuredClone(settings.base.applications.defaults.channels);
    type.roles = structuredClone(settings.base.applications.defaults.roles);
  }

  types.push(type);
  saveTypes(guildId, types);
  return type;
}

// Vorschlag für das Nummern-Präfix: die ersten Buchstaben der ID, z. B. feuerwehr → FEU.
function defaultPrefix(id, types) {
  const letters = id.replace(/[^a-z0-9]/g, '').toUpperCase();
  const used = new Set(types.map((t) => t.numberPrefix));
  for (const length of [3, 4, 5, 2, 6]) {
    const candidate = letters.slice(0, length);
    if (candidate && !used.has(candidate)) return candidate;
  }
  return letters.slice(0, 10) || 'APP';
}

// Ändert eine Art über eine Funktion, prüft das Ergebnis und speichert. Gibt die neue Art zurück.
function updateType(guildId, id, change) {
  const types = typesCopy(guildId);
  const index = types.findIndex((t) => t.id === id);
  if (index < 0) fail(`Die Bewerbungsart „${id}“ gibt es nicht mehr.`);
  const updated = change(types[index], types) ?? types[index];
  types[index] = updated;
  if (updated.id !== id) {
    updated.id = normalizeId(updated.id);
    if (types.some((t, i) => i !== index && t.id === updated.id)) fail(`Die ID „${updated.id}“ gibt es schon.`);
  }
  saveTypes(guildId, types);
  if (updated.id !== id) renameReferences(guildId, id, updated.id);
  return updated;
}

// Nach einer ID-Änderung zeigen Bewerbungen, Sperren und „in Bearbeitung“ auf die neue ID.
function renameReferences(guildId, oldId, newId) {
  for (const record of Object.values(store.recordsOf(guildId))) if (record.type === oldId) record.type = newId;
  for (const ban of Object.values(store.bansOf(guildId))) ban.scopes = ban.scopes.map((s) => (s === oldId ? newId : s));
  const progress = store.progressOf(guildId);
  for (const [key, entry] of Object.entries(progress)) {
    if (entry.typeId !== oldId) continue;
    delete progress[key];
    progress[`${entry.userId}:${newId}`] = { ...entry, typeId: newId };
  }
  save();
}

// Läuft gerade eine DM-Bewerbung dieser Art? Dann darf die ID nicht geändert und die Art nicht gelöscht werden.
function runningSessions(guildId, typeId) {
  const { sessions } = require('./flow');
  return [...sessions.values()].filter((s) => s.guildId === guildId && s.typeId === typeId).length;
}

function deleteType(guildId, id) {
  const types = typesCopy(guildId);
  if (!types.some((t) => t.id === id)) fail(`Die Bewerbungsart „${id}“ gibt es nicht mehr.`);
  const open = store.openOf(guildId, (r) => r.type === id);
  if (open.length) fail(`Es gibt noch ${open.length} offene Bewerbung(en) dieser Art (z. B. ${open[0].number}). Entscheide sie zuerst oder schließe die Art nur (aktiv: aus).`);
  if (runningSessions(guildId, id)) fail('Gerade füllt jemand diese Bewerbung aus. Versuche es später noch einmal oder schließe die Art zuerst.');
  const rest = types.filter((t) => t.id !== id);
  if (!rest.length) fail('Die letzte Bewerbungsart kann nicht gelöscht werden. Schließe sie stattdessen (aktiv: aus).');
  saveTypes(guildId, rest);
}

// Reihenfolge im Panel ändern: delta -1 = nach oben, +1 = nach unten.
function moveType(guildId, id, delta) {
  const types = typesCopy(guildId);
  const index = types.findIndex((t) => t.id === id);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= types.length) return;
  [types[index], types[target]] = [types[target], types[index]];
  saveTypes(guildId, types);
}

// ---------- Prüfschritte ----------

// Eine Zeile je Prüfschritt. Bestehende Schritte (gleicher Name) behalten ihre ID, damit offene Bewerbungen
// in diesem Schritt ihren Namen behalten.
function stagesFromLines(text, existing = []) {
  const labels = String(text ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (labels.length > 10) fail('Höchstens 10 Prüfschritte.');
  const used = new Set();
  return labels.map((label) => {
    if (label.length > 80) fail(`Der Prüfschritt „${label.slice(0, 30)}…“ ist zu lang (max. 80 Zeichen).`);
    const known = existing.find((s) => s.label.toLowerCase() === label.toLowerCase() && !used.has(s.id));
    let id = known?.id;
    if (!id) {
      const slug = label
        .toUpperCase()
        .replace(/Ä/g, 'AE')
        .replace(/Ö/g, 'OE')
        .replace(/Ü/g, 'UE')
        .replace(/ß/g, 'SS')
        .replace(/[^A-Z0-9]+/g, '_')
        .replace(/^_|_$/g, '')
        .slice(0, 30) || 'SCHRITT';
      id = `S_${slug}`;
      for (let n = 2; used.has(id) || existing.some((s) => s.id === id && s.label.toLowerCase() !== label.toLowerCase()); n++) id = `S_${slug}_${n}`;
    }
    used.add(id);
    return { id, label };
  });
}

// ---------- Fragen ----------

function questionKey(label, questions) {
  const slug =
    label
      .toLowerCase()
      .replace(/ä/g, 'ae')
      .replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue')
      .replace(/ß/g, 'ss')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 24) || 'frage';
  let key = slug;
  for (let n = 2; questions.some((q) => q.key === key); n++) key = `${slug}_${n}`;
  return key;
}

// Optionen aus einem Textfeld: eine je Zeile, optional „Name | Beschreibung“.
function optionsFromLines(text) {
  const options = String(text ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [label, description] = line.split('|').map((p) => p.trim());
      if (label.length > 100) fail(`Die Option „${label.slice(0, 30)}…“ ist zu lang (max. 100 Zeichen).`);
      return description ? { label, description: description.slice(0, 100) } : { label };
    });
  if (options.length > 25) fail('Höchstens 25 Optionen.');
  return options;
}

const optionsToLines = (options = []) => options.map((o) => (o.description ? `${o.label} | ${o.description}` : o.label)).join('\n');

// Ja/Nein-Eingaben aus Formularen: ja, j, yes, y, 1, true, x
const parseYes = (value, fallback) => {
  const v = String(value ?? '').trim().toLowerCase();
  if (!v) return fallback;
  if (['ja', 'j', 'yes', 'y', '1', 'true', 'x', 'an'].includes(v)) return true;
  if (['nein', 'n', 'no', '0', 'false', 'aus'].includes(v)) return false;
  fail(`„${value}“ verstehe ich nicht – bitte „ja“ oder „nein“.`);
};

function parseNumber(value, { min, max, name }) {
  const v = String(value ?? '').trim();
  if (!v) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) fail(`${name} muss eine ganze Zahl von ${min} bis ${max} sein.`);
  return n;
}

// ---------- Panels ----------

function savePanels(guildId, panels, types = store.types(guildId)) {
  check(types, panels);
  settings.set(guildId, 'applications.panels', panels);
}

function createPanel(guildId, { id, title }) {
  const panels = panelsCopy(guildId);
  id = String(id ?? '').trim().toLowerCase();
  if (!PANEL_ID.test(id)) fail('Die Panel-ID muss 2–24 Zeichen haben: Kleinbuchstaben, Zahlen, _ oder - (z. B. `fraktionen`).');
  if (panels[id]) fail(`Das Panel „${id}“ gibt es schon.`);
  panels[id] = normalizePanel({ title: title?.trim() || '📋 Bewerbung' });
  savePanels(guildId, panels);
  return panels[id];
}

function updatePanel(guildId, id, change) {
  const panels = panelsCopy(guildId);
  if (!panels[id]) fail(`Das Panel „${id}“ gibt es nicht mehr.`);
  panels[id] = normalizePanel(change(panels[id]) ?? panels[id]);
  if ((panels[id].title ?? '').length > 200 || !panels[id].title.trim()) fail('Der Titel muss 1–200 Zeichen haben.');
  if (panels[id].description.length > 3000) fail('Die Beschreibung darf höchstens 3000 Zeichen haben.');
  if (panels[id].image && !/^https?:\/\/\S+$/.test(panels[id].image)) fail('Das Bild muss eine URL sein (https://…).');
  savePanels(guildId, panels);
  return panels[id];
}

// Arten des gelöschten Panels wandern in das Panel moveTo.
function deletePanel(guildId, id, moveTo) {
  const panels = panelsCopy(guildId);
  if (!panels[id]) fail(`Das Panel „${id}“ gibt es nicht mehr.`);
  delete panels[id];
  if (!Object.keys(panels).length) fail('Das letzte Panel kann nicht gelöscht werden.');
  const types = typesCopy(guildId);
  const affected = types.filter((t) => t.panel === id);
  if (affected.length) {
    if (!moveTo || !panels[moveTo]) fail(`In diesem Panel sind noch ${affected.length} Bewerbungsart(en). Gib bei \`verschieben_nach\` ein anderes Panel an.`);
    for (const t of affected) t.panel = moveTo;
    check(types, panels);
    settings.set(guildId, 'applications.panels', panels);
    settings.set(guildId, 'applications.types', types);
  } else {
    savePanels(guildId, panels, types);
  }
  // Bereits gepostete Nachrichten dieses Panels zeigen ab jetzt einen Hinweis, dass es gelöscht wurde.
  return affected.length;
}

module.exports = {
  EditError,
  createType,
  updateType,
  deleteType,
  moveType,
  runningSessions,
  normalizeId,
  normalizePrefix,
  stagesFromLines,
  questionKey,
  optionsFromLines,
  optionsToLines,
  parseYes,
  parseNumber,
  createPanel,
  updatePanel,
  deletePanel,
  MAX_TYPES,
};
