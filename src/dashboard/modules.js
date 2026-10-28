// Verbindet die Bot-Module mit dem Dashboard: was nach dem Speichern passiert, Buttons und Live-Daten.
const { registerAction, registerLive, onSave } = require('./server');
const { bucket } = require('../lib/db');
const tickets = require('../lib/tickets');
const stats = require('../lib/stats');
const team = require('../lib/team');
const automod = require('../lib/automod');
const appMessages = require('../lib/applications/messages');

const touched = (paths, prefix) => paths.some((p) => p === prefix || p.startsWith(`${prefix}.`) || prefix.startsWith(`${p}.`));

onSave(async (guild, paths) => {
  if (touched(paths, 'tickets')) await tickets.refreshPanels(guild);
  if (touched(paths, 'stats')) await stats.updateStats(guild);
  if (touched(paths, 'team')) await team.updateLists(guild);
  if (touched(paths, 'channels') || touched(paths, 'roles')) await appMessages.refreshPanels(guild);
});

registerAction('honeypot-notice', (guild) => automod.postHoneypotNotice(guild));
registerAction('ticket-panels-refresh', (guild) => tickets.refreshPanels(guild));
registerAction('stats-update', (guild) => stats.updateStats(guild));
registerAction('team-lists-update', (guild) => team.updateLists(guild));

registerLive('overview', (guild) => ({
  openTickets: Object.keys(tickets.openTickets(guild)).length,
  warnings: Object.values(bucket('warnings', guild.id)).reduce((n, list) => n + list.length, 0),
  absences: Object.keys(team.absencesOf(guild.id)).length,
  statChannels: Object.keys(stats.channelsOf(guild.id)).length,
}));

registerLive('tickets', (guild) =>
  Object.entries(tickets.openTickets(guild)).map(([channelId, t]) => ({
    channelId,
    channel: guild.channels.cache.get(channelId)?.name,
    number: t.number,
    type: t.type,
    owner: t.owner,
    claimedBy: t.claimedBy ?? null,
    openedAt: t.openedAt,
  })),
);

registerLive('absences', (guild) => Object.entries(team.absencesOf(guild.id)).map(([userId, a]) => ({ userId, ...a })));
registerAction('absence-end', async (guild, { userId }) => {
  const member = await guild.members.fetch(String(userId)).catch(() => null);
  if (!member) throw new Error('Mitglied nicht gefunden.');
  await team.setAbsence(member, null);
});
