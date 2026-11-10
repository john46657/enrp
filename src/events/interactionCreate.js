const { Events } = require('discord.js');
const { replyPrivate } = require('../lib/util');

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction, client) {
    // Vorschläge beim Tippen (z. B. Spielernamen aus den Live-Daten)
    if (interaction.isAutocomplete()) {
      const command = client.commands.get(interaction.commandName);
      await Promise.resolve(command?.autocomplete?.(interaction) ?? interaction.respond([])).catch(() => {});
      return;
    }
    let handler;
    let label;
    if (interaction.isChatInputCommand()) {
      handler = client.commands.get(interaction.commandName)?.execute;
      label = `/${interaction.commandName}`;
    } else if (interaction.isMessageComponent() || interaction.isModalSubmit()) {
      const [prefix, ...args] = interaction.customId.split(':');
      const component = client.components.get(prefix);
      handler = component && ((i) => component(i, args));
      label = interaction.customId;
    }
    if (!handler) return;

    try {
      await handler(interaction);
    } catch (err) {
      console.error(`[${label}]`, err);
      await replyPrivate(interaction, '❌ Da ist etwas schiefgelaufen. Prüfe die Bot-Rechte oder die Konsole.').catch(() => {});
    }
  },
};
