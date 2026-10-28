// Verbindet die Bot-Module mit dem Dashboard: was nach dem Speichern passiert, Buttons und Live-Daten.
const crypto = require('node:crypto');
const { registerAction, registerLive, onSave, registerRoute } = require('./server');
const tiktok = require('../lib/tiktok/service');
const { PROVIDERS } = require('../lib/tiktok/providers');
const { bucket } = require('../lib/db');
const tickets = require('../lib/tickets');
const stats = require('../lib/stats');
const team = require('../lib/team');
const automod = require('../lib/automod');
const security = require('../lib/security');
const giveaways = require('../lib/giveaways');
const suggestions = require('../lib/suggestions');
const careers = require('../lib/careers');
const appMessages = require('../lib/applications/messages');

const touched = (paths, prefix) => paths.some((p) => p === prefix || p.startsWith(`${prefix}.`) || prefix.startsWith(`${p}.`));

onSave(async (guild, paths) => {
  if (touched(paths, 'tickets')) await tickets.refreshPanels(guild);
  if (touched(paths, 'stats')) await stats.updateStats(guild);
  if (touched(paths, 'team')) await team.updateLists(guild);
  if (touched(paths, 'channels') || touched(paths, 'roles')) await appMessages.refreshPanels(guild);
});

registerAction('verify-post', (guild) => security.postVerifyMessage(guild));
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

// ---------- TikTok LIVE ----------

registerLive('tiktok', (guild) => {
  const data = tiktok.dataOf(guild.id);
  return { provider: tiktok.providerStatus(guild.id), creators: Object.values(data.creators), sessions: data.sessions.slice(0, 50), events: data.events.slice(0, 50) };
});
registerAction('tiktok-add', (guild, { username }, member) => tiktok.addCreator(guild.id, username, member.id));
registerAction('tiktok-remove', (guild, { username }) => tiktok.removeCreator(guild.id, username));
registerAction('tiktok-toggle', (guild, { username, enabled }) => tiktok.setCreatorEnabled(guild.id, username, enabled));
registerAction('tiktok-test', (guild, body, member) => tiktok.sendTest(guild, `${member.user.tag} (Dashboard)`));

// Webhook für einen autorisierten externen Live-Status-Dienst (Provider "webhook").
// POST /hooks/tiktok  Authorization: Bearer <TIKTOK_WEBHOOK_SECRET>  { "username": "name", "status": "live" | "offline", "url"?: "https://www.tiktok.com/@name/live" }
registerRoute((app, { rateLimited }) => {
  app.post('/hooks/tiktok', (req, res) => {
    const secret = process.env.TIKTOK_WEBHOOK_SECRET;
    if (!secret) return res.status(503).json({ error: 'Webhook nicht eingerichtet' });
    if (rateLimited(`hook:${req.ip}`, 120)) return res.status(429).json({ error: 'Zu viele Anfragen' });
    const given = Buffer.from(req.get('Authorization') ?? '');
    const expected = Buffer.from(`Bearer ${secret}`);
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return res.status(401).json({ error: 'Nicht autorisiert' });
    const { username, status, url, title } = req.body ?? {};
    let name;
    let link = null;
    try {
      name = tiktok.normalizeUsername(username);
      if (url) link = tiktok.parseLiveUrl(url).url;
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    if (!['live', 'offline'].includes(status)) return res.status(400).json({ error: 'status muss "live" oder "offline" sein' });
    PROVIDERS.webhook.report({ username: name, status, url: link, title: typeof title === 'string' ? title.slice(0, 200) : undefined });
    res.json({ ok: true });
  });
});

// ---------- Giveaways ----------

registerLive('giveaways', (guild) => ({
  stats: giveaways.statsOf(guild.id),
  list: Object.values(giveaways.giveawaysOf(guild.id))
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, 100)
    .map((g) => ({ messageId: g.messageId, channel: guild.channels.cache.get(g.channelId)?.name, prize: g.prize, winners: g.winnerIds, entries: Object.keys(g.entries).length, endsAt: g.endsAt, startedAt: g.startedAt, ended: g.ended, cancelled: g.cancelled, claims: g.claims })),
}));
const findGiveaway = (guild, messageId) => {
  const g = giveaways.giveawaysOf(guild.id)[String(messageId)];
  if (!g) throw new Error('Giveaway nicht gefunden.');
  return g;
};
registerAction('giveaway-end', (guild, { messageId }) => giveaways.endGiveaway(guild, findGiveaway(guild, messageId)).then(() => null));
registerAction('giveaway-reroll', (guild, { messageId }) => giveaways.reroll(guild, findGiveaway(guild, messageId), 1));
registerAction('giveaway-cancel', (guild, { messageId }) => giveaways.cancelGiveaway(guild, findGiveaway(guild, messageId)));
registerAction('giveaway-template-start', (guild, { templateId }, member) => {
  const template = require('../lib/settings').forGuild(guild.id).giveaways.templates.find((t) => t.id === templateId);
  if (!template) throw new Error('Vorlage nicht gefunden – erst speichern.');
  return giveaways.startFromTemplate(guild, template, member.id).then(() => null);
});

registerLive('suggestions', (guild) =>
  Object.entries(suggestions.suggestionsOf(guild.id))
    .map(([messageId, s]) => ({ messageId, number: s.number, category: s.category, title: s.fields[0]?.[1] ?? '', status: s.status, up: Object.keys(s.up).length, down: Object.keys(s.down).length, createdAt: s.createdAt }))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 100),
);

// ---------- Rang-Aufstieg ----------

registerLive('careers', async (guild) => ({ progress: await careers.progressList(guild), history: careers.historyOf(guild.id).slice(0, 15).map((e) => ({ ...e, user: guild.members.cache.get(e.userId)?.user.username ?? e.userId })) }));
registerAction('careers-check', async (guild) => careers.checkGuild(guild));
