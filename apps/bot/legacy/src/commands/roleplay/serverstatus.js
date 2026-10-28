const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { forGuild } = require('../../lib/settings');
const { embed, replyPrivate, truncate } = require('../../lib/util');
const { fetchRobloxStatus, parsePlaceId } = require('../../lib/robloxGame');

const num = (n) => n.toLocaleString('de-DE');

module.exports = {
  data: new SlashCommandBuilder().setName('serverstatus').setDescription('Zeigt den Status des Roblox-Spiels.'),

  async execute(interaction) {
    const { roblox } = forGuild(interaction.guildId);
    if (!parsePlaceId(roblox.game)) return replyPrivate(interaction, 'Es ist kein Roblox-Spiel eingetragen (`/einstellungen roblox`).');

    await interaction.deferReply();
    const status = await fetchRobloxStatus(roblox.game);
    if (!status.online) {
      return interaction.editReply({ embeds: [embed('danger').setTitle('🔴 Nicht erreichbar').setDescription('Roblox antwortet gerade nicht oder das Spiel gibt es nicht.')] });
    }

    const fields = [
      { name: 'Spiel', value: truncate(status.name || interaction.guild.name, 1024) },
      { name: 'Spieler online', value: num(status.playing), inline: true },
    ];
    if (status.servers !== null) fields.push({ name: 'Server', value: `${status.servers}${status.more ? '+' : ''}`, inline: true });
    if (status.maxPlayers) fields.push({ name: 'Plätze je Server', value: String(status.maxPlayers), inline: true });
    fields.push({ name: 'Besuche', value: num(status.visits), inline: true });

    await interaction.editReply({
      embeds: [embed(status.playing ? 'success' : 'primary').setTitle(status.playing ? '🟢 Spieler online' : '⚪ Gerade niemand online').addFields(fields)],
      components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Spielen').setStyle(ButtonStyle.Link).setURL(status.url))],
    });
  },
};
