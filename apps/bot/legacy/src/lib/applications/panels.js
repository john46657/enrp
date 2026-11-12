// Bewerbungs-Panels als eigene Objekte: Titel, Text, Bild und welche Bewerbungen darin auswählbar sind.
// Gespeichert je Server in data/db.json unter appPanelDefs. Gepostete Nachrichten stehen unter appPanels.
const { data, bucket, save, nextNumber } = require('../db');
const { forGuild } = require('../settings');
const store = require('./store');

const IMAGE_URL = /^https?:\/\/\S+$/;

// Früher gab es genau zwei feste Panels („apply“ und „quali“). Sie werden beim ersten Zugriff zu Panel-Objekten.
function migrate(guildId) {
  const defs = [];
  const posted = Object.values(bucket('appPanels', guildId));
  const panels = forGuild(guildId).applications.panels ?? {};
  for (const [kind, name] of [
    ['apply', 'Bewerbungen'],
    ['quali', 'Einheiten & Qualifikationen'],
  ]) {
    const types = store.types(guildId).filter((t) => t.panel === kind).map((t) => t.id);
    if (!types.length && !posted.some((p) => p.kind === kind)) continue;
    const old = panels[kind] ?? {};
    defs.push({ id: kind, name, title: old.title ?? name, description: old.description ?? '', image: old.image ?? '', types, createdAt: Date.now() });
  }
  return defs;
}

function panelsOf(guildId) {
  data.appPanelDefs ??= {};
  if (!data.appPanelDefs[guildId]) {
    data.appPanelDefs[guildId] = migrate(guildId);
    save();
  }
  return data.appPanelDefs[guildId];
}

const getPanel = (guildId, panelId) => panelsOf(guildId).find((p) => p.id === panelId) ?? null;

// Bewerbungen eines Panels, die gerade auswählbar sind (vorhanden und mit Fragen).
const activeTypes = (guildId, panel) =>
  panel.types
    .map((id) => store.typeById(guildId, id))
    .filter((t) => t && !t.archived && t.questions.length);

// Gepostete Nachrichten eines Panels: [{ messageId, channelId }]
const postsOf = (guildId, panelId) =>
  Object.entries(bucket('appPanels', guildId))
    .filter(([, p]) => p.kind === panelId)
    .map(([messageId, p]) => ({ messageId, channelId: p.channelId }));

function clean(guildId, fields, current) {
  const panel = { ...current };
  for (const key of ['name', 'title', 'description', 'image']) {
    if (fields[key] !== undefined && fields[key] !== null) panel[key] = String(fields[key]).trim();
  }
  if (fields.types !== undefined) {
    const known = new Set(store.types(guildId).map((t) => t.id));
    const types = [...new Set(fields.types)];
    const unknown = types.filter((id) => !known.has(id));
    if (unknown.length) return { error: `Unbekannte Bewerbung(en): ${unknown.join(', ')}` };
    if (types.length > 25) return { error: 'Ein Panel kann höchstens 25 Bewerbungen enthalten.' };
    panel.types = types;
  }
  if (!panel.name) return { error: 'Das Panel braucht einen Namen.' };
  if (panel.name.length > 80) return { error: 'Der Name darf höchstens 80 Zeichen haben.' };
  if (panel.title.length > 200) return { error: 'Der Titel darf höchstens 200 Zeichen haben.' };
  if (panel.description.length > 2000) return { error: 'Die Beschreibung darf höchstens 2000 Zeichen haben.' };
  if (panel.image && !IMAGE_URL.test(panel.image)) return { error: 'Das Bild muss eine URL sein (https://…).' };
  if (panelsOf(guildId).some((p) => p.id !== panel.id && p.name.toLowerCase() === panel.name.toLowerCase())) {
    return { error: `Es gibt schon ein Panel „${panel.name}“.` };
  }
  return { panel };
}

// Ein Panel braucht mindestens eine Bewerbung auf dem Server (wie im Dashboard).
function createPanel(guildId, fields) {
  if (!store.types(guildId).length) return { error: 'Du brauchst mindestens eine Bewerbung, um ein Panel zu erstellen.' };
  const base = { id: `p${nextNumber('appPanel', guildId)}`, name: '', title: '', description: '', image: '', types: [], createdAt: Date.now() };
  const result = clean(guildId, { ...fields, title: fields.title || fields.name }, base);
  if (result.error) return result;
  panelsOf(guildId).push(result.panel);
  save();
  return result;
}

function updatePanel(guildId, panelId, fields) {
  const list = panelsOf(guildId);
  const index = list.findIndex((p) => p.id === panelId);
  if (index < 0) return { error: 'Dieses Panel gibt es nicht.' };
  const result = clean(guildId, fields, list[index]);
  if (result.error) return result;
  list[index] = result.panel;
  save();
  return result;
}

// Gibt die geposteten Nachrichten zurück, damit der Aufrufer sie in Discord löschen kann.
function deletePanel(guildId, panelId) {
  const list = panelsOf(guildId);
  const index = list.findIndex((p) => p.id === panelId);
  if (index < 0) return { error: 'Dieses Panel gibt es nicht.' };
  const [panel] = list.splice(index, 1);
  const posts = postsOf(guildId, panelId);
  const stored = bucket('appPanels', guildId);
  for (const { messageId } of posts) delete stored[messageId];
  save();
  return { panel, posts };
}

// Wird eine Bewerbung gelöscht, verschwindet sie aus allen Panels.
function removeTypeEverywhere(guildId, typeId) {
  for (const panel of panelsOf(guildId)) panel.types = panel.types.filter((id) => id !== typeId);
  save();
}

// Neue Bewerbung: automatisch ins erste Panel, damit sie ohne weiteren Schritt erscheint.
function addTypeToDefault(guildId, typeId) {
  const [first] = panelsOf(guildId);
  if (first && !first.types.includes(typeId) && first.types.length < 25) {
    first.types.push(typeId);
    save();
  }
  return first ?? null;
}

module.exports = { panelsOf, getPanel, activeTypes, postsOf, createPanel, updatePanel, deletePanel, removeTypeEverywhere, addTypeToDefault };
