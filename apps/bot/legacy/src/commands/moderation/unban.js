const { SlashCommandBuilder } = require('discord.js');
const { replyPrivate, embed } = require('../../lib/util');
const { guard, logAction } = require('../../lib/moderation');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Hebt einen Bann auf.')
    .addStringOption((o) => o.setName('user_id').setDescription('Discord-ID des Nutzers').setRequired(true))
    .addStringOption((o) => o.setName('grund').setDescription('Grund').setMaxLength(500)),

  async execute(interaction) {
    const denied = guard(interaction, 'ban');
    if (denied) return replyPrivate(interaction, denied);
    const id = interaction.options.getString('user_id').trim();
    const reason = interaction.options.getString('grund') ?? 'Kein Grund angegeben';

    const user = await interaction.guild.bans.remove(id, `${interaction.user.tag}: ${reason}`).catch(() => null);
    if (!user) return replyPrivate(interaction, 'Zu dieser ID gibt es keinen Bann.');

    await interaction.reply({ embeds: [embed('success').setDescription(`✅ ${user} wurde entbannt.`)] });
    await logAction(interaction.guild, { action: 'Entbannung', target: user, moderator: interaction.user, reason, color: 'success' });
  },
};
