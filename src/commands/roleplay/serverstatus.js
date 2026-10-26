const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../../../config.json');
const { embed, replyPrivate, truncate } = require('../../lib/util');
const { fetchFivemStatus } = require('../../lib/fivem');
const branding = require('../../lib/branding');

module.exports = {
  data: new SlashCommandBuilder().setName('serverstatus').setDescription('Zeigt den Status des Gameservers.'),

  async execute(interaction) {
    if (!config.fivem.address) return replyPrivate(interaction, 'Es ist kein Gameserver eingetragen (config.json → fivem.address).');

    await interaction.deferReply();
    const status = await fetchFivemStatus();
    if (!status.online) {
      return interaction.editReply({ embeds: [embed('danger').setTitle('🔴 Server offline').setDescription('Der Gameserver ist gerade nicht erreichbar.')] });
    }

    const players = status.playerList.length ? truncate(status.playerList.join(', '), 1024) : 'Niemand online';
    const reply = {
      embeds: [
        embed('success')
          .setTitle('🟢 Server online')
          .addFields(
            { name: 'Server', value: truncate(status.hostname?.replace(/\^\d/g, '') || branding.name(), 1024) },
            { name: 'Spieler', value: `${status.players}/${status.maxPlayers}`, inline: true },
            { name: 'Online', value: players },
          ),
      ],
    };
    if (config.fivem.connectUrl) {
      reply.components = [
        new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Verbinden').setStyle(ButtonStyle.Link).setURL(config.fivem.connectUrl)),
      ];
    }
    await interaction.editReply(reply);
  },
};
