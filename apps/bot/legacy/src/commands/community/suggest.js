const { SlashCommandBuilder } = require('discord.js');
const { forGuild } = require('../../lib/settings');
const suggestions = require('../../lib/suggestions');

module.exports = {
  data: new SlashCommandBuilder().setName('vorschlag').setDescription('Reiche einen Vorschlag für den Server ein.'),

  execute: (interaction) => suggestions.startSuggestion(interaction),

  components: {
    async suggest(interaction, [action, categoryId]) {
      switch (action) {
        case 'category': {
          const category = forGuild(interaction.guildId).suggestions.categories.find((c) => c.id === interaction.values[0]);
          return category ? interaction.showModal(suggestions.formModal(category)) : interaction.update({ content: 'Diese Kategorie gibt es nicht mehr.', components: [] });
        }
        case 'submit':
          return suggestions.submit(interaction, categoryId);
        case 'up':
        case 'down':
          return suggestions.vote(interaction, action === 'up');
        default:
          return suggestions.decide(interaction, action);
      }
    },
  },
};
