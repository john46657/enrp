const { SlashCommandBuilder } = require('discord.js');
const { forGuild } = require('../../lib/settings');
const { replyPrivate } = require('../../lib/util');
const team = require('../../lib/team');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('abwesend')
    .setDescription('Meldet dich als Teammitglied abwesend.')
    .addStringOption((o) => o.setName('bis').setDescription('Anzahl Tage (z. B. 7) oder Datum (TT.MM.JJJJ)').setRequired(true).setMaxLength(10))
    .addStringOption((o) => o.setName('grund').setDescription('Grund (optional)').setMaxLength(200)),

  async execute(interaction) {
    const denied = team.guard(interaction, 'absence');
    if (denied) return replyPrivate(interaction, denied);
    if (!forGuild(interaction.guildId).team.absence.enabled) return replyPrivate(interaction, 'Die Abwesenheitsliste ist deaktiviert.');
    const until = team.parseUntil(interaction.options.getString('bis'), Date.now(), forGuild(interaction.guildId).timezone);
    if (!until) return replyPrivate(interaction, 'Gib eine Anzahl Tage (z. B. `7`) oder ein Datum in der Zukunft an (z. B. `31.12.2026`).');
    await team.setAbsence(interaction.member, { from: Date.now(), until, reason: interaction.options.getString('grund') ?? '' });
    return replyPrivate(interaction, `🌴 Du bist bis <t:${Math.floor(until / 1000)}:f> als abwesend eingetragen. Mit \`/zurueck\` meldest du dich früher zurück.`);
  },
};
