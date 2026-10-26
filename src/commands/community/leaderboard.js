const { SlashCommandBuilder } = require('discord.js');
const config = require('../../../config.json');
const { embed, replyPrivate } = require('../../lib/util');
const { bucket } = require('../../lib/db');
const { levelInfo } = require('../../lib/leveling');

const MEDALS = ['🥇', '🥈', '🥉'];

module.exports = {
  data: new SlashCommandBuilder().setName('bestenliste').setDescription('Zeigt die Top 10 im Level-System.'),

  async execute(interaction) {
    if (!config.leveling.enabled) return replyPrivate(interaction, 'Das Level-System ist deaktiviert.');
    const top = Object.entries(bucket('levels', interaction.guildId))
      .sort(([, a], [, b]) => b.xp - a.xp)
      .slice(0, 10);
    if (!top.length) return replyPrivate(interaction, 'Noch hat niemand XP gesammelt.');

    const lines = top.map(([id, { xp }], i) => `${MEDALS[i] ?? `**${i + 1}.**`} <@${id}> – Level ${levelInfo(xp).level} (${xp} XP)`);
    await interaction.reply({
      embeds: [embed().setTitle('🏆 Bestenliste').setDescription(lines.join('\n'))],
      allowedMentions: { parse: [] },
    });
  },
};
