const { SlashCommandBuilder } = require('discord.js');
const { replyPrivate } = require('../../lib/util');
const team = require('../../lib/team');

module.exports = {
  data: new SlashCommandBuilder().setName('zurueck').setDescription('Beendet deine Abwesenheit.'),

  async execute(interaction) {
    const denied = team.guard(interaction, 'absence');
    if (denied) return replyPrivate(interaction, denied);
    if (!team.absencesOf(interaction.guildId)[interaction.user.id]) return replyPrivate(interaction, 'Du bist nicht als abwesend eingetragen.');
    await team.setAbsence(interaction.member, null);
    return replyPrivate(interaction, '👋 Willkommen zurück! Du bist nicht mehr als abwesend eingetragen.');
  },
};
