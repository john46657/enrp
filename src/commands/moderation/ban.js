const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { replyPrivate, embed } = require('../../lib/util');
const { checkHierarchy, notifyUser, logAction } = require('../../lib/moderation');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Bannt einen Nutzer vom Server.')
    .addUserOption((o) => o.setName('user').setDescription('Nutzer').setRequired(true))
    .addStringOption((o) => o.setName('grund').setDescription('Grund').setMaxLength(500))
    .addIntegerOption((o) =>
      o.setName('nachrichten_tage').setDescription('Nachrichten der letzten X Tage löschen (0–7)').setMinValue(0).setMaxValue(7),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

  async execute(interaction) {
    const user = interaction.options.getUser('user');
    const member = interaction.options.getMember('user');
    const reason = interaction.options.getString('grund') ?? 'Kein Grund angegeben';
    const days = interaction.options.getInteger('nachrichten_tage') ?? 0;

    if (member) {
      const error = checkHierarchy(interaction, member);
      if (error) return replyPrivate(interaction, error);
      if (!member.bannable) return replyPrivate(interaction, 'Ich kann diese Person nicht bannen (meine Rolle ist zu niedrig).');
      await notifyUser(user, interaction.guild, 'gebannt', reason);
    }

    await interaction.guild.bans.create(user.id, {
      reason: `${interaction.user.tag}: ${reason}`,
      deleteMessageSeconds: days * 86_400,
    });
    await interaction.reply({ embeds: [embed('danger').setDescription(`🔨 ${user} wurde gebannt.\n**Grund:** ${reason}`)] });
    await logAction(interaction.guild, { action: 'Bann', target: user, moderator: interaction.user, reason });
  },
};
