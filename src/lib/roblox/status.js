// Status-Anzeige des eigenen Roblox-Spiels (für /spiel status und /serverstatus).
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { embed } = require('../util');
const { gameStats } = require('./openCloud');
const { scopeOf } = require('./links');

const number = (n) => n.toLocaleString('de-DE');

async function statusMessage(guildId) {
  let stats;
  try {
    stats = await gameStats();
  } catch (err) {
    return { embeds: [embed('danger').setTitle('🔴 Spiel nicht erreichbar').setDescription(err.message)] };
  }
  if (!stats) return { content: 'Es ist kein Roblox-Spiel eingetragen (ROBLOX_UNIVERSE_ID in der .env).' };

  const scope = scopeOf(guildId);
  const result = embed('success')
    .setTitle(`🎮 ${stats.name}`)
    .setURL(stats.url)
    .addFields(
      { name: 'Spieler online', value: number(stats.playing), inline: true },
      { name: 'Besuche', value: number(stats.visits), inline: true },
      { name: 'Favoriten', value: number(stats.favorites), inline: true },
    );
  if (scope.type === 'private') {
    result.setDescription(`Dieser Discord gehört zu den Privatservern **${scope.name}** (Besitzer: ${scope.ownerName}).`);
  }
  return {
    embeds: [result],
    components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Spielen').setStyle(ButtonStyle.Link).setURL(stats.url))],
  };
}

module.exports = { statusMessage };
