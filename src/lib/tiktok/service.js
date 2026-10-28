// TikTok-LIVE-Service: vergleicht Provider-Ergebnisse mit dem gespeicherten Stand, registriert Live-Sessions
// idempotent, verschickt die Discord-Nachrichten (über einen austauschbaren Notifier) und protokolliert alles.
//
// Daten je Server in data/db.json unter tiktok.<guildId>:
//   creators  { username: { username, enabled, addedBy, addedAt, status, lastCheckedAt, lastSuccessAt, lastError, offlineSince, lastNotifiedAt } }
//   sessions  [ { id, username, source: 'provider' | 'manual', url, startedAt, endedAt, channelId, messageId, notified, notifyError, endNotified, by } ]
//   events    [ { at, level, type, message, username? } ]   (Fehler- und Ereignisprotokoll)
//   provider  { name, lastRunAt, lastSuccessAt, lastError, failures, nextCheckAt }
// Gespeichert werden nur TikTok-Benutzernamen und Discord-IDs, keine weiteren personenbezogenen Daten.
const { ChannelType, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { forGuild, base } = require('../settings');
const { bucket, save } = require('../db');
const { fill } = require('../util');
const { providerFor } = require('./providers');

const MAX_EVENTS = 200;
const MAX_SESSIONS = 200;
const NOTIFY_COOLDOWN = 5 * 60_000; // höchstens eine LIVE-Nachricht je Creator in 5 Minuten
const MANUAL_DUPLICATE = 30 * 60_000; // gleicher Creator/Link manuell höchstens alle 30 Minuten
const MAX_BACKOFF = 15 * 60_000;
const USERNAME = /^[a-z0-9._]{2,24}$/;
const TIKTOK_HOSTS = new Set(['tiktok.com', 'www.tiktok.com', 'm.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com']);

const settingsOf = (guildId) => forGuild(guildId).tiktok;
function dataOf(guildId) {
  const data = bucket('tiktok', guildId);
  data.creators ??= {};
  data.sessions ??= [];
  data.events ??= [];
  data.provider ??= { name: null, lastRunAt: null, lastSuccessAt: null, lastError: null, failures: 0, nextCheckAt: 0 };
  return data;
}

function logEvent(guildId, level, type, message, username) {
  const { events } = dataOf(guildId);
  events.unshift({ at: Date.now(), level, type, message, ...(username && { username }) });
  events.length = Math.min(events.length, MAX_EVENTS);
  save();
  if (level === 'error') console.error(`[tiktok] ${guildId} ${type}: ${message}`);
}

// ---------- Eingaben ----------

// "@Name", "name" oder ein Profil-/Live-Link → "name" (klein). Wirft bei ungültiger Eingabe.
function normalizeUsername(input) {
  let value = String(input ?? '').trim();
  const fromUrl = value.match(/tiktok\.com\/@([^/?#]+)/i);
  if (fromUrl) value = fromUrl[1];
  value = value.replace(/^@/, '').toLowerCase();
  if (!USERNAME.test(value)) throw new Error('Ungültiger TikTok-Benutzername (2–24 Zeichen: Buchstaben, Zahlen, Punkt, Unterstrich).');
  return value;
}

// Nur https-Links auf TikTok-Domains. Gibt { url, username } zurück (username kann bei Kurzlinks fehlen).
function parseLiveUrl(input) {
  let url;
  try {
    url = new URL(String(input ?? '').trim());
  } catch {
    throw new Error('Das ist kein gültiger Link.');
  }
  if (url.protocol !== 'https:' || !TIKTOK_HOSTS.has(url.hostname.toLowerCase())) throw new Error('Erlaubt sind nur https-Links auf tiktok.com.');
  if (url.username || url.password || url.port) throw new Error('Ungültiger TikTok-Link.');
  const match = url.pathname.match(/^\/@([^/]+)/);
  let username = null;
  if (match) username = normalizeUsername(match[1]);
  else if (!['vm.tiktok.com', 'vt.tiktok.com'].includes(url.hostname.toLowerCase())) throw new Error('Der Link muss auf ein Profil oder einen Livestream zeigen (tiktok.com/@name/live).');
  url.hash = '';
  return { url: url.toString(), username };
}

// ---------- Creator verwalten ----------

function addCreator(guildId, input, by) {
  const username = normalizeUsername(input);
  const { creators } = dataOf(guildId);
  if (creators[username]) throw new Error(`@${username} wird bereits überwacht.`);
  if (Object.keys(creators).length >= 50) throw new Error('Höchstens 50 Creator je Server.');
  creators[username] = { username, enabled: true, addedBy: by, addedAt: Date.now(), status: 'unknown', lastCheckedAt: null, lastSuccessAt: null, lastError: null, offlineSince: null, lastNotifiedAt: null };
  save();
  logEvent(guildId, 'info', 'creator_added', `@${username} hinzugefügt`, username);
  return creators[username];
}

function removeCreator(guildId, input) {
  const username = normalizeUsername(input);
  const { creators } = dataOf(guildId);
  if (!creators[username]) throw new Error(`@${username} wird nicht überwacht.`);
  delete creators[username];
  save();
  logEvent(guildId, 'info', 'creator_removed', `@${username} entfernt`, username);
}

function setCreatorEnabled(guildId, input, enabled) {
  const username = normalizeUsername(input);
  const creator = dataOf(guildId).creators[username];
  if (!creator) throw new Error(`@${username} wird nicht überwacht.`);
  creator.enabled = Boolean(enabled);
  save();
  logEvent(guildId, 'info', 'creator_toggled', `@${username} ${creator.enabled ? 'aktiviert' : 'deaktiviert'}`, username);
}

// ---------- Discord-Nachrichten ----------

const profileUrl = (username) => `https://www.tiktok.com/@${username}`;

function liveEmbed(guildId, { username, url, manual, by, test }) {
  const { template } = settingsOf(guildId);
  const vars = { brand: base.serverName, creator: username ?? 'Creator', url: url ?? '' };
  const result = new EmbedBuilder()
    .setColor(template.color || '#FE2C55')
    .setTitle(fill(template.title, vars).slice(0, 256))
    .setDescription(fill(template.text, vars).slice(0, 2000))
    .addFields(
      { name: 'Creator', value: username ? `[@${username}](${profileUrl(username)})` : '—', inline: true },
      { name: 'Plattform', value: 'TikTok LIVE', inline: true },
      { name: 'Stream', value: url ? `[Zum Livestream](${url})` : 'Link nicht verfügbar', inline: true },
    )
    .setTimestamp();
  if (url) result.setURL(url);
  const footer = [fill(template.footer ?? '', vars)];
  if (manual) footer.push(`Manuell angekündigt${by ? ` von ${by}` : ''}`);
  if (test) footer.push('Testnachricht – kein echter Livestream');
  result.setFooter({ text: footer.filter(Boolean).join(' · ').slice(0, 2048) || base.serverName });
  return result;
}

function endEmbed(guildId, username) {
  const { endTemplate } = settingsOf(guildId);
  const vars = { brand: base.serverName, creator: username };
  return new EmbedBuilder().setColor('#4B5563').setTitle(fill(endTemplate.title, vars).slice(0, 256)).setDescription(fill(endTemplate.text, vars).slice(0, 2000)).setTimestamp();
}

async function targetChannel(guild) {
  const { channel: channelId } = settingsOf(guild.id);
  if (!channelId) throw new Error('Kein Benachrichtigungskanal eingestellt.');
  const channel = guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId).catch(() => null));
  if (!channel || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) throw new Error('Der Benachrichtigungskanal existiert nicht mehr.');
  const perms = channel.permissionsFor(guild.members.me);
  const missing = [
    [PermissionFlagsBits.ViewChannel, 'Kanal sehen'],
    [PermissionFlagsBits.SendMessages, 'Nachrichten senden'],
    [PermissionFlagsBits.EmbedLinks, 'Links einbetten'],
  ].filter(([flag]) => !perms?.has(flag));
  if (missing.length) throw new Error(`Fehlende Berechtigung im Kanal: ${missing.map(([, label]) => label).join(', ')}`);
  return channel;
}

// Standard-Notifier: schreibt nach Discord. Rolle nur, wenn eingestellt; @everyone/@here nie.
const discordNotifier = {
  async live(guild, payload, { ping = true } = {}) {
    const channel = await targetChannel(guild);
    const { role } = settingsOf(guild.id);
    const message = await channel.send({
      content: ping && role ? `<@&${role}>` : undefined,
      embeds: [liveEmbed(guild.id, payload)],
      allowedMentions: { parse: [], roles: ping && role ? [role] : [] },
    });
    return { channelId: channel.id, messageId: message.id };
  },
  async end(guild, username) {
    const channel = await targetChannel(guild);
    const message = await channel.send({ embeds: [endEmbed(guild.id, username)], allowedMentions: { parse: [] } });
    return { channelId: channel.id, messageId: message.id };
  },
};

// ---------- Status verarbeiten ----------

function pushSession(guildId, session) {
  const { sessions } = dataOf(guildId);
  sessions.unshift(session);
  sessions.length = Math.min(sessions.length, MAX_SESSIONS);
  save();
}
const openSession = (guildId, username) => dataOf(guildId).sessions.find((s) => s.username === username && s.source === 'provider' && !s.endedAt);

// Ein Ergebnis des Providers auf einen Creator anwenden. Gibt zurück, was passiert ist (für Tests und Logs).
async function applyResult(guild, creator, result, { now = Date.now(), notifier = discordNotifier } = {}) {
  const { endMessages, endGraceMinutes } = settingsOf(guild.id);
  creator.lastCheckedAt = now;

  if (!result || result.status === 'unknown' || result.error) {
    // Unbekannt: nichts am Live-Status ändern, insbesondere keinen Stream beenden.
    creator.lastError = result?.error ?? 'Kein Ergebnis';
    save();
    return 'unknown';
  }
  creator.lastSuccessAt = now;
  creator.lastError = null;

  if (result.status === 'live') {
    creator.offlineSince = null;
    creator.status = 'live';
    if (openSession(guild.id, creator.username)) {
      save();
      return 'still-live'; // Idempotent: dieselbe Session wird nicht erneut angekündigt.
    }
    const session = { id: `${creator.username}-${now}`, username: creator.username, source: 'provider', url: result.url ?? null, startedAt: now, endedAt: null, notified: false, notifyError: null, endNotified: false };
    pushSession(guild.id, session);
    if (creator.lastNotifiedAt && now - creator.lastNotifiedAt < NOTIFY_COOLDOWN) {
      session.notifyError = 'Unterdrückt (Schutz vor Benachrichtigungs-Spam)';
      logEvent(guild.id, 'warn', 'notify_suppressed', `LIVE von @${creator.username} erkannt, Nachricht wegen Spam-Schutz unterdrückt`, creator.username);
      save();
      return 'live-suppressed';
    }
    try {
      Object.assign(session, await notifier.live(guild, { username: creator.username, url: result.url ?? profileUrl(creator.username) + '/live' }), { notified: true });
      creator.lastNotifiedAt = now;
      logEvent(guild.id, 'info', 'live_started', `@${creator.username} ist live – Nachricht gesendet`, creator.username);
    } catch (err) {
      session.notifyError = err.message;
      logEvent(guild.id, 'error', 'notify_failed', `LIVE von @${creator.username}: ${err.message}`, creator.username);
    }
    save();
    return 'live-started';
  }

  // offline
  const session = openSession(guild.id, creator.username);
  if (!session) {
    creator.status = 'offline';
    creator.offlineSince = null;
    save();
    return 'offline';
  }
  // Erst nach der Toleranzzeit als beendet werten (kurze Aussetzer sind kein Stream-Ende).
  creator.offlineSince ??= now;
  if (now - creator.offlineSince < endGraceMinutes * 60_000) {
    save();
    return 'offline-pending';
  }
  session.endedAt = creator.offlineSince;
  creator.status = 'offline';
  creator.offlineSince = null;
  logEvent(guild.id, 'info', 'live_ended', `LIVE von @${creator.username} beendet`, creator.username);
  if (endMessages) {
    try {
      await notifier.end(guild, creator.username);
      session.endNotified = true;
    } catch (err) {
      logEvent(guild.id, 'error', 'end_notify_failed', `LIVE-Ende von @${creator.username}: ${err.message}`, creator.username);
    }
  }
  save();
  return 'live-ended';
}

// Einen Server prüfen. Fehler des Providers führen zu Backoff, nicht zu falschen Statuswechseln.
async function pollGuild(guild, { now = Date.now(), notifier = discordNotifier, provider } = {}) {
  const cfg = settingsOf(guild.id);
  const data = dataOf(guild.id);
  provider ??= providerFor(cfg.provider);
  data.provider.name = provider.name;
  data.provider.lastRunAt = now;
  const creators = Object.values(data.creators).filter((c) => c.enabled);
  if (!creators.length) {
    data.provider.nextCheckAt = now + Math.max(60, cfg.pollSeconds) * 1000;
    save();
    return [];
  }
  let results;
  try {
    results = await withTimeout(provider.check(creators.map((c) => c.username), now), 20_000);
  } catch (err) {
    data.provider.failures += 1;
    data.provider.lastError = err.message;
    const delay = Math.min(MAX_BACKOFF, Math.max(60, cfg.pollSeconds) * 1000 * 2 ** data.provider.failures);
    data.provider.nextCheckAt = now + delay;
    logEvent(guild.id, 'error', 'provider_failed', `${provider.label}: ${err.message} – nächster Versuch in ${Math.round(delay / 1000)} s`);
    for (const c of creators) c.lastError = `Provider-Fehler: ${err.message}`;
    save();
    return creators.map(() => 'unknown');
  }
  data.provider.failures = 0;
  data.provider.lastError = null;
  data.provider.lastSuccessAt = now;
  data.provider.nextCheckAt = now + Math.max(60, cfg.pollSeconds) * 1000;
  const outcomes = [];
  for (const creator of creators) outcomes.push(await applyResult(guild, creator, results.get(creator.username), { now, notifier }));
  save();
  return outcomes;
}

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => (timer = setTimeout(() => reject(new Error(`Zeitüberschreitung nach ${ms / 1000} s`)), ms)))]).finally(() => clearTimeout(timer));
}

