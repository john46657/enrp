const { Events } = require('discord.js');
const config = require('../../config.json');
const { embed, sendTo, fill } = require('../lib/util');

module.exports = {
  name: Events.GuildMemberAdd,
  async execute(member) {
    if (config.roles.autoRole) {
      await member.roles.add(config.roles.autoRole, 'Auto-Rolle').catch((err) => console.error('[autoRole]', err.message));
    }

    const text = fill(config.welcome.message, {
      user: member.toString(),
      name: member.displayName,
      server: member.guild.name,
      count: member.guild.memberCount,
    });
    await sendTo(member.guild, 'welcome', {
      content: member.toString(),
      embeds: [embed().setTitle('👋 Neues Mitglied').setDescription(text).setThumbnail(member.displayAvatarURL({ size: 256 }))],
    });
  },
};
