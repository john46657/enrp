const { Events, ActivityType } = require('discord.js');
const settings = require('../lib/settings');
const { fetchFivemStatus } = require('../lib/fivem');
const { startTicketWatcher } = require('../lib/tickets');
const appStore = require('../lib/applications/store');
const { sweep } = require('../lib/applications/flow');
const { validateType } = require('../lib/applications/forms');
const { setupGuild } = require('../lib/guilds');
const { startStatsWatcher } = require('../lib/stats');
const { sweepExpired } = require('../lib/warnings');

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    console.log(`✅ Eingeloggt als ${client.user.tag} – auf ${client.guilds.cache.size} Server(n)`);

    // Einstellungen aus der Zeit, als der Bot nur einen Server kannte, dem einzigen Server zuordnen.
    if (settings.hasLegacy()) {
      if (client.guilds.cache.size === 1) settings.adoptLegacy(client.guilds.cache.first().id);
      else console.warn('⚠️  Alte Einstellungen gefunden, aber der Bot ist auf mehreren Servern. Trage GUILD_ID in die .env ein, um sie einem Server zuzuordnen.');
    }

    // Früher global registrierte Befehle entfernen, sonst erscheinen sie doppelt. Jetzt wird je Server registriert.
    await client.application.commands.set([]).catch((err) => console.error('[commands] Globale Befehle entfernen:', err.message));

    // Bewerbungen: laufende DM-Bewerbungen gehen bei einem Neustart verloren
    appStore.resetProgress();
    for (const problem of appStore.baseTypes().flatMap(validateType)) console.warn(`⚠️  Bewerbung: ${problem}`);

    for (const guild of client.guilds.cache.values()) await setupGuild(guild);
    startTicketWatcher(client);
    startStatsWatcher(client);
    // Abgelaufene Verwarnungen (Moderation und Team) markieren und Warn-Rollen anpassen.
    setInterval(async () => {
      for (const guild of client.guilds.cache.values()) {
        const config = settings.forGuild(guild.id);
        await sweepExpired(guild, 'warnings', config.moderation.warnings, 'Verwarnung').catch((err) => console.error('[warnings]', err));
        await sweepExpired(guild, 'teamWarnings', config.team.warnings, 'Team-Verwarnung').catch((err) => console.error('[teamWarnings]', err));
      }
    }, 60_000);
    setInterval(() => sweep(client).catch((err) => console.error('[bewerbung]', err)), 60_000);

    // Bot-Status: Spieleranzahl des ersten Servers mit eingetragenem Gameserver, sonst der Name aus config.json.
    const updatePresence = async () => {
      const address = client.guilds.cache.map((g) => settings.forGuild(g.id).fivem.address).find(Boolean);
      if (!address) {
        client.user.setActivity(settings.base.serverName, { type: ActivityType.Watching });
        return;
      }
      const status = await fetchFivemStatus(address);
      client.user.setActivity(status.online ? `${status.players}/${status.maxPlayers} Spieler online` : 'Server offline', {
        type: ActivityType.Watching,
      });
    };
    await updatePresence();
    setInterval(updatePresence, 60_000);
  },
};
