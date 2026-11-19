const { Events } = require('discord.js');
const { setupGuild } = require('../lib/guilds');
const { leaveIfBlocked } = require('../lib/botAdmin');

// Bot wurde auf einen neuen Server eingeladen.
module.exports = {
  name: Events.GuildCreate,
  async execute(guild) {
    console.log(`➕ Neuer Server: „${guild.name}“ (${guild.id})`);
    if (await leaveIfBlocked(guild)) return; // im Admin-Bereich gesperrt
    await setupGuild(guild);
  },
};
