const { sendTo, embed } = require('./util');

// Gibt eine Fehlermeldung zurück, wenn der Moderator das Ziel nicht bestrafen darf.
function checkHierarchy(interaction, target) {
  const { guild, member, user } = interaction;
  if (target.id === user.id) return 'Du kannst dich nicht selbst bestrafen.';
  if (target.id === guild.ownerId) return 'Der Server-Owner kann nicht bestraft werden.';
  if (target.id === interaction.client.user.id) return 'Netter Versuch. 😄';
  if (user.id !== guild.ownerId && target.roles.highest.position >= member.roles.highest.position) {
    return 'Diese Person hat eine gleich hohe oder höhere Rolle als du.';
  }
  return null;
}

async function notifyUser(user, guild, action, reason) {
  await user
    .send({ embeds: [embed('danger').setTitle(`Du wurdest ${action}`).setDescription(`**Server:** ${guild.name}\n**Grund:** ${reason}`)] })
    .catch(() => {});
}

function logAction(guild, { action, target, moderator, reason, color = 'danger', fields = [] }) {
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

module.exports = { checkHierarchy, notifyUser, logAction };
