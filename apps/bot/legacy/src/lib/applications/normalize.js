// Ergänzt Bewerbungsarten um die Standardwerte aus applications.defaults.
const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

function merge(base, own) {
  const result = structuredClone(base);
  for (const [key, value] of Object.entries(own)) {
    result[key] = isObject(value) && isObject(result[key]) ? merge(result[key], value) : structuredClone(value);
  }
  return result;
}

function normalize(config) {
  const apps = config.applications;
  if (!apps) return;
  apps.types = (apps.types ?? []).map((type) => merge(apps.defaults, type));
}

module.exports = normalize;
module.exports.merge = merge;
