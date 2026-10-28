const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { replyPrivate, embed } = require('../../lib/util');
const { checkHierarchy, notifyUser, logAction } = require('../../lib/moderation');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Schaltet ein Mitglied stumm (0 Minuten = Timeout aufheben).')
    .addUserOption((o) => o.setName('user').setDescription('Mitglied').setRequired(true))
    .addIntegerOption((o) =>
      o.setName('minuten').setDescription('Dauer in Minuten (max. 28 Tage)').setMinValue(0).setMaxValue(40_320).setRequired(true),
    )
    .addStringOption((o) => o.setName('grund').setDescription('Grund').setMaxLength(500))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  async execute(interaction) {
    const member = interaction.options.getMember('user');
    const minutes = interaction.options.getInteger('minuten');
    const reason = interaction.options.getString('grund') ?? 'Kein Grund angegeben';
    if (!member) return replyPrivate(interaction, 'Diese Person ist nicht auf dem Server.');

    const error = checkHierarchy(interaction, member);
    if (error) return replyPrivate(interaction, error);
    if (!member.moderatable) return replyPrivate(interaction, 'Ich kann diese Person nicht stummschalten (meine Rolle ist zu niedrig).');

    await member.timeout(minutes ? minutes * 60_000 : null, `${interaction.user.tag}: ${reason}`);

    if (!minutes) {
      await interaction.reply({ embeds: [embed('success').setDescription(`🔊 Timeout von ${member.user} aufgehoben.`)] });
      return logAction(interaction.guild, { action: 'Timeout aufgehoben', target: member.user, moderator: interaction.user, reason, color: 'success' });
    }

    const until = Math.floor((Date.now() + minutes * 60_000) / 1000);
    await notifyUser(member.user, interaction.guild, `bis <t:${until}:f> stummgeschaltet`, reason);
    await interaction.reply({
      embeds: [embed('warning').setDescription(`🔇 ${member.user} ist bis <t:${until}:f> stummgeschaltet.\n**Grund:** ${reason}`)],
    });
    await logAction(interaction.guild, {
      action: 'Timeout',
      target: member.user,
      moderator: interaction.user,
      reason,
      color: 'warning',
      fields: [{ name: 'Bis', value: `<t:${until}:f>` }],
    });
  },
};
