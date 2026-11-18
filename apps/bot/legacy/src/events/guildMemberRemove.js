const { Events } = require('discord.js');
const { handleCreatorLeave } = require('../lib/tickets');
const { handleMemberLeave } = require('../lib/applications/decide');

module.exports = {
  name: Events.GuildMemberRemove,
  async execute(member) {
    await handleMemberLeave(member); // Bewerbungen: je nach onLeave ablehnen oder zurückziehen
    await handleCreatorLeave(member); // Tickets: je nach onCreatorLeave Hinweis senden oder schließen
  },
};
