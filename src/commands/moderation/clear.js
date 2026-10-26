const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { sendTo, embed } = require('../../lib/util');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Löscht Nachrichten in diesem Kanal (max. 14 Tage alt).')
    .addIntegerOption((o) => o.setName('anzahl').setDescription('Wie viele (1–100)').setMinValue(1).setMaxValue(100).setRequired(true))
    .addUserOption((o) => o.setName('user').setDescription('Nur Nachrichten von diesem Nutzer'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  async execute(interaction) {
    const amount = interaction.options.getInteger('anzahl');
    const user = interaction.options.getUser('user');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let messages = await interaction.channel.messages.fetch({ limit: 100 });
    if (user) messages = messages.filter((m) => m.author.id === user.id);
    const deleted = await interaction.channel.bulkDelete(messages.first(amount), true);

    await interaction.editReply(`🧹 ${deleted.size} Nachricht(en) gelöscht.`);
    await sendTo(interaction.guild, 'modLog', {
      embeds: [
        embed('warning')
          .setTitle('🧹 Nachrichten gelöscht')
          .setDescription(`${deleted.size} Nachricht(en) in ${interaction.channel}${user ? ` von ${user}` : ''} durch ${interaction.user}`),
      ],
    });
  },
};
