const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { forGuild } = require('../../lib/settings');
const { embed, replyPrivate, truncate } = require('../../lib/util');
const { fetchFivemStatus } = require('../../lib/fivem');
const robloxCloud = require('../../lib/roblox/openCloud');
const { statusMessage } = require('../../lib/roblox/status');

module.exports = {
  data: new SlashCommandBuilder().setName('serverstatus').setDescription('Zeigt den Status des Gameservers.'),

  async execute(interaction) {
    const { fivem } = forGuild(interaction.guildId);
    if (!fivem.address) {
      // Kein FiveM-Server, aber ein eigenes Roblox-Spiel → dessen Status zeigen
      if (robloxCloud.universeId()) {
        await interaction.deferReply();
        return interaction.editReply(await statusMessage(interaction.guildId));
      }
      return replyPrivate(interaction, 'Es ist kein Gameserver eingetragen (`/einstellungen fivem` oder ROBLOX_UNIVERSE_ID in der .env).');
    }

    await interaction.deferReply();
    const status = await fetchFivemStatus(fivem.address);
    if (!status.online) {
      return interaction.editReply({ embeds: [embed('danger').setTitle('🔴 Server offline').setDescription('Der Gameserver ist gerade nicht erreichbar.')] });
    }

    const players = status.playerList.length ? truncate(status.playerList.join(', '), 1024) : 'Niemand online';
    const reply = {
      embeds: [
        embed('success')
          .setTitle('🟢 Server online')
          .addFields(
            { name: 'Server', value: truncate(status.hostname?.replace(/\^\d/g, '') || interaction.guild.name, 1024) },
            { name: 'Spieler', value: `${status.players}/${status.maxPlayers}`, inline: true },
            { name: 'Online', value: players },
          ),
      ],
    };
    if (fivem.connectUrl) {
      reply.components = [
        new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Verbinden').setStyle(ButtonStyle.Link).setURL(fivem.connectUrl)),
      ];
    }
    await interaction.editReply(reply);
  },
};
