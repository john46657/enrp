const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { embed, replyPrivate } = require('../../lib/util');

const PINGS = { everyone: '@everyone', here: '@here', none: '' };

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ankuendigung')
    .setDescription('Schreibt eine Ankündigung als Embed.')
    .addChannelOption((o) =>
      o.setName('kanal').setDescription('Zielkanal').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true),
    )
    .addStringOption((o) =>
      o
        .setName('ping')
        .setDescription('Wer soll erwähnt werden?')
        .addChoices({ name: '@everyone', value: 'everyone' }, { name: '@here', value: 'here' }, { name: 'Niemand', value: 'none' }),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const channel = interaction.options.getChannel('kanal');
    const ping = interaction.options.getString('ping') ?? 'none';
    const modal = new ModalBuilder()
      .setCustomId(`announce:${channel.id}:${ping}`)
      .setTitle('Ankündigung')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('title').setLabel('Titel').setStyle(TextInputStyle.Short).setMaxLength(256),
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('text').setLabel('Text').setStyle(TextInputStyle.Paragraph).setMaxLength(4000),
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('image').setLabel('Bild-URL (optional)').setStyle(TextInputStyle.Short).setRequired(false),
        ),
      );
    await interaction.showModal(modal);
  },

  components: {
    async announce(interaction, [channelId, ping]) {
      const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
      if (!channel) return replyPrivate(interaction, 'Der Kanal existiert nicht mehr.');

      const image = interaction.fields.getTextInputValue('image').trim();
      const message = embed()
        .setTitle(`📢 ${interaction.fields.getTextInputValue('title')}`)
        .setDescription(interaction.fields.getTextInputValue('text'))
        .setAuthor({ name: interaction.member.displayName, iconURL: interaction.user.displayAvatarURL() });
      if (/^https?:\/\//.test(image)) message.setImage(image);

      await channel.send({
        content: PINGS[ping] || undefined,
        embeds: [message],
        allowedMentions: { parse: ping === 'none' ? [] : ['everyone'] },
      });
      await replyPrivate(interaction, `✅ Ankündigung in ${channel} gepostet.`);
    },
  },
};
