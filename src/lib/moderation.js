const { PermissionFlagsBits } = require('discord.js');
const { forGuild } = require('./settings');
const { sendTo, embed } = require('./util');
const activity = require('./activity');

const settingsOf = (guildId) => forGuild(guildId).moderation;

// Aktion → Discord-Recht, das sie immer erlaubt. Zusätzlich dürfen die Rollen aus moderation.permissions.
const NATIVE = {
  timeout: PermissionFlagsBits.ModerateMembers,
  warn: PermissionFlagsBits.ModerateMembers,
  kick: PermissionFlagsBits.KickMembers,
  ban: PermissionFlagsBits.BanMembers,
  viewLogs: PermissionFlagsBits.ModerateMembers,
};

function canUse(member, action) {
  if (member.permissions.has(PermissionFlagsBits.Administrator) || member.permissions.has(NATIVE[action])) return true;
  return (settingsOf(member.guild.id).permissions[action] ?? []).some((id) => member.roles.cache.has(id));
}

// Fehlermeldung, wenn das Modul aus ist oder die Berechtigung fehlt, sonst null.
function guard(interaction, action) {
  if (!settingsOf(interaction.guildId).enabled) return 'Das Moderations-Modul ist auf diesem Server deaktiviert.';
  if (!canUse(interaction.member, action)) return 'Dafür fehlt dir die Berechtigung.';
  return null;
}

// Gibt eine Fehlermeldung zurück, wenn der Moderator das Ziel nicht bestrafen darf.
function checkHierarchy(interaction, target) {
  const { guild, member, user } = interaction;
  if (target.id === user.id) return 'Du kannst dich nicht selbst bestrafen.';
  if (target.id === guild.ownerId) return 'Der Server-Owner kann nicht bestraft werden.';
  if (target.id === interaction.client.user.id) return 'Netter Versuch. 😄';
  if (settingsOf(guild.id).ignoredRoles.some((id) => target.roles.cache.has(id))) return 'Diese Person hat eine ignorierte Rolle.';
  if (user.id !== guild.ownerId && target.roles.highest.position >= member.roles.highest.position) {
    return 'Diese Person hat eine gleich hohe oder höhere Rolle als du.';
  }
  return null;
}

async function notifyUser(user, guild, action, reason) {
  if (!settingsOf(guild.id).dmOnAction) return;
  await user
    .send({ embeds: [embed('danger').setTitle(`Du wurdest ${action}`).setDescription(`**Server:** ${guild.name}\n**Grund:** ${reason}`)] })
    .catch(() => {});
}

function logAction(guild, { action, target, moderator, reason, color = 'danger', fields = [] }) {
  if (!moderator.bot) activity.record(guild.id, moderator.id, 'mod'); // für den Rang-Aufstieg
  if (!settingsOf(guild.id).logEnabled) return null;
  return sendTo(guild, 'modLog', {
    embeds: [
      embed(color)
        .setTitle(`🛡️ ${action}`)
        .setThumbnail(target.displayAvatarURL())
        .addFields(
          { name: 'Nutzer', value: `${target} (${target.tag ?? target.username})\n\`${target.id}\``, inline: true },
          { name: 'Moderator', value: `${moderator}`, inline: true },
          { name: 'Grund', value: reason },
          ...fields,
        ),
    ],
  });
}

// Warn-Limit erreicht: kicken, bannen oder Timeout. Gibt eine Beschreibung der Aktion zurück (oder null).
async function applyWarnLimit(member, count, moderator) {
  const { limit } = settingsOf(member.guild.id).warnings;
  if (!limit.enabled || count < limit.count) return null;
  const reason = `Warn-Limit erreicht (${count} aktive Verwarnungen)`;
  const actions = {
    kick: ['gekickt', () => member.kick(reason)],
    ban: ['gebannt', () => member.ban({ reason })],
    timeout: [`für ${limit.timeoutMinutes} Min. stummgeschaltet`, () => member.timeout(limit.timeoutMinutes * 60_000, reason)],
  };
  const [label, run] = actions[limit.action] ?? [];
  if (!run) return null;
  await notifyUser(member.user, member.guild, label, reason);
  try {
    await run();
  } catch (err) {
    console.error('[warnLimit]', err.message);
    return null;
  }
  await logAction(member.guild, { action: `Warn-Limit: ${label}`, target: member.user, moderator, reason });
  return label;
}

module.exports = { canUse, guard, checkHierarchy, notifyUser, logAction, applyWarnLimit };
