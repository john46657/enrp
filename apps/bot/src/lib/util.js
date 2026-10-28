const { EmbedBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { base: config, forGuild } = require('./settings');

function embed(color = 'primary') {
  return new EmbedBuilder()
    .setColor(config.colors[color] ?? color)
    .setFooter({ text: config.serverName })
    .setTimestamp();
}

// Antwortet nur für den Nutzer sichtbar.
function replyPrivate(interaction, content) {
  const payload = typeof content === 'string' ? { content } : content;
  payload.flags = MessageFlags.Ephemeral;
  return interaction.replied || interaction.deferred ? interaction.followUp(payload) : interaction.reply(payload);
}

async function getChannel(guild, id) {
  if (!id) return null;
  return guild.channels.cache.get(id) ?? (await guild.channels.fetch(id).catch(() => null));
}

// Schickt etwas in einen der für diesen Server eingestellten Kanäle (channels.<key>).
async function sendTo(guild, channelKey, payload) {
  const channel = await getChannel(guild, forGuild(guild.id).channels[channelKey]);
  if (!channel?.isTextBased()) return null;
  return channel.send(payload).catch((err) => {
    console.error(`[${channelKey}] Senden fehlgeschlagen:`, err.message);
    return null;
  });
}

function fill(template, vars) {
  return template.replace(/\{(\w+)\}/g, (match, key) => (key in vars ? String(vars[key]) : match));
}

function hasRole(member, roleKey) {
  const id = forGuild(member.guild.id).roles[roleKey];
  return Boolean(id && member.roles.cache.has(id));
}

// Staff = Staff-Rolle oder "Server verwalten".
function isStaff(member) {
  return hasRole(member, 'staff') || member.permissions.has(PermissionFlagsBits.ManageGuild);
}

function isSupport(member) {
  return hasRole(member, 'support') || isStaff(member);
}

function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

module.exports = { embed, replyPrivate, getChannel, sendTo, fill, hasRole, isStaff, isSupport, truncate };
