// Live-Panel: eine Status-Nachricht je Discord, die sich jede Minute selbst aktualisiert (/spiel-admin livepanel).
const settings = require('../settings');
const { getChannel } = require('../util');
const { statusMessage } = require('../roblox/status');
const cad = require('./cad');

const INTERVAL_MS = 60_000;
let timer = null;

const openCalls = (guildId) => cad.list(guildId, { status: 'offen', source: 'ingame', limit: 1000 }).length;

async function render(guildId) {
  return statusMessage(guildId, { openCalls: openCalls(guildId) });
}

async function post(guild, channel) {
  const old = settings.forGuild(guild.id).game.livePanel;
  if (old.channelId && old.messageId) {
    const oldChannel = await getChannel(guild, old.channelId);
    await oldChannel?.messages.delete(old.messageId).catch(() => {});
  }
  const message = await channel.send(await render(guild.id));
  settings.set(guild.id, 'game.livePanel.channelId', channel.id);
  settings.set(guild.id, 'game.livePanel.messageId', message.id);
  return message;
}

async function refresh(guild) {
  const panel = settings.forGuild(guild.id).game.livePanel;
  if (!panel.channelId || !panel.messageId) return;
  const channel = await getChannel(guild, panel.channelId);
  const message = await channel?.messages.fetch(panel.messageId).catch(() => null);
  if (!message) {
    // Nachricht oder Kanal gelöscht → Panel abmelden
    settings.set(guild.id, 'game.livePanel.messageId', '');
    return;
  }
  await message.edit(await render(guild.id)).catch((err) => console.error('[live-panel]', err.message));
}

function start(client) {
  clearInterval(timer);
  timer = setInterval(() => {
    for (const guild of client.guilds.cache.values()) refresh(guild).catch(() => {});
  }, INTERVAL_MS);
}

module.exports = { start, post, refresh };
