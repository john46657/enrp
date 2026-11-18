// Autovervollständigung für Bewerbungsarten und Panels in Slash-Befehlen.
// Die Auswahl kommt aus den Einstellungen des jeweiligen Servers, damit auch in Discord angelegte Arten erscheinen.
const { forGuild } = require('../settings');
const store = require('./store');

const TYPE_OPTIONS = ['art', 'kopie_von'];
const PANEL_OPTIONS = ['panel', 'verschieben_nach'];

function matches(query, ...texts) {
  const q = query.trim().toLowerCase();
  return !q || texts.some((t) => String(t ?? '').toLowerCase().includes(q));
}

// Liefert die Vorschläge (ohne zu antworten), damit es sich ohne Discord testen lässt.
function suggestions(guildId, optionName, query = '') {
  if (TYPE_OPTIONS.includes(optionName) || optionName === 'bereich') {
    const list = store
      .types(guildId)
      .filter((t) => matches(query, t.id, t.name))
      .map((t) => ({ name: `${t.name} (${t.id})${t.enabled ? '' : ' – geschlossen'}`.slice(0, 100), value: t.id }));
    if (optionName === 'bereich' && matches(query, 'alle', '*')) list.unshift({ name: 'Alle Bewerbungen', value: '*' });
    return list.slice(0, 25);
  }
  if (PANEL_OPTIONS.includes(optionName)) {
    return Object.entries(forGuild(guildId).applications.panels)
      .filter(([id, p]) => matches(query, id, p.title))
      .map(([id, p]) => ({ name: `${p.title} (${id})`.slice(0, 100), value: id }))
      .slice(0, 25);
  }
  return [];
}

async function respond(interaction) {
  const focused = interaction.options.getFocused(true);
  await interaction.respond(suggestions(interaction.guildId, focused.name, focused.value));
}

module.exports = { respond, suggestions };
