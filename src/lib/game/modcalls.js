// Mod-Calls aus dem Spiel (/modcall im Chat): Nachricht mit „Übernehmen“-Button im Mod-Call-Kanal des zuständigen
// Discords. Wer übernimmt, wird dem Spieler im Spiel genannt.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const db = require('../db');
const { forGuild } = require('../settings');
const { getChannel, truncate, replyPrivate } = require('../util');
const { profileUrl } = require('../applications/roblox');
const permissions = require('./permissions');
const events = require('./events');
const live = require('./live');
const links = require('../roblox/links');

const KEEP_DAYS = 7;
const store = (guildId) => db.bucket('gameModcalls', guildId);

let notify = async () => {};
const setNotifier = (fn) => {
  notify = fn;
};

function prune(guildId) {
  const calls = store(guildId);
  const limit = Date.now() - KEEP_DAYS * 86_400_000;
  for (const [id, call] of Object.entries(calls)) if (call.at * 1000 < limit) delete calls[id];
}

function render(guildId, id, call) {
  const e = new EmbedBuilder()
    .setColor(call.takenBy ? 0x57f287 : 0xed4245)
    .setTitle(call.takenBy ? '🆘 Mod-Call · übernommen' : '🆘 Mod-Call')
    .setDescription(truncate(call.text || 'Ohne Beschreibung', 2000))
    .addFields(
      { name: 'Spieler', value: `[${call.name ?? call.userId}](${profileUrl(call.userId)}) (\`${call.userId}\`)`, inline: true },
      { name: 'Server', value: call.server, inline: true },
      { name: 'Zeit', value: `<t:${call.at}:R>`, inline: true },
    )
    .setFooter({ text: `${forGuild(guildId).game.brand} · Mod-Call aus dem Spiel` });
  if (call.takenBy) e.addFields({ name: 'Übernommen von', value: `<@${call.takenBy}> <t:${Math.floor(call.takenAt / 1000)}:R>` });
  const components = call.takenBy
    ? []
    : [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`modcall:take:${id}`).setLabel('Übernehmen').setEmoji('🙋').setStyle(ButtonStyle.Primary))];
  return { embeds: [e], components };
}

events.on('modcall', async (event, { client }) => {
  if (event.stale || !event.userId) return;
  for (const guild of events.responsibleGuilds(client, event.ownerId)) {
    const channelId = forGuild(guild.id).game.logs.modcall;
    if (!channelId) continue;
    const calls = store(guild.id);
    if (calls[event.id]) continue;
    prune(guild.id);
    const snapshot = live.serversFor(links.scopeOf(guild.id)).find((s) => s.job === event.job);
    const call = {
      userId: event.userId,
      name: event.name,
      text: event.text,
      at: event.at,
      ownerId: event.ownerId,
      job: event.job,
      server: snapshot ? live.serverLabel(snapshot) : event.ownerId ? 'Privatserver' : 'Öffentlicher Server',
      takenBy: null,
    };
    calls[event.id] = call;
    const channel = await getChannel(guild, channelId);
    const message = await channel?.send(render(guild.id, event.id, call)).catch((err) => console.error('[modcall]', err.message));
    if (message) Object.assign(call, { channelId: channel.id, messageId: message.id });
    db.save();
  }
});

async function handleButton(interaction, [action, id]) {
  if (action !== 'take') return null;
  const call = store(interaction.guildId)[id];
  if (!call) return replyPrivate(interaction, 'Diesen Mod-Call gibt es nicht mehr.');
  if (!permissions.can(interaction.member, 'moderation')) return replyPrivate(interaction, permissions.deny('moderation'));
  if (call.takenBy) return replyPrivate(interaction, `Schon übernommen von <@${call.takenBy}>.`);
  call.takenBy = interaction.user.id;
  call.takenAt = Date.now();
  db.save();
  await interaction.update(render(interaction.guildId, id, call));
  await notify(call.ownerId, call.userId, `🙋 ${interaction.member.displayName} vom Team kümmert sich um deinen Mod-Call.`).catch(() => {});
  return null;
}

// Für Staff-Aktivität: übernommene Mod-Calls je Discord-Nutzer
function takenCounts(guildId, sinceMs) {
  const counts = {};
  for (const call of Object.values(store(guildId))) {
    if (call.takenBy && call.takenAt >= sinceMs) counts[call.takenBy] = (counts[call.takenBy] ?? 0) + 1;
  }
  return counts;
}

module.exports = { handleButton, setNotifier, takenCounts, render };
