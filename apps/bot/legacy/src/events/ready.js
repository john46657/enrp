const { Events, ActivityType } = require('discord.js');
const settings = require('../lib/settings');
const { fetchRobloxStatus } = require('../lib/robloxGame');
const { startTicketWatcher } = require('../lib/tickets');
const appStore = require('../lib/applications/store');
const { sweep, restore } = require('../lib/applications/flow');
const { watchPhases } = require('../lib/applications/messages');
const { validateType } = require('../lib/applications/forms');
const { setupGuild } = require('../lib/guilds');
const { startStatsWatcher } = require('../lib/stats');
const { sweepExpired } = require('../lib/warnings');
const { startTeamWatcher } = require('../lib/team');
const { startGiveawayWatcher } = require('../lib/giveaways');
const { startCareerWatcher } = require('../lib/careers');
const { startMeetingWatcher } = require('../lib/meetings');

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

    for (const guild of client.guilds.cache.values()) {
      for (const problem of appStore.types(guild.id).flatMap((t) => validateType(t, { allowEmpty: true }))) {
        console.warn(`⚠️  „${guild.name}“ → Bewerbung: ${problem}`);
      }
      await setupGuild(guild);
    }
    startTicketWatcher(client);
    startStatsWatcher(client);
    startTeamWatcher(client);
    // Dashboard erst hier laden: braucht express, das im Brückenbetrieb (apps/bot) nicht installiert ist.
    // Im Brückenbetrieb (apps/bot) oder mit LEGACY_DASHBOARD=false nie starten: sonst belegt das alte
    // Dashboard den öffentlichen Port (SERVER_PORT) und verdeckt Plattform-Dashboard und API.
    if (process.env.LEGACY_DASHBOARD === 'false' || process.env.ENRP_LEGACY_BRIDGE === '1') {
      console.log('ℹ️  Altes Dashboard aus (Plattform-Dashboard übernimmt)');
    } else if (process.env.DASHBOARD_URL && process.env.DISCORD_CLIENT_SECRET) {
      require('../dashboard/modules');
      require('../dashboard/server').startDashboard(client);
    } else console.log('ℹ️  Dashboard aus (DASHBOARD_URL und DISCORD_CLIENT_SECRET in der .env setzen)');
    startGiveawayWatcher(client);
    startCareerWatcher(client);
    startMeetingWatcher(client);
    // Abgelaufene Verwarnungen (Moderation und Team) markieren und Warn-Rollen anpassen.
    setInterval(async () => {
      for (const guild of client.guilds.cache.values()) {
        const config = settings.forGuild(guild.id);
        await sweepExpired(guild, 'warnings', config.moderation.warnings, 'Verwarnung').catch((err) => console.error('[warnings]', err));
        await sweepExpired(guild, 'teamWarnings', config.team.warnings, 'Team-Verwarnung').catch((err) => console.error('[teamWarnings]', err));
      }
    }, 60_000);
    // Bewerbungen: laufende DM-Bewerbungen nach dem Neustart fortsetzen, Zeitlimits und Bewerbungsphasen überwachen
    await restore(client);
    setInterval(() => {
      sweep(client).catch((err) => console.error('[bewerbung]', err));
      watchPhases(client).catch((err) => console.error('[bewerbungsphase]', err));
    }, 60_000);

    // Bot-Status: Spieleranzahl des ersten Servers mit eingetragenem Roblox-Spiel, sonst der Name aus config.json.
    const updatePresence = async () => {
      const game = client.guilds.cache.map((g) => settings.forGuild(g.id).roblox.game).find(Boolean);
      const status = game ? await fetchRobloxStatus(game) : null;
      if (!status?.online) {
        client.user.setActivity(settings.base.serverName, { type: ActivityType.Watching });
        return;
      }
      client.user.setActivity(`${status.playing.toLocaleString('de-DE')} Spieler in Roblox`, { type: ActivityType.Watching });
    };
    await updatePresence();
    setInterval(updatePresence, 60_000);
  },
};
