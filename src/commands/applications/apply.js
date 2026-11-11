const { SlashCommandBuilder } = require('discord.js');
const { replyPrivate } = require('../../lib/util');
const { bucket } = require('../../lib/db');
const store = require('../../lib/applications/store');
const flow = require('../../lib/applications/flow');
const decisions = require('../../lib/applications/decide');
const { buildPanel } = require('../../lib/applications/messages');
const { respondTypes, findType } = require('../../lib/applications/choices');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('bewerbung')
    .setDescription('Startet eine Bewerbung (Fragen kommen per Direktnachricht).')
    .addStringOption((o) => o.setName('art').setDescription('Wofür? (ohne Angabe: die Bewerbung aus dem Bewerbungs-Panel)').setAutocomplete(true)),

  autocomplete: (interaction) => respondTypes(interaction),

  async execute(interaction) {
    const types = store.types(interaction.guildId);
    const wanted = interaction.options.getString('art');
    const type = wanted ? findType(interaction.guildId, wanted) : (types.find((t) => t.panel === 'apply') ?? types[0]);
    return flow.offer(interaction, type?.id);
  },

  // Alle Buttons, Menüs und Formulare des Bewerbungssystems (customId "quali:<aktion>:…")
  components: {
    async quali(interaction, [action, a, b]) {
      switch (action) {
        case 'pick': {
          await flow.offer(interaction, interaction.values[0]);
          // Auswahl im Panel zurücksetzen
          const panel = bucket('appPanels', interaction.guildId)[interaction.message.id];
          if (panel) await interaction.message.edit(buildPanel(interaction.guildId, panel.kind)).catch(() => {});
          return;
        }
        case 'apply':
          return flow.offer(interaction, a);
        case 'start':
          return flow.start(interaction, a, b);
        case 'cancel':
          return flow.cancelFromButton(interaction);
        case 'ans':
          return flow.handleSelect(interaction, a);
        case 'skip':
          return flow.handleSkip(interaction, a);
        case 'rb':
          return flow.handleRoblox(interaction, a, b);
        case 'decide':
          return decisions.decide(interaction, a, b);
        case 'reason':
          return decisions.askReason(interaction, a, b);
        case 'reasonsubmit':
          return decisions.decide(interaction, a, b, interaction.fields.getTextInputValue('reason'));
        case 'status':
          return decisions.changeStatus(interaction, a);
        case 'history':
          return decisions.showHistory(interaction, a);
        case 'ticket':
          return decisions.openTicket(interaction, a);
        case 'withdraw':
          return decisions.withdraw(interaction, a, b);
        default:
          return replyPrivate(interaction, 'Diese Aktion ist veraltet.');
      }
    },
  },
};
