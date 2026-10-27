const { Events } = require('discord.js');
const { checkHoisting } = require('../lib/automod');

module.exports = {
  name: Events.GuildMemberUpdate,
  async execute(before, member) {
    if (before.displayName !== member.displayName) await checkHoisting(member); // Anti-Hoisting
  },
};
