const { AuditLogEvent, Events } = require('discord.js');
const antiNuke = require('../lib/antiNuke');

module.exports = {
  name: Events.ChannelDelete,
  execute: (channel) => channel.guild && antiNuke.handleDestructive(channel.guild, AuditLogEvent.ChannelDelete, channel.id, channel.name),
};
