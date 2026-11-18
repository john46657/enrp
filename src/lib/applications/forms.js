// Fragetypen, Antwortprüfung und Text-Variablen der Bewerbungen.
const QUESTION_TYPES = {
  TEXT: 'Freitext',
  CHOICE: 'Auswahl',
  ROLE: 'Rollen-Auswahl',
  ROBLOX: 'Roblox-Benutzer',
};
const ROBLOX_NAME = /^[A-Za-z0-9_]{3,20}$/;

const optionValue = (option) => option.value ?? option.label;

// Gibt eine Fehlermeldung zurück oder null. `value` ist Text (TEXT/ROBLOX) oder eine Liste (CHOICE/ROLE).
function checkAnswer(question, value) {
  const empty = value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length);
  if (empty) return question.required === false ? null : 'Diese Frage ist Pflicht.';

  switch (question.type) {
    case 'TEXT': {
      const length = value.trim().length;
      if (question.min && length < question.min) return `Bitte schreibe mindestens ${question.min} Zeichen (aktuell ${length}).`;
      const max = Math.min(question.max ?? 5000, 5000);
      if (length > max) return `Bitte höchstens ${max} Zeichen (aktuell ${length}).`;
      return null;
    }
    case 'CHOICE':
    case 'ROLE': {
      const allowed = question.options.map(optionValue);
      if (value.some((v) => !allowed.includes(v))) return 'Ungültige Auswahl.';
      if (!question.multiple && value.length > 1) return 'Bitte nur eine Option wählen.';
      return null;
    }
    case 'ROBLOX':
      return ROBLOX_NAME.test(value.trim()) ? null : 'Das ist kein gültiger Roblox-Name (3–20 Zeichen, nur Buchstaben, Zahlen und _).';
    default:
      return `Unbekannter Fragetyp ${question.type}.`;
  }
}

