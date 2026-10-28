const { SlashCommandBuilder } = require('discord.js');
const { embed, replyPrivate } = require('../../lib/util');

const SECTIONS = {
  '📋 Bewerbungen': ['bewerbung', 'bewerbungspanel', 'qualipanel', 'bewerbungen', 'bewerbungssperre'],
  '🎭 Roleplay': ['serverstatus', 'ankuendigung'],
  '🛡️ Moderation': ['kick', 'ban', 'unban', 'timeout', 'warn', 'verwarnungen', 'clear', 'melden', 'sicherheit'],
  '🎫 Tickets': ['ticket'],
  '🎉 Community': ['rollenpanel', 'umfrage', 'rang', 'bestenliste', 'giveaway', 'vorschlag', 'zaehlen'],
  '👥 Team': ['team', 'abwesend', 'zurueck', 'meeting'],
  '⚙️ Verwaltung': ['einstellungen'],
};

module.exports = {
  data: new SlashCommandBuilder().setName('hilfe').setDescription('Zeigt alle Befehle des Bots.'),

  async execute(interaction) {
    const commands = await interaction.client.application.commands.fetch({ guildId: interaction.guildId }).catch(() => null);
    const mention = (name) => {
      const cmd = commands?.find((c) => c.name === name);
      return cmd ? `</${name}:${cmd.id}>` : `/${name}`;
    };
    const help = embed().setTitle('📖 Befehle');
    for (const [title, names] of Object.entries(SECTIONS)) {
      const lines = names
        .map((n) => interaction.client.commands.get(n))
        .filter(Boolean)
        .map((c) => `${mention(c.data.name)} – ${c.data.description}`);
      help.addFields({ name: title, value: lines.join('\n') });
    }
    await replyPrivate(interaction, { embeds: [help] });
  },
};
