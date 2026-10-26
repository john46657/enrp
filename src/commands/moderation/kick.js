const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { replyPrivate, embed } = require('../../lib/util');
const { checkHierarchy, notifyUser, logAction } = require('../../lib/moderation');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Wirft ein Mitglied vom Server.')
    .addUserOption((o) => o.setName('user').setDescription('Mitglied').setRequired(true))
    .addStringOption((o) => o.setName('grund').setDescription('Grund').setMaxLength(500))
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),

  async execute(interaction) {
    const member = interaction.options.getMember('user');
    const reason = interaction.options.getString('grund') ?? 'Kein Grund angegeben';
    if (!member) return replyPrivate(interaction, 'Diese Person ist nicht auf dem Server.');

    const error = checkHierarchy(interaction, member);
    if (error) return replyPrivate(interaction, error);
    if (!member.kickable) return replyPrivate(interaction, 'Ich kann diese Person nicht kicken (meine Rolle ist zu niedrig).');

    await notifyUser(member.user, interaction.guild, 'gekickt', reason);
    await member.kick(`${interaction.user.tag}: ${reason}`);
    await interaction.reply({ embeds: [embed('danger').setDescription(`👢 ${member.user} wurde gekickt.\n**Grund:** ${reason}`)] });
    await logAction(interaction.guild, { action: 'Kick', target: member.user, moderator: interaction.user, reason });
  },
};