const TYPE_ID = /^[a-z0-9_-]{2,24}$/;
const PANEL_ID = /^[a-z0-9_-]{2,24}$/;
const NUMBER_PREFIX = /^[A-Z0-9]{1,10}$/;
const RESERVED_STATUS = ['SUBMITTED', 'OPEN', 'ACCEPTED', 'REJECTED', 'WITHDRAWN'];
// Unicode-Emoji oder eigenes Server-Emoji <:name:id>
const EMOJI = /^(<a?:\w{2,32}:\d{15,25}>|[\p{Extended_Pictographic}\p{Regional_Indicator}#*0-9][\u{FE0F}\u{20E3}\u{200D}\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}]*)$/u;
const isEmoji = (value) => EMOJI.test(value ?? '');

// Prüft die Konfiguration einer Bewerbungsart; gibt eine Liste von Problemen zurück.
// panels: Liste der Panel-IDs dieses Servers (ohne Angabe wird das Panel nicht geprüft).
function validateType(type, { panels } = {}) {
  const problems = [];
  const id = type.id;
  if (!TYPE_ID.test(id ?? '')) problems.push(`ID „${id}“ muss 2–24 Zeichen a-z, 0-9, _ oder - haben`);
  if (!type.name?.trim() || type.name.length > 80) problems.push(`${id}: Name muss 1–80 Zeichen haben`);
  if (type.emoji && !isEmoji(type.emoji)) problems.push(`${id}: „${type.emoji}“ ist kein gültiges Emoji`);
  if ((type.description ?? '').length > 1000) problems.push(`${id}: Beschreibung höchstens 1000 Zeichen`);
  if (!NUMBER_PREFIX.test(type.numberPrefix ?? '')) problems.push(`${id}: Nummern-Präfix muss 1–10 Zeichen A-Z oder 0-9 haben`);
  if (!PANEL_ID.test(type.panel ?? '')) problems.push(`${id}: ungültiges Panel „${type.panel}“`);
  else if (panels && !panels.includes(type.panel)) problems.push(`${id}: Panel „${type.panel}“ gibt es nicht`);
  if (!['NONE', 'DENY', 'WITHDRAW'].includes(type.onLeave)) problems.push(`${id}: onLeave muss NONE, DENY oder WITHDRAW sein`);
  if (!(type.timeLimitMinutes >= 5 && type.timeLimitMinutes <= 10_080)) problems.push(`${id}: timeLimitMinutes muss zwischen 5 und 10080 liegen`);
  if (!(type.cooldownMinutes >= 0 && type.cooldownMinutes <= 525_600)) problems.push(`${id}: cooldownMinutes muss zwischen 0 und 525600 liegen`);
  for (const [key, text] of Object.entries(type.messages ?? {})) {
    if (typeof text !== 'string' || !text.trim() || text.length > 2000) problems.push(`${id}: Text „${key}“ muss 1–2000 Zeichen haben`);
  }

  const stageIds = new Set();
  if (!Array.isArray(type.stages) || type.stages.length > 10) problems.push(`${id}: höchstens 10 Prüfschritte`);
  for (const stage of type.stages ?? []) {
    if (!/^[A-Z0-9_]{1,40}$/.test(stage.id ?? '') || RESERVED_STATUS.includes(stage.id) || stageIds.has(stage.id)) problems.push(`${id}: ungültiger Prüfschritt ${stage.id}`);
    if (!stage.label?.trim() || stage.label.length > 80) problems.push(`${id}: Prüfschritt ${stage.id} braucht einen Namen (max. 80 Zeichen)`);
    stageIds.add(stage.id);
  }

  if (!type.questions?.length) problems.push(`${id}: keine Fragen`);
  if (type.questions?.length > 50) problems.push(`${id}: höchstens 50 Fragen`);
  const keys = new Set();
  for (const q of type.questions ?? []) {
    if (!q.key || keys.has(q.key)) problems.push(`${id}: Frage ohne oder mit doppeltem key (${q.key})`);
    keys.add(q.key);
    if (!QUESTION_TYPES[q.type]) problems.push(`${id}/${q.key}: unbekannter Typ ${q.type}`);
    if (!q.label?.trim()) problems.push(`${id}/${q.key}: label fehlt`);
    else if (q.label.length > 250) problems.push(`${id}/${q.key}: Frage höchstens 250 Zeichen`);
    if (q.type === 'TEXT' && q.min && q.max && q.min > q.max) problems.push(`${id}/${q.key}: min ist größer als max`);
    if (['CHOICE', 'ROLE'].includes(q.type)) {
      if (!q.options?.length || q.options.length > 25) problems.push(`${id}/${q.key}: 1–25 Optionen nötig`);
      if (q.type === 'ROLE' && q.options?.some((o) => !o.roleId)) problems.push(`${id}/${q.key}: jede Option braucht eine roleId`);
      const values = (q.options ?? []).map(optionValue);
      if (new Set(values).size !== values.length) problems.push(`${id}/${q.key}: doppelte Optionen`);
      if (values.some((v) => !v || String(v).length > 100)) problems.push(`${id}/${q.key}: Optionen müssen 1–100 Zeichen haben`);
    }
  }
  return problems;
}

function formatDuration(minutes) {
  if (minutes < 60) return `${minutes} Minuten`;
  if (minutes < 1440) {
    const hours = Math.round((minutes / 60) * 10) / 10;
    return `${String(hours).replace('.', ',')} ${hours === 1 ? 'Stunde' : 'Stunden'}`;
  }
  const days = Math.round((minutes / 1440) * 10) / 10;
  return `${String(days).replace('.', ',')} ${days === 1 ? 'Tag' : 'Tage'}`;
}

// Ersetzt {applicationName} {user} {applicant} {number} {reason} {questionCount} {timeLimit}.
// Fehlt {reason} im Text, wird ein vorhandener Grund angehängt.
function renderMessage(template, vars) {
  let text = template.replace(/\{(\w+)\}/g, (match, key) => (vars[key] !== undefined && vars[key] !== null ? String(vars[key]) : match === '{reason}' ? '' : match));
  if (vars.reason && !template.includes('{reason}')) text += `\n**Grund:** ${vars.reason}`;
  return text;
}

module.exports = { QUESTION_TYPES, TYPE_ID, PANEL_ID, NUMBER_PREFIX, checkAnswer, validateType, isEmoji, formatDuration, renderMessage, optionValue };
