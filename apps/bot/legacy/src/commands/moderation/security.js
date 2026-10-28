const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { replyPrivate } = require('../../lib/util');
const security = require('../../lib/security');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sicherheit')
    .setDescription('Server-Sicherheit.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('verify-panel').setDescription('Postet die Verify-Nachricht in den eingestellten Kanal.')),

  async execute(interaction) {
    try {
      await security.postVerifyMessage(interaction.guild);
      return replyPrivate(interaction, '✅ Verify-Nachricht gepostet.');
    } catch (err) {
      return replyPrivate(interaction, `❌ ${err.message} (Dashboard → Server-Sicherheit oder security in der config.json)`);
    }
  },

  components: {
    verify: (interaction) => security.handleVerify(interaction),
  },
};