// ---------- Manuell & Test ----------

async function announceManual(guild, { url: input, by, byTag }, { now = Date.now(), notifier = discordNotifier } = {}) {
  const { url, username } = parseLiveUrl(input);
  const recent = dataOf(guild.id).sessions.find((s) => now - s.startedAt < MANUAL_DUPLICATE && (s.url === url || (username && s.username === username)));
  if (recent) throw new Error(`Dieser Livestream wurde bereits <t:${Math.floor(recent.startedAt / 1000)}:R> angekündigt.`);
  const session = { id: `manual-${now}`, username, source: 'manual', url, startedAt: now, endedAt: null, by, notified: false, notifyError: null };
  pushSession(guild.id, session);
  try {
    Object.assign(session, await notifier.live(guild, { username, url, manual: true, by: byTag }), { notified: true });
    logEvent(guild.id, 'info', 'manual_announce', `Manuelle Ankündigung von ${byTag}: ${url}`, username ?? undefined);
  } catch (err) {
    session.notifyError = err.message;
    logEvent(guild.id, 'error', 'manual_failed', `Manuelle Ankündigung von ${byTag}: ${err.message}`, username ?? undefined);
    save();
    throw err;
  }
  save();
  return session;
}

async function sendTest(guild, byTag, { notifier = discordNotifier } = {}) {
  const result = await notifier.live(guild, { username: 'beispiel', url: null, test: true }, { ping: false });
  logEvent(guild.id, 'info', 'test_sent', `Testnachricht von ${byTag} gesendet (kein echter Livestream)`);
  return result;
}

