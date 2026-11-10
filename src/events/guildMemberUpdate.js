const { Events } = require('discord.js');
const rights = require('../lib/roblox/rights');

// Rollen geändert (z. B. Bewerbung angenommen, degradiert) → Spielrechte im Privatserver abgleichen.
// Nur Privatserver-Discords; der Abgleich prüft selbst, ob sich wirklich etwas geändert hat.
module.exports = {
  name: Events.GuildMemberUpdate,
  execute(oldMember, newMember) {
    rights.scheduleSync(newMember.guild, newMember.id);
  },
};
