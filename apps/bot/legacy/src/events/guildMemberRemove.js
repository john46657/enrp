const { Events } = require('discord.js');
const { forGuild } = require('../lib/settings');
const { openTickets, closeTicket } = require('../lib/tickets');
const { handleMemberLeave } = require('../lib/applications/decide');

module.exports = {
  name: Events.GuildMemberRemove,
  async execute(member) {
    await handleMemberLeave(member); // Bewerbungen: je nach onLeave ablehnen oder zurückziehen

    if (forGuild(member.guild.id).tickets.onCreatorLeave !== 'close') return;
    const tickets = openTickets(member.guild);
    for (const channelId of Object.keys(tickets).filter((id) => tickets[id].owner === member.id)) {
      const channel = member.guild.channels.cache.get(channelId);
      await channel?.send('👋 Der Ersteller hat den Server verlassen. Das Ticket wird geschlossen …').catch(() => {});
      await closeTicket(channel, null, 'Ersteller hat den Server verlassen');
    }
  },
};
