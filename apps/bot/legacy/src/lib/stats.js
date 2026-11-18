// Server-Statistiken: gesperrte Sprachkanäle, deren Name einen Zählerstand zeigt (z. B. „👥 Mitglieder: 1.284“).
// Einstellungen in stats (config.json / Dashboard), die angelegten Kanäle je Server in data/db.json (statChannels).
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { forGuild } = require('./settings');
const { bucket, save } = require('./db');

const RENAME_EVERY = 5 * 60_000; // Discord erlaubt 2 Umbenennungen je Kanal in 10 Minuten

// Art → Bezeichnung, Standardname und Zählfunktion.
const TYPES = {
  members: { label: 'Mitglieder', name: '👥 Mitglieder: {count}', count: (g) => g.memberCount },
  humans: { label: 'Menschen', name: '🧑 Menschen: {count}', count: (g) => g.members.cache.filter((m) => !m.user.bot).size, needsMembers: true },
  bots: { label: 'Bots', name: '🤖 Bots: {count}', count: (g) => g.members.cache.filter((m) => m.user.bot).size, needsMembers: true },
  boosts: { label: 'Boosts', name: '💎 Boosts: {count}', count: (g) => g.premiumSubscriptionCount ?? 0 },
  channels: { label: 'Kanäle', name: '💬 Kanäle: {count}', count: (g) => g.channels.cache.filter((c) => c.type !== ChannelType.GuildCategory).size },
  roles: { label: 'Rollen', name: '🏷️ Rollen: {count}', count: (g) => g.roles.cache.size - 1 },
  tickets: { label: 'Offene Tickets', name: '🎫 Tickets: {count}', count: (g) => Object.keys(bucket('tickets', g.id)).length },
};

const statName = (template, count) => template.replaceAll('{count}', count.toLocaleString('de-DE')).slice(0, 100);
const channelsOf = (guildId) => bucket('statChannels', guildId); // Art → Kanal-ID
const lastRename = new Map(); // Kanal-ID → Zeitpunkt
const membersFetched = new Set();

async function updateStats(guild) {
  const { enabled, categoryId, counters } = forGuild(guild.id).stats;
  if (!enabled) return;
  const channels = channelsOf(guild.id);

  // Kanäle entfernter Zähler löschen (der Bot hat sie selbst angelegt).
  for (const [type, channelId] of Object.entries(channels)) {
    if (counters.some((c) => c.type === type)) continue;
    await guild.channels.cache.get(channelId)?.delete('Statistik entfernt').catch(() => {});
    delete channels[type];
    save();
  }

  if (counters.some((c) => TYPES[c.type]?.needsMembers) && !membersFetched.has(guild.id)) {
    await guild.members.fetch().catch((err) => console.error('[stats] Mitglieder laden:', err.message));
    membersFetched.add(guild.id);
  }

  for (const counter of counters) {
    const type = TYPES[counter.type];
    if (!type) continue;
    const name = statName(counter.name || type.name, type.count(guild));
    const channel = guild.channels.cache.get(channels[counter.type]);
    if (!channel) {
      const created = await guild.channels
        .create({
          name,
          type: ChannelType.GuildVoice,
          parent: categoryId || null,
          permissionOverwrites: [
            { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.Connect] },
            { id: guild.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.ManageChannels] },
          ],
        })
        .catch((err) => console.error(`[stats] Kanal anlegen (${guild.name}):`, err.message));
      if (created) {
        channels[counter.type] = created.id;
        lastRename.set(created.id, Date.now());
        save();
      }
      continue;
    }
    if (channel.name === name || Date.now() - (lastRename.get(channel.id) ?? 0) < RENAME_EVERY) continue;
    lastRename.set(channel.id, Date.now());
    await channel.setName(name, 'Statistik aktualisiert').catch((err) => console.error('[stats]', err.message));
  }
}

function startStatsWatcher(client) {
  const run = async () => {
    for (const guild of client.guilds.cache.values()) await updateStats(guild).catch((err) => console.error('[stats]', err));
  };
  run();
  setInterval(run, 60_000); // prüft jede Minute, benennt je Kanal aber höchstens alle 5 Minuten um
}

module.exports = { TYPES, statName, updateStats, startStatsWatcher, channelsOf };
