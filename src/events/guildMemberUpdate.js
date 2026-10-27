const { Events } = require('discord.js');
const { checkHoisting } = require('../lib/automod');
const { updateLists } = require('../lib/team');
const { forGuild } = require('../lib/settings');

module.exports = {
  name: Events.GuildMemberUpdate,
  async execute(before, member) {
    if (before.displayName !== member.displayName) await checkHoisting(member); // Anti-Hoisting
    // Teamliste neu zeichnen, wenn sich Rollen aus der Liste ändern.
    const listed = forGuild(member.guild.id).team.teamList.roles;
    if (listed.some((id) => before.roles.cache.has(id) !== member.roles.cache.has(id))) await updateLists(member.guild);
  },
};
