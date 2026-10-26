const { SlashCommandBuilder } = require('discord.js');
const { replyPrivate } = require('../../lib/util');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('umfrage')
    .setDescription('Startet eine Discord-Umfrage.')
    .addStringOption((o) => o.setName('frage').setDescription('Die Frage').setMaxLength(300).setRequired(true))
    .addStringOption((o) =>
      o.setName('antworten').setDescription('Antworten, getrennt mit ; (z. B. Ja;Nein;Vielleicht)').setMaxLength(1000).setRequired(true),
    )
    .addIntegerOption((o) => o.setName('stunden').setDescription('Laufzeit in Stunden (Standard 24)').setMinValue(1).setMaxValue(768))
    .addBooleanOption((o) => o.setName('mehrfachauswahl').setDescription('Mehrere Antworten erlauben?')),

  async execute(interaction) {
    const answers = interaction.options
      .getString('antworten')
      .split(';')
      .map((a) => a.trim())
      .filter(Boolean);
    if (answers.length < 2 || answers.length > 10) return replyPrivate(interaction, 'Bitte gib zwischen 2 und 10 Antworten an (getrennt mit ;).');
    if (answers.some((a) => a.length > 55)) return replyPrivate(interaction, 'Jede Antwort darf höchstens 55 Zeichen lang sein.');

    await interaction.reply({
      poll: {
        question: { text: interaction.options.getString('frage') },
        answers: answers.map((text) => ({ text })),
        duration: interaction.options.getInteger('stunden') ?? 24,
        allowMultiselect: interaction.options.getBoolean('mehrfachauswahl') ?? false,
      },
    });
  },
};
