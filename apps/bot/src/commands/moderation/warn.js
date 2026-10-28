const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { replyPrivate, embed } = require('../../lib/util');
const { bucket, save } = require('../../lib/db');
const { checkHierarchy, notifyUser, logAction } = require('../../lib/moderation');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Verwarnt ein Mitglied.')
    .addUserOption((o) => o.setName('user').setDescription('Mitglied').setRequired(true))
    .addStringOption((o) => o.setName('grund').setDescription('Grund').setMaxLength(500).setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  async execute(interaction) {
    const member = interaction.options.getMember('user');
    const reason = interaction.options.getString('grund');
    if (!member) return replyPrivate(interaction, 'Diese Person ist nicht auf dem Server.');

    const error = checkHierarchy(interaction, member);
    if (error) return replyPrivate(interaction, error);

    const list = (bucket('warnings', interaction.guildId)[member.id] ??= []);
    list.push({ reason, by: interaction.user.id, at: Date.now() });
    save();

    await notifyUser(member.user, interaction.guild, 'verwarnt', reason);
    await interaction.reply({
      embeds: [embed('warning').setDescription(`⚠️ ${member.user} wurde verwarnt (Verwarnung **#${list.length}**).\n**Grund:** ${reason}`)],
    });
    await logAction(interaction.guild, {
      action: 'Verwarnung',
      target: member.user,
      moderator: interaction.user,
      reason,
      color: 'warning',
      fields: [{ name: 'Verwarnungen gesamt', value: String(list.length) }],
    });
  },
};
