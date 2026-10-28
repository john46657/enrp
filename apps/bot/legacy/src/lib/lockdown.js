// Notfall-Lockdown: @everyone darf in keinem Textkanal mehr schreiben. Vorherige Einstellungen werden gemerkt
// und beim Aufheben genau so wiederhergestellt.
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const db = require('./db');
const { forGuild } = require('./settings');
const { embed, getChannel } = require('./util');

const LOCKABLE = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum]);
const PERMS = ['SendMessages', 'SendMessagesInThreads', 'CreatePublicThreads'];

// 'allow' | 'deny' | null (nicht gesetzt) für jede Berechtigung der @everyone-Überschreibung.
function snapshot(channel, everyoneId) {
  const ow = channel.permissionOverwrites.cache.get(everyoneId);
  return Object.fromEntries(
    PERMS.map((p) => [p, ow?.allow.has(PermissionFlagsBits[p]) ? 'allow' : ow?.deny.has(PermissionFlagsBits[p]) ? 'deny' : null]),
  );
}

function state(guildId) {
  return db.bucket('lockdowns', guildId);
}

function isLocked(guildId) {
  return Boolean(state(guildId).active);
}

async function lock(guild, by, reason) {
  const st = state(guild.id);
  if (st.active) throw new Error('Der Server ist bereits gesperrt.');
  const me = guild.members.me;
  const channels = guild.channels.cache.filter((c) => LOCKABLE.has(c.type) && c.permissionsFor(me)?.has(PermissionFlagsBits.ManageRoles));
  Object.assign(st, { active: true, by, reason, at: new Date().toISOString(), channels: {} });
  let failed = 0;
  for (const channel of channels.values()) {
    st.channels[channel.id] = snapshot(channel, guild.id);
    try {
      await channel.permissionOverwrites.edit(guild.id, Object.fromEntries(PERMS.map((p) => [p, false])), { reason: `Lockdown: ${reason}` });
    } catch {
      delete st.channels[channel.id];
      failed++;
    }
  }
  db.save();
  return { locked: Object.keys(st.channels).length, failed };
}

async function unlock(guild, reason) {
  const st = state(guild.id);
  if (!st.active) throw new Error('Es ist kein Lockdown aktiv.');
  let restored = 0;
  for (const [id, before] of Object.entries(st.channels ?? {})) {
    const channel = guild.channels.cache.get(id);
    if (!channel) continue;
    const values = Object.fromEntries(PERMS.map((p) => [p, before[p] === 'allow' ? true : before[p] === 'deny' ? false : null]));
    await channel.permissionOverwrites.edit(guild.id, values, { reason: `Lockdown aufgehoben: ${reason}` }).then(() => restored++).catch(() => {});
  }
  for (const key of Object.keys(st)) delete st[key];
  db.save();
  return { restored };
}

function status(guildId) {
  const st = state(guildId);
  return st.active ? { active: true, by: st.by, reason: st.reason, at: st.at, channels: Object.keys(st.channels ?? {}).length } : { active: false };
}

// Meldung im Sicherheits-Log (bzw. Mod-Log).
async function announce(guild, text) {
  const cfg = forGuild(guild.id);
  const channel = await getChannel(guild, cfg.security.logChannel || cfg.channels.modLog);
  if (channel?.isTextBased()) await channel.send({ embeds: [embed('danger').setTitle('🔒 Lockdown').setDescription(text)], allowedMentions: { parse: [] } }).catch(() => {});
}

module.exports = { lock, unlock, isLocked, status, announce, snapshot, PERMS };
