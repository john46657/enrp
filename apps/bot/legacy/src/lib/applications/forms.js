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

// Prüft die Konfiguration einer Bewerbungsart; gibt eine Liste von Problemen zurück.
function validateType(type) {
  const problems = [];
  if (!/^[a-z0-9_-]{2,24}$/.test(type.id)) problems.push(`Schlüssel „${type.id}“ muss 2–24 Zeichen a-z, 0-9, _ oder - haben`);
  if (!['apply', 'quali'].includes(type.panel)) problems.push(`${type.id}: panel muss "apply" oder "quali" sein`);
  if (!['police', 'simple'].includes(type.workflow)) problems.push(`${type.id}: workflow muss "police" oder "simple" sein`);
  if (!['NONE', 'DENY', 'WITHDRAW'].includes(type.onLeave)) problems.push(`${type.id}: onLeave muss NONE, DENY oder WITHDRAW sein`);
  if (type.timeLimitMinutes < 5 || type.timeLimitMinutes > 10_080) problems.push(`${type.id}: timeLimitMinutes muss zwischen 5 und 10080 liegen`);
  if (!type.questions.length) problems.push(`${type.id}: keine Fragen`);
  if (type.questions.length > 50) problems.push(`${type.id}: höchstens 50 Fragen`);
  const keys = new Set();
  for (const q of type.questions) {
    if (!q.key || keys.has(q.key)) problems.push(`${type.id}: Frage ohne oder mit doppeltem key (${q.key})`);
    keys.add(q.key);
    if (!QUESTION_TYPES[q.type]) problems.push(`${type.id}/${q.key}: unbekannter Typ ${q.type}`);
    if (!q.label) problems.push(`${type.id}/${q.key}: label fehlt`);
    if (['CHOICE', 'ROLE'].includes(q.type)) {
      if (!q.options?.length || q.options.length > 25) problems.push(`${type.id}/${q.key}: 1–25 Optionen nötig`);
      if (q.type === 'ROLE' && q.options?.some((o) => !o.roleId)) problems.push(`${type.id}/${q.key}: jede Option braucht eine roleId`);
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

module.exports = { QUESTION_TYPES, checkAnswer, validateType, formatDuration, renderMessage, optionValue };
