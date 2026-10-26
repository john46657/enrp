// Zentrale Markenangaben von Emden Network. Name, Produktbezeichnungen und Logo stehen nur in
// config.json → branding; alle Module holen sie von hier, damit eine Änderung an einer Stelle reicht.
const config = require('../../config.json');

const branding = config.branding ?? {};

function name() {
  return branding.name || 'Emden Network';
}

// Produktname, z. B. product('dashboard') → "Emden Network Control Center".
function product(key) {
  const template = branding.products?.[key] ?? '{name}';
  return template.replace(/\{name\}/g, name());
}

// Fußzeile für Embeds; das Logo erscheint nur, wenn eine öffentliche Bild-URL eingetragen ist.
function footer(extra) {
  return {
    text: extra ? `${name()} · ${extra}` : name(),
    iconURL: branding.logoUrl || undefined,
  };
}

function color(key = 'primary') {
  return config.colors[key] ?? key;
}

// "#2F7DF6" → 0x2F7DF6 für Components V2 (setAccentColor)
function colorInt(key = 'primary') {
  return parseInt(color(key).slice(1), 16);
}

module.exports = { name, product, footer, color, colorInt };
