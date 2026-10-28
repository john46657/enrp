const { ContextMenuCommandBuilder, ApplicationCommandType, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { forGuild } = require('../../lib/settings');
const { replyPrivate } = require('../../lib/util');
const scamImages = require('../../lib/scamImages');

// Rechtsklick auf eine Nachricht → Apps → „Als Scam-Bild melden“
module.exports = {
  data: new ContextMenuCommandBuilder()
    .setName('Als Scam-Bild melden')
    .setType(ApplicationCommandType.Message)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  async execute(interaction) {
    const cfg = forGuild(interaction.guildId).security;
    if (!cfg.enabled || !cfg.scamImages.enabled) return replyPrivate(interaction, 'Der Scam-Bilder-Schutz ist auf diesem Server deaktiviert (Dashboard → Server-Sicherheit).');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const count = await scamImages.reportMessage(interaction.targetMessage, interaction.user);
      return interaction.editReply(`✅ ${count} Bild(er) als Scam gespeichert und die Nachricht entfernt. Gleiche Bilder werden ab jetzt automatisch gelöscht.`);
    } catch (err) {
      return interaction.editReply(`❌ ${err.message}`);
    }
  },
};
