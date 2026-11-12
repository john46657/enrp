const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { replyPrivate } = require('../../lib/util');
const { postPanel } = require('../../lib/applications/messages');
const panels = require('../../lib/applications/panels');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('bewerbungspanel')
    .setDescription('Postet ein Bewerbungs-Panel in diesem Kanal.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((o) => o.setName('panel').setDescription('Welches Panel? (Standard: das erste)').setAutocomplete(true)),

  autocomplete(interaction) {
    const query = interaction.options.getFocused().toLowerCase();
    return panels
      .panelsOf(interaction.guildId)
      .filter((p) => p.name.toLowerCase().includes(query))
      .slice(0, 25)
      .map((p) => ({ name: p.name.slice(0, 100), value: p.id }));
  },

  async execute(interaction) {
    const list = panels.panelsOf(interaction.guildId);
    const panel = panels.getPanel(interaction.guildId, interaction.options.getString('panel') ?? list[0]?.id);
    if (!panel) {
      return replyPrivate(interaction, 'Es gibt noch kein Panel. Lege es mit `/bewerbung-verwalten uebersicht` → **Panels** an (dafür brauchst du mindestens eine Bewerbung).');
    }
    await postPanel(interaction.channel, panel.id);
    await replyPrivate(interaction, `✅ Panel **${panel.name}** gepostet. Es aktualisiert sich automatisch, wenn sich die Bewerbungen ändern.`);
  },
};
