// Auswahl der Bewerbungsart in Slash-Befehlen. Weil jeder Server eigene Arten haben kann, kommt die Liste
// per Autocomplete statt als feste Auswahl.
const store = require('./store');

// Vorschläge passend zur bisherigen Eingabe; extra = zusätzliche feste Einträge (z. B. „Alle Bewerbungen“).
function suggest(entries, query) {
  const q = String(query ?? '').trim().toLowerCase();
  return entries.filter((e) => !q || e.name.toLowerCase().includes(q) || e.value.toLowerCase().includes(q)).slice(0, 25);
}

function respondTypes(interaction, { extra = [], filter = () => true } = {}) {
  const types = store.types(interaction.guildId).filter(filter).map((t) => ({ name: `${t.name}`.slice(0, 100), value: t.id }));
  return interaction.respond(suggest([...extra, ...types], interaction.options.getFocused()));
}

// Findet die Art auch, wenn jemand den Namen statt des Schlüssels eingetippt hat.
function findType(guildId, input) {
  if (!input) return null;
  const text = input.trim().toLowerCase();
  return store.types(guildId).find((t) => t.id === text) ?? store.types(guildId).find((t) => t.name.toLowerCase() === text) ?? null;
}

module.exports = { suggest, respondTypes, findType };
