const { Events } = require('discord.js');
const counting = require('../lib/counting');

module.exports = {
  name: Events.MessageDelete,
  execute: (message) => counting.handleDelete(message),
};
