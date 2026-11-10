const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { replyPrivate } = require('../../lib/util');
const { postPanel } = require('../../lib/applications/messages');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('bewerbungspanel')
    .setDescription('Postet das Bewerbungs-Panel in diesem Kanal.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    await postPanel(interaction.channel, 'apply');
    await replyPrivate(interaction, '✅ Panel gepostet. Es aktualisiert sich automatisch, wenn sich Bewerbungsarten ändern.');
  },
};
