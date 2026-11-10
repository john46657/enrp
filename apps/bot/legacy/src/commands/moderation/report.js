const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { forGuild } = require('../../lib/settings');
const { replyPrivate, embed, getChannel } = require('../../lib/util');
const { canUse } = require('../../lib/moderation');

// Report-System: Mitglieder melden andere Mitglieder, die Meldung landet in moderation.report.channel.
module.exports = {
  data: new SlashCommandBuilder()
    .setName('melden')
    .setDescription('Meldet ein Mitglied an das Team.')
    .addUserOption((o) => o.setName('user').setDescription('Wen möchtest du melden?').setRequired(true))
    .addStringOption((o) => o.setName('grund').setDescription('Was ist passiert?').setMaxLength(1000).setRequired(true))
    .addAttachmentOption((o) => o.setName('beweis').setDescription('Screenshot (optional)')),

  async execute(interaction) {
    const { enabled, report } = forGuild(interaction.guildId).moderation;
    if (!enabled || !report.enabled) return replyPrivate(interaction, 'Das Report-System ist auf diesem Server nicht aktiv.');
    const channel = await getChannel(interaction.guild, report.channel);
    if (!channel?.isTextBased()) return replyPrivate(interaction, 'Für Meldungen ist noch kein Kanal eingestellt.');

    const user = interaction.options.getUser('user');
    if (user.id === interaction.user.id) return replyPrivate(interaction, 'Du kannst dich nicht selbst melden.');
    const proof = interaction.options.getAttachment('beweis');
    const message = embed('warning')
      .setTitle('🚩 Neue Meldung')
      .setThumbnail(user.displayAvatarURL())
      .addFields(
        { name: 'Gemeldet', value: `${user} (\`${user.id}\`)`, inline: true },
        { name: 'Von', value: `${interaction.user}`, inline: true },
        { name: 'Kanal', value: `${interaction.channel}`, inline: true },
        { name: 'Grund', value: interaction.options.getString('grund') },
      );
    if (proof?.contentType?.startsWith('image/')) message.setImage(proof.url);
    else if (proof) message.addFields({ name: 'Beweis', value: proof.url });

    await channel.send({
      content: report.pingRoles.map((id) => `<@&${id}>`).join(' ') || undefined,
      embeds: [message],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`report:done:${interaction.user.id}`).setLabel('Erledigt').setStyle(ButtonStyle.Success).setEmoji('✅'),
          new ButtonBuilder().setCustomId(`report:reject:${interaction.user.id}`).setLabel('Abgelehnt').setStyle(ButtonStyle.Secondary),
        ),
      ],
      allowedMentions: { parse: ['roles'] },
    });
    return replyPrivate(interaction, '✅ Danke, deine Meldung ist beim Team angekommen.');
  },

  components: {
    async report(interaction, [action, reporterId]) {
      if (!canUse(interaction.member, 'warn')) return replyPrivate(interaction, 'Nur das Team kann Meldungen bearbeiten.');
      const done = action === 'done';
      const updated = embed(done ? 'success' : 'danger')
        .setTitle(done ? '✅ Meldung erledigt' : '❌ Meldung abgelehnt')
        .setFields(interaction.message.embeds[0]?.fields ?? [])
        .addFields({ name: 'Bearbeitet von', value: `${interaction.user}` });
      await interaction.update({ embeds: [updated], components: [] });
      const reporter = await interaction.client.users.fetch(reporterId).catch(() => null);
      await reporter
        ?.send(`Deine Meldung auf **${interaction.guild.name}** wurde ${done ? 'bearbeitet' : 'geprüft und abgelehnt'}. Danke!`)
        .catch(() => {});
    },
  },
};
