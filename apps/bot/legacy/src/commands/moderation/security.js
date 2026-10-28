const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { replyPrivate } = require('../../lib/util');
const security = require('../../lib/security');
const lockdown = require('../../lib/lockdown');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sicherheit')
    .setDescription('Server-Sicherheit.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('verify-panel').setDescription('Postet die Verify-Nachricht in den eingestellten Kanal.'))
    .addSubcommand((s) =>
      s
        .setName('lockdown')
        .setDescription('Notfall: @everyone darf in keinem Textkanal mehr schreiben.')
        .addStringOption((o) => o.setName('grund').setDescription('Grund (steht im Audit-Log)').setRequired(true).setMaxLength(200)),
    )
    .addSubcommand((s) =>
      s
        .setName('entsperren')
        .setDescription('Lockdown aufheben und vorherige Kanalrechte wiederherstellen.')
        .addStringOption((o) => o.setName('grund').setDescription('Grund').setRequired(true).setMaxLength(200)),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'lockdown' || sub === 'entsperren') {
      const reason = interaction.options.getString('grund');
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        if (sub === 'lockdown') {
          const { locked, failed } = await lockdown.lock(interaction.guild, interaction.user.id, reason);
          await lockdown.announce(interaction.guild, `${interaction.user} hat den Server gesperrt (${locked} Kanäle). Grund: ${reason}`);
          return interaction.editReply(`🔒 ${locked} Kanäle gesperrt${failed ? `, ${failed} ohne Berechtigung übersprungen` : ''}. Aufheben mit \`/sicherheit entsperren\`.`);
        }
        const { restored } = await lockdown.unlock(interaction.guild, reason);
        await lockdown.announce(interaction.guild, `${interaction.user} hat den Lockdown aufgehoben (${restored} Kanäle). Grund: ${reason}`);
        return interaction.editReply(`🔓 Lockdown aufgehoben, ${restored} Kanäle wiederhergestellt.`);
      } catch (err) {
        return interaction.editReply(`❌ ${err.message}`);
      }
    }
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
