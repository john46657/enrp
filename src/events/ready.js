const { Events, ActivityType } = require('discord.js');
const config = require('../../config.json');
const { fetchFivemStatus } = require('../lib/fivem');
const { startTicketWatcher, refreshPanels } = require('../lib/tickets');

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    console.log(`✅ Eingeloggt als ${client.user.tag}`);

    // Slash-Commands registrieren: mit GUILD_ID sofort auf diesem Server, sonst global (dauert bis zu 1 h).
    const body = client.commands.map((c) => c.data.toJSON());
    const guildId = process.env.GUILD_ID;
    await client.application.commands.set(body, ...(guildId ? [guildId] : []));
    console.log(`✅ ${body.length} Slash-Commands ${guildId ? `auf Server ${guildId}` : 'global'} registriert`);

    for (const [section, values] of Object.entries({ channels: config.channels, roles: config.roles })) {
      const missing = Object.keys(values).filter((key) => !values[key]);
      if (missing.length) console.warn(`⚠️  config.json → ${section}: noch nicht eingetragen: ${missing.join(', ')}`);
    }

    // Ticket-Panels nach einem Neustart auf den aktuellen Stand bringen.
    for (const guild of client.guilds.cache.values()) await refreshPanels(guild);
    startTicketWatcher(client);

    const updatePresence = async () => {
      if (!config.fivem.address) {
        client.user.setActivity(config.serverName, { type: ActivityType.Watching });
        return;
      }
      const status = await fetchFivemStatus();
      client.user.setActivity(status.online ? `${status.players}/${status.maxPlayers} Spieler online` : 'Server offline', {
        type: ActivityType.Watching,
      });
    };
    await updatePresence();
    if (config.fivem.address) setInterval(updatePresence, 60_000);
  },
};
