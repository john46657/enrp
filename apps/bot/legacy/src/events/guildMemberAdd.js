const { Events } = require('discord.js');
const { forGuild } = require('../lib/settings');
const { embed, sendTo, fill } = require('../lib/util');
const { checkHoisting } = require('../lib/automod');
const security = require('../lib/security');

module.exports = {
  name: Events.GuildMemberAdd,
  async execute(member) {
    const config = forGuild(member.guild.id);
    if (await security.handleJoin(member)) return; // Account zu neu → gekickt
    await checkHoisting(member);
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