// ---------- Hintergrund ----------

let running = false;
function startTiktokWatcher(client) {
  setInterval(async () => {
    if (running) return; // keine überlappenden Durchläufe
    running = true;
    try {
      for (const guild of client.guilds.cache.values()) {
        const cfg = settingsOf(guild.id);
        if (!cfg.enabled || cfg.provider === 'none') continue;
        if (Date.now() < (dataOf(guild.id).provider.nextCheckAt ?? 0)) continue;
        await pollGuild(guild).catch((err) => logEvent(guild.id, 'error', 'poll_crashed', err.message));
      }
    } finally {
      running = false;
    }
  }, 30_000);
}

function providerStatus(guildId) {
  const cfg = settingsOf(guildId);
  const provider = providerFor(cfg.provider);
  return { name: provider.name, label: provider.label, ...provider.status(), ...dataOf(guildId).provider };
}

module.exports = {
  dataOf,
  logEvent,
  normalizeUsername,
  parseLiveUrl,
  addCreator,
  removeCreator,
  setCreatorEnabled,
  applyResult,
  pollGuild,
  announceManual,
  sendTest,
  providerStatus,
  liveEmbed,
  startTiktokWatcher,
  profileUrl,
  NOTIFY_COOLDOWN,
  MANUAL_DUPLICATE,
};
