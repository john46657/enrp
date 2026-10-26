const { Events, ActivityType } = require('discord.js');
const config = require('../../config.json');
const branding = require('../lib/branding');
const { fetchFivemStatus } = require('../lib/fivem');
const { startTicketWatcher, refreshPanels } = require('../lib/tickets');
const appStore = require('../lib/applications/store');
const appMessages = require('../lib/applications/messages');
const { sweep } = require('../lib/applications/flow');
const { validateType } = require('../lib/applications/forms');

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    console.log(`✅ ${branding.product('bot')} ist online als ${client.user.tag}`);

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

    // Bewerbungen: laufende DM-Bewerbungen gehen bei einem Neustart verloren
    appStore.resetProgress();
    for (const problem of appStore.types().flatMap(validateType)) console.warn(`⚠️  Bewerbung: ${problem}`);
    for (const guild of client.guilds.cache.values()) await appMessages.refreshPanels(guild);
    setInterval(() => sweep(client).catch((err) => console.error('[bewerbung]', err)), 60_000);

    const updatePresence = async () => {
      if (!config.fivem.address) {
        client.user.setActivity(branding.name(), { type: ActivityType.Watching });
        return;
      }
      const status = await fetchFivemStatus();
      client.user.setActivity(status.online ? `${status.players}/${status.maxPlayers} Spieler online` : 'Server offline', {
        type: ActivityType.Watching,
      });
    };
    await updatePresence();
    setInterval(updatePresence, 60_000);
  },
};
