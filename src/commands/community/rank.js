const { SlashCommandBuilder } = require('discord.js');
const config = require('../../../config.json');
const { embed, replyPrivate } = require('../../lib/util');
const { bucket } = require('../../lib/db');
const { levelInfo, progressBar } = require('../../lib/leveling');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rang')
    .setDescription('Zeigt Level und XP.')
    .addUserOption((o) => o.setName('user').setDescription('Nutzer (Standard: du)')),

  async execute(interaction) {
    if (!config.leveling.enabled) return replyPrivate(interaction, 'Das Level-System ist deaktiviert.');
    const user = interaction.options.getUser('user') ?? interaction.user;
    const levels = bucket('levels', interaction.guildId);
    const xp = levels[user.id]?.xp ?? 0;
    const info = levelInfo(xp);
    const position = Object.values(levels).filter((e) => e.xp > xp).length + 1;

    await interaction.reply({
      embeds: [
        embed()
          .setAuthor({ name: user.username, iconURL: user.displayAvatarURL() })
          .addFields(
            { name: 'Level', value: String(info.level), inline: true },
            { name: 'Platz', value: xp ? `#${position}` : '—', inline: true },
            { name: 'XP gesamt', value: String(xp), inline: true },
            { name: 'Fortschritt', value: `${progressBar(info.current, info.needed)} ${info.current}/${info.needed} XP` },
          ),
      ],
    });
  },
};
