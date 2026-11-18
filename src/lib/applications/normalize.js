// Ergänzt jede Bewerbungsart in config.applications.types um die Standardwerte aus applications.defaults
// und jedes Panel um seine Standardfelder.
const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

// Prüfschritte der früheren Polizei-Bewerbung (workflow: "police").
const POLICE_STAGES = [
  { id: 'SCREENING', label: 'In Prüfung' },
  { id: 'INTERVIEW', label: 'Gespräch' },
  { id: 'PENDING_DECISION', label: 'Entscheidung ausstehend' },
];

const PANEL_DEFAULTS = { title: '📋 Bewerbung', description: '', image: '', placeholder: '', channel: '', showList: true };

function merge(base, own) {
  const result = structuredClone(base);
  for (const [key, value] of Object.entries(own)) {
    result[key] = isObject(value) && isObject(result[key]) ? merge(result[key], value) : value;
  }
  return result;
}

function normalizeType(type, defaults = {}) {
  const result = merge(defaults, type);
  // Früher gab es nur "police" (drei feste Prüfschritte) und "simple" (keine).
  if (!Array.isArray(result.stages)) result.stages = result.workflow === 'police' ? structuredClone(POLICE_STAGES) : [];
  result.questions ??= [];
  return result;
}

function normalizePanel(panel) {
  return { ...PANEL_DEFAULTS, ...panel };
}

function normalize(config) {
  const apps = config.applications;
  if (!apps) return;
  apps.types = apps.types.map((type) => normalizeType(type, apps.defaults));
  apps.panels = Object.fromEntries(Object.entries(apps.panels ?? {}).map(([id, panel]) => [id, normalizePanel(panel)]));
}

module.exports = normalize;
module.exports.normalizeType = normalizeType;
module.exports.normalizePanel = normalizePanel;
module.exports.POLICE_STAGES = POLICE_STAGES;
module.exports.PANEL_DEFAULTS = PANEL_DEFAULTS;
