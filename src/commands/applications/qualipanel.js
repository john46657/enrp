const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { replyPrivate } = require('../../lib/util');
const { forGuild } = require('../../lib/settings');
const { postPanel } = require('../../lib/applications/messages');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('qualipanel')
    .setDescription('Postet das Panel „quali“ (Einheiten). Für alle Panels: /bewerbungspanel posten.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    if (!forGuild(interaction.guildId).applications.panels.quali) {
      return replyPrivate(interaction, '❌ Das Panel „quali“ gibt es auf diesem Server nicht mehr. Nutze `/bewerbungspanel posten`.');
    }
    await postPanel(interaction.channel, 'quali');
    await replyPrivate(interaction, '✅ Panel gepostet. Es aktualisiert sich automatisch, wenn sich Bewerbungsarten ändern.');
  },
};
