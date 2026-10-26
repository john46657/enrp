// Rollen vergeben/entfernen, ohne dass ein einzelner Fehler (z. B. Rolle zu hoch) den Rest abbricht.
async function applyRoles(member, { add = [], remove = [] }, reason) {
  if (!member) return;
  const adds = [...new Set(add)].filter((id) => id && !member.roles.cache.has(id));
  const removes = [...new Set(remove)].filter((id) => id && member.roles.cache.has(id) && !adds.includes(id));
  for (const id of adds) await member.roles.add(id, reason).catch((err) => console.error(`[bewerbung] Rolle ${id} geben:`, err.message));
  for (const id of removes) await member.roles.remove(id, reason).catch((err) => console.error(`[bewerbung] Rolle ${id} nehmen:`, err.message));
}

module.exports = { applyRoles };
