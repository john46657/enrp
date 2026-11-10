const { AuditLogEvent, Events } = require('discord.js');
const antiNuke = require('../lib/antiNuke');

module.exports = {
  name: Events.GuildRoleDelete,
  execute: (role) => antiNuke.handleDestructive(role.guild, AuditLogEvent.RoleDelete, role.id, role.name),
};
