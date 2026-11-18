// Bewerbungsarten und Fragen selbst anlegen, ändern und löschen (je Server, gespeichert in data/db.json).
// Jede Funktion gibt { error } oder { type, … } zurück. Geändert wird erst, wenn die Prüfung bestanden ist.
const settings = require('../settings');
const { merge } = require('./normalize');
const { validateType } = require('./forms');
const store = require('./store');
const panels = require('./panels');

const MAX_QUESTIONS = 50;
const MAX_TYPES = 25; // so viele passen in ein Auswahlmenü

// "Streife & Verkehr" → "streife-verkehr"
function slugify(name) {
  return name
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
    .replace(/-+$/, '');
}

// Kürzel für die Bewerbungsnummer aus dem Namen, z. B. "Flugstaffel" → "FLUG"
function prefixFrom(name) {
  const letters = name
    .normalize('NFD')
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase();
  return letters.slice(0, 4) || 'BW';
}

function uniqueId(guildId, name) {
  const taken = new Set(store.allTypes(guildId).map((t) => t.id));
  const slug = slugify(name);
  const base = slug.length >= 2 ? slug : 'bewerbung';
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base.slice(0, 24 - String(n).length - 1).replace(/-+$/, '')}-${n}`;
  return id;
}

const ownTypes = (guildId) => settings.ownAppTypes(guildId);

function findOwn(guildId, typeId) {
  const raw = ownTypes(guildId).find((t) => t.id === typeId && !t.archived);
  if (raw) return { raw };
  if (store.types(guildId).some((t) => t.id === typeId)) {
    return { error: 'Diese Bewerbung steht fest in der config.json und kann nur dort geändert werden.' };
  }
  return { error: 'Diese Bewerbung gibt es nicht. Wähle sie aus der Liste aus.' };
}

// Änderung an einer Kopie ausprobieren, prüfen und erst dann übernehmen.
function commit(guildId, typeId, change) {
  const found = findOwn(guildId, typeId);
  if (found.error) return found;
  const draft = structuredClone(found.raw);
  const error = change(draft);
  if (error) return { error };
  const problems = validateType(merge(settings.forGuild(guildId).applications.defaults, draft), { allowEmpty: true });
  if (problems.length) return { error: problems.join('\n') };
  Object.keys(found.raw).forEach((key) => delete found.raw[key]);
  Object.assign(found.raw, draft);
  settings.saveAppTypes(guildId);
  return { type: store.typeById(guildId, typeId) };
}

// Nur Felder übernehmen, die angegeben wurden (undefined = unverändert).
function assignDefined(target, fields) {
  for (const [key, value] of Object.entries(fields)) if (value !== undefined) target[key] = value;
}

// ---------- Bewerbungsarten ----------

function createType(guildId, { name, emoji, description, workflow, numberPrefix }) {
  if (!name?.trim()) return { error: 'Bitte gib einen Namen an.' };
  if (store.types(guildId).length >= MAX_TYPES) return { error: `Es sind höchstens ${MAX_TYPES} Bewerbungen möglich. Lösche zuerst eine.` };
  if (store.types(guildId).some((t) => t.name.toLowerCase() === name.trim().toLowerCase())) {
    return { error: `Es gibt schon eine Bewerbung „${name.trim()}“.` };
  }
  const raw = {
    id: uniqueId(guildId, name),
    name: name.trim(),
    emoji: emoji?.trim() || '📝',
    description: description?.trim() ?? '',
    panel: 'apply', // nur noch für den Standard-Kanal (applications.channel); sichtbar wird sie über Panels
    workflow: workflow ?? 'simple',
    numberPrefix: (numberPrefix?.trim() || prefixFrom(name)).toUpperCase(),
    questions: [],
    createdAt: Date.now(),
  };
  const problems = validateType(merge(settings.forGuild(guildId).applications.defaults, raw), { allowEmpty: true });
  if (problems.length) return { error: problems.join('\n') };
  panels.panelsOf(guildId); // alte feste Panels vorher übernehmen, sonst landet die neue Bewerbung darin
  ownTypes(guildId).push(raw);
  settings.saveAppTypes(guildId);
  const panel = panels.addTypeToDefault(guildId, raw.id);
  return { type: store.typeById(guildId, raw.id), panel };
}

function updateType(guildId, typeId, fields) {
  const result = commit(guildId, typeId, (draft) => {
    const clean = { ...fields };
    if (clean.name !== undefined) {
      clean.name = clean.name.trim();
      if (store.types(guildId).some((t) => t.id !== typeId && t.name.toLowerCase() === clean.name.toLowerCase())) {
        return `Es gibt schon eine Bewerbung „${clean.name}“.`;
      }
    }
    if (clean.numberPrefix !== undefined) clean.numberPrefix = clean.numberPrefix.trim().toUpperCase();
    if (clean.description !== undefined) clean.description = clean.description.trim() === '-' ? '' : clean.description.trim();
    assignDefined(draft, clean);
    return null;
  });
  // Ein per /einstellungen gespeicherter Wert würde den neuen sonst überdecken.
  if (!result.error) {
    for (const key of ['panel', 'enabled', 'workflow']) if (fields[key] !== undefined) settings.unset(guildId, `applications.types.${typeId}.${key}`);
  }
  return result.error ? result : { type: store.typeById(guildId, typeId) };
}

// Mit alten Bewerbungen wird die Art nur archiviert (damit diese lesbar bleiben), sonst ganz entfernt.
function deleteType(guildId, typeId) {
  const found = findOwn(guildId, typeId);
  if (found.error) return found;
  const open = store.openOf(guildId, (r) => r.type === typeId);
  if (open.length) return { error: `Es gibt noch ${open.length} offene Bewerbung(en) dafür (z. B. ${open[0].number}). Entscheide sie zuerst.` };
  const running = Object.values(store.progressOf(guildId)).filter((p) => p.typeId === typeId && p.expiresAt > Date.now());
  if (running.length) return { error: `Gerade füllt ${running.length} Person(en) diese Bewerbung aus. Versuche es später noch einmal.` };

  const name = found.raw.name;
  const hasRecords = Object.values(store.recordsOf(guildId)).some((r) => r.type === typeId);
  if (hasRecords) {
    found.raw.archived = true;
    found.raw.archivedAt = Date.now();
  } else {
    const list = ownTypes(guildId);
    list.splice(list.indexOf(found.raw), 1);
  }
  settings.dropAppTypeOverrides(guildId, typeId);
  panels.removeTypeEverywhere(guildId, typeId);
  return { name, archived: hasRecords };
}

function setMessages(guildId, typeId, messages) {
  return commit(guildId, typeId, (draft) => {
    draft.messages = { ...draft.messages };
    for (const [key, value] of Object.entries(messages)) {
      // Leer = wieder den Standardtext verwenden
      if (value?.trim()) draft.messages[key] = value.trim();
      else delete draft.messages[key];
    }
    if (!Object.keys(draft.messages).length) delete draft.messages;
    return null;
  });
}

// ---------- Fragen ----------

function nextKey(questions) {
  const used = new Set(questions.map((q) => q.key));
  let n = questions.length + 1;
  while (used.has(`f${n}`)) n++;
  return `f${n}`;
}

// fields: { type, label, description, required, min, max, options, multiple }
function cleanQuestion(question) {
  if (question.type !== 'TEXT') {
    delete question.min;
    delete question.max;
  }
  if (!['CHOICE', 'ROLE'].includes(question.type)) {
    delete question.options;
    delete question.multiple;
  }
  if (question.type === 'TEXT' && question.min && question.max && question.min > question.max) return 'Die Mindestlänge ist größer als die Höchstlänge.';
  if (question.description === '') delete question.description;
  return null;
}

function addQuestion(guildId, typeId, fields, position) {
  return commit(guildId, typeId, (draft) => {
    if (draft.questions.length >= MAX_QUESTIONS) return `Es sind höchstens ${MAX_QUESTIONS} Fragen möglich.`;
    if (['CHOICE', 'ROLE'].includes(fields.type) && !fields.options?.length) {
      return fields.type === 'ROLE'
        ? 'Gib bei `optionen` die Rollen an, z. B. `@Streife; @Verkehr`.'
        : 'Gib bei `optionen` die Antworten an, getrennt mit `;`, z. B. `Täglich; Mehrmals pro Woche; Selten`.';
    }
    if (fields.type === 'ROBLOX' && draft.questions.some((q) => q.type === 'ROBLOX')) return 'Es gibt schon eine Roblox-Frage.';
    const question = { key: nextKey(draft.questions), required: true };
    assignDefined(question, fields);
    const error = cleanQuestion(question);
    if (error) return error;
    const index = position ? Math.min(Math.max(position - 1, 0), draft.questions.length) : draft.questions.length;
    draft.questions.splice(index, 0, question);
    return null;
  });
}

const questionAt = (draft, number) => draft.questions[number - 1] ?? null;

const noQuestion = (draft, number) => `Frage ${number} gibt es nicht (es gibt ${draft.questions.length}).`;

function updateQuestion(guildId, typeId, number, fields) {
  return commit(guildId, typeId, (draft) => {
    const question = questionAt(draft, number);
    if (!question) return noQuestion(draft, number);
    if (fields.type === 'ROBLOX' && question.type !== 'ROBLOX' && draft.questions.some((q) => q.type === 'ROBLOX')) return 'Es gibt schon eine Roblox-Frage.';
    assignDefined(question, fields);
    if (['CHOICE', 'ROLE'].includes(question.type) && !question.options?.length) return 'Diese Frage braucht `optionen`.';
    if (question.type === 'ROLE' && question.options.some((o) => !o.roleId)) return 'Bei einer Rollen-Auswahl müssen die `optionen` Rollen sein, z. B. `@Streife; @Verkehr`.';
    return cleanQuestion(question);
  });
}

function removeQuestion(guildId, typeId, number) {
  let removed;
  const result = commit(guildId, typeId, (draft) => {
    if (!questionAt(draft, number)) return noQuestion(draft, number);
    [removed] = draft.questions.splice(number - 1, 1);
    return null;
  });
  return result.error ? result : { ...result, removed };
}

function moveQuestion(guildId, typeId, number, position) {
  return commit(guildId, typeId, (draft) => {
    if (!questionAt(draft, number)) return noQuestion(draft, number);
    const [question] = draft.questions.splice(number - 1, 1);
    draft.questions.splice(Math.min(Math.max(position - 1, 0), draft.questions.length), 0, question);
    return null;
  });
}

// Alle Fragen auf einmal ersetzen (Web-Dashboard). Unbekannte Felder werden verworfen.
function setQuestions(guildId, typeId, list) {
  if (!Array.isArray(list)) return { error: 'Ungültige Fragen.' };
  if (list.length > MAX_QUESTIONS) return { error: `Es sind höchstens ${MAX_QUESTIONS} Fragen möglich.` };
  const questions = [];
  for (const [i, input] of list.entries()) {
    const n = i + 1;
    const type = String(input?.type ?? '');
    if (!['TEXT', 'CHOICE', 'ROLE', 'ROBLOX'].includes(type)) return { error: `Frage ${n}: unbekannter Typ.` };
    const label = String(input.label ?? '').trim();
    if (!label) return { error: `Frage ${n}: Der Fragetext fehlt.` };
    if (label.length > 250) return { error: `Frage ${n}: höchstens 250 Zeichen.` };
    const question = { key: /^[a-z0-9_]{1,32}$/.test(input.key ?? '') && !questions.some((q) => q.key === input.key) ? input.key : null, type, label, required: input.required !== false };
    const description = String(input.description ?? '').trim();
    if (description) question.description = description.slice(0, 500);
    if (type === 'TEXT') {
      const min = Number(input.min) || 0;
      const max = Number(input.max) || 1000;
      if (min < 0 || max < 1 || max > 5000 || min > max) return { error: `Frage ${n}: Die Länge muss zwischen 0 und 5000 liegen, Minimum ≤ Maximum.` };
      if (min) question.min = min;
      question.max = max;
    }
    if (type === 'CHOICE' || type === 'ROLE') {
      const options = (Array.isArray(input.options) ? input.options : [])
        .map((o) => ({ label: String(o?.label ?? '').trim().slice(0, 100), ...(type === 'ROLE' ? { roleId: String(o?.roleId ?? '') } : {}) }))
        .filter((o) => o.label);
      if (!options.length || options.length > 25) return { error: `Frage ${n}: 1–25 Antworten nötig.` };
      if (new Set(options.map((o) => o.label.toLowerCase())).size !== options.length) return { error: `Frage ${n}: Jede Antwort darf nur einmal vorkommen.` };
      if (type === 'ROLE' && options.some((o) => !/^\d{17,20}$/.test(o.roleId))) return { error: `Frage ${n}: Jede Antwort braucht eine Rolle.` };
      question.options = options;
      question.multiple = Boolean(input.multiple);
    }
    questions.push(question);
  }
  if (questions.filter((q) => q.type === 'ROBLOX').length > 1) return { error: 'Es darf nur eine Roblox-Frage geben.' };
  for (const question of questions) question.key ??= nextKey(questions.filter((q) => q.key));
  return commit(guildId, typeId, (draft) => {
    draft.questions = questions;
    return null;
  });
}

module.exports = {
  setQuestions,
  MAX_QUESTIONS,
  slugify,
  prefixFrom,
  createType,
  updateType,
  deleteType,
  setMessages,
  addQuestion,
  updateQuestion,
  removeQuestion,
  moveQuestion,
};
