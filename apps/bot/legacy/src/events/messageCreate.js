const { Events } = require('discord.js');
const { forGuild } = require('../lib/settings');
const { bucket, save } = require('../lib/db');
const { levelInfo } = require('../lib/leveling');
const { embed, getChannel } = require('../lib/util');
const { trackMessage } = require('../lib/tickets');
const { handleDirectMessage } = require('../lib/applications/flow');
const automod = require('../lib/automod');
const scamImages = require('../lib/scamImages');
const counting = require('../lib/counting');

const cooldowns = new Map();

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    if (message.author.bot) return;
    if (!message.inGuild()) return handleDirectMessage(message);
    if (await automod.handleMessage(message)) return; // Auto-Mod oder Honeypot hat die Nachricht entfernt
    if (await scamImages.checkMessage(message)) return; // bekanntes oder massenhaft gepostetes Scam-Bild
    trackMessage(message);
    await counting.handleMessage(message);

    const config = forGuild(message.guildId);
    const { leveling } = config;
    if (!leveling.enabled) return;

    const key = `${message.guildId}:${message.author.id}`;
    const now = Date.now();
    if (now - (cooldowns.get(key) ?? 0) < leveling.cooldownSeconds * 1000) return;
    cooldowns.set(key, now);

    const entry = (bucket('levels', message.guildId)[message.author.id] ??= { xp: 0 });
    const before = levelInfo(entry.xp).level;
    entry.xp += leveling.xpMin + Math.floor(Math.random() * (leveling.xpMax - leveling.xpMin + 1));
    save();

    const after = levelInfo(entry.xp).level;
    if (after <= before) return;

    const rewardId = leveling.roleRewards[after];
    if (rewardId && message.member) {
      await message.member.roles.add(rewardId, `Level ${after} erreicht`).catch((err) => console.error('[levelReward]', err.message));
    }

    const channel = (await getChannel(message.guild, config.channels.levelUp)) ?? message.channel;
    await channel
      .send({
        embeds: [
          embed('success').setDescription(
            `🎉 ${message.author} ist jetzt **Level ${after}**!${rewardId ? ` Belohnung: <@&${rewardId}>` : ''}`,
          ),
        ],
        allowedMentions: { users: [message.author.id] },
      })
      .catch(() => {});
  },
};
