const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { replyPrivate } = require('../../lib/util');
const { postPanel } = require('../../lib/applications/messages');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('qualipanel')
    .setDescription('Postet das Qualifikations-Panel (Einheiten) in diesem Kanal.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    await postPanel(interaction.channel, 'quali');
    await replyPrivate(interaction, '✅ Panel gepostet. Es aktualisiert sich automatisch, wenn sich Bewerbungsarten ändern.');
  },
};
