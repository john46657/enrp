const { Events } = require('discord.js');
const { setupGuild } = require('../lib/guilds');

// Bot wurde auf einen neuen Server eingeladen.
module.exports = {
  name: Events.GuildCreate,
  async execute(guild) {
    console.log(`➕ Neuer Server: „${guild.name}“ (${guild.id})`);
    await setupGuild(guild);
  },
};
