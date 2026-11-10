const { AuditLogEvent, Events } = require('discord.js');
const antiNuke = require('../lib/antiNuke');

module.exports = {
  name: Events.GuildBanAdd,
  execute: (ban) => antiNuke.handleDestructive(ban.guild, AuditLogEvent.MemberBanAdd, ban.user.id, ban.user.username),
};
