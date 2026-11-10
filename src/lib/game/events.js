// Ereignis-Eingang (Webhooks aus dem Spiel): Das Spiel schickt Ereignisse gebündelt und signiert an die Bridge
// (POST /bridge/v1/events, Signaturprüfung in web/auth.js). Hier werden sie geprüft und verarbeitet:
//   - Prüfung jedes Ereignisses (Format, Typ, Zeitstempel; Zukunft wird abgelehnt, sehr alte nicht mehr gemeldet)
//   - Deduplizierung über die Ereignis-ID, auch über Neustarts hinweg (Schutz vor doppelter Verarbeitung/Replay)
//   - Warteschlange: Die Bridge antwortet sofort, verarbeitet wird danach der Reihe nach
//   - Wiederholung bei Fehlern (bis MAX_ATTEMPTS, mit wachsender Pause), danach wird der Fehler protokolliert
//   - Das Spiel wiederholt selbst, wenn die Bridge nicht mit 2xx antwortet (Puffer im Spiel-Skript)
const { EmbedBuilder } = require('discord.js');
const db = require('../db');
const links = require('../roblox/links');
const { forGuild } = require('../settings');
const { getChannel, truncate } = require('../util');
const { parseEvent, inScope, logTypeOf } = require('./protocol');
const { profileUrl } = require('../applications/roblox');

const MAX_ATTEMPTS = 3;
const MAX_BATCH = 100; // Ereignisse pro Anfrage
const SEEN_LIMIT = 5000;
const HISTORY_LIMIT = 3000;

const handlers = new Map(); // Typ → [fn]
const queue = []; // { event, attempts }
const queued = new Set(); // IDs, die gerade in der Warteschlange stehen
const state = { lastEventAt: null, lastError: null, processed: 0, rejected: 0, duplicates: 0, failed: 0, working: false, client: null };

const seenStore = () => (db.data.gameEventSeen ??= []);
const seen = new Set(seenStore());
const history = () => (db.data.gameEvents ??= []);

const on = (type, fn) => handlers.set(type, [...(handlers.get(type) ?? []), fn]);

function markSeen(id) {
  seen.add(id);
  const list = seenStore();
  list.push(id);
  if (list.length > SEEN_LIMIT) for (const old of list.splice(0, list.length - SEEN_LIMIT)) seen.delete(old);
}

function remember(event) {
  if (event.type === 'ack') return;
  const { stale, ...rest } = event;
  history().push(rest);
  if (history().length > HISTORY_LIMIT) history().splice(0, history().length - HISTORY_LIMIT);
}

// Discords, die dieses Ereignis sehen dürfen (Haupt-Discord alles, Privatserver-Discord nur seine Server)
const guildsFor = (client, ownerId) => [...client.guilds.cache.values()].filter((g) => inScope(links.scopeOf(g.id), ownerId));

// Notrufe/Mod-Calls gehen an den zuständigen Discord: verknüpfter Privatserver-Discord, sonst Haupt-Discord(s).
function responsibleGuilds(client, ownerId) {
  if (ownerId) {
    const link = links.listPrivateServers().find((l) => l.ownerId === ownerId && client.guilds.cache.has(l.guildId));
    if (link) return [client.guilds.cache.get(link.guildId)];
  }
  return links.mainGuildIds().map((id) => client.guilds.cache.get(id)).filter(Boolean);
}

// ---------- Logs (gebündelt je Kanal, damit Discord nicht bremst) ----------

const who = (id, name) => (id ? `[${name ?? id}](${profileUrl(id)})` : name ?? 'Unbekannt');
const t = (at) => `<t:${at}:T>`;

function logLine(event, { includeModcall = false } = {}) {
  const actor = who(event.userId, event.name);
  switch (event.type) {
    case 'join':
      return `➡️ ${t(event.at)} ${actor} ist beigetreten`;
    case 'leave':
      return `⬅️ ${t(event.at)} ${actor} hat verlassen${event.duration ? ` (${Math.round(event.duration / 60)} Min.)` : ''}`;
    case 'kill':
      return event.killer
        ? `💀 ${t(event.at)} ${who(event.killer.id, event.killer.name)} → ${who(event.victim.id, event.victim.name)}${event.weapon ? ` (${event.weapon})` : ''}`
        : `💀 ${t(event.at)} ${who(event.victim.id, event.victim.name)} ist gestorben`;
    case 'command':
      return `⌨️ ${t(event.at)} ${actor}: \`${truncate(event.text.replace(/`/g, "'"), 180)}\` (${event.source})`;
    case 'modcall':
      // im Log-Kanal eigene Nachricht mit „Übernehmen“-Button (modcalls.js)
      return includeModcall ? `🆘 ${t(event.at)} Mod-Call von ${actor}: ${truncate(event.text || '—', 180)}` : null;
    case 'call':
      return `🚨 ${t(event.at)} Notruf #${event.callNumber} (${event.team}) von ${actor}: ${truncate(event.text || '—', 160)}${event.location ? ` · ${event.location}` : ''}`;
    case 'vehicle': {
      const v = event.vehicle;
      return `🚗 ${t(event.at)} ${actor} ${event.action === 'spawn' ? 'hat gespawnt' : 'hat entfernt'}: ${v?.model ?? '?'}${v?.plate ? ` [${v.plate}]` : ''}${v?.color ? `, ${v.color}` : ''}`;
    }
    case 'team':
      return `🔄 ${t(event.at)} ${actor}: ${event.from ?? '—'} → ${event.to ?? '—'}`;
    default:
      return null;
  }
}

async function flushLogs(client, buckets) {
  for (const [key, lines] of buckets) {
    const [guildId, channelId] = key.split(':');
    const guild = client.guilds.cache.get(guildId);
    const channel = guild && (await getChannel(guild, channelId));
    if (!channel?.isTextBased()) continue;
    const brand = forGuild(guildId).game.brand;
    for (let i = 0; i < lines.length; i += 20) {
      const chunk = lines.slice(i, i + 20);
      const text = truncate(chunk.join('\n'), 4000);
      await channel
        .send({ embeds: [new EmbedBuilder().setColor(0x2b2d31).setDescription(text).setFooter({ text: `${brand} · Spiel-Log` })], allowedMentions: { parse: [] } })
        .catch((err) => console.error('[spiel-log]', err.message));
    }
  }
}

// ---------- Verarbeitung ----------

async function handle(client, event, buckets) {
  if (!event.stale && event.type !== 'ack') {
    const line = logLine(event);
    if (line) {
      for (const guild of guildsFor(client, event.ownerId)) {
        const channelId = forGuild(guild.id).game.logs[logTypeOf(event.type)];
        if (!channelId) continue;
        const key = `${guild.id}:${channelId}`;
        buckets.set(key, [...(buckets.get(key) ?? []), line]);
      }
    }
  }
  for (const fn of handlers.get(event.type) ?? []) await fn(event, { client });
}

// Ereignisse vom Spiel annehmen (Liste aus einer Anfrage). Antwort für das Spiel: angenommen/doppelt/abgelehnt.
function ingest(list) {
  const result = { accepted: 0, duplicates: 0, rejected: 0 };
  if (!Array.isArray(list)) return { ...result, rejected: 1 };
  for (const raw of list.slice(0, MAX_BATCH)) {
    const { event, error } = parseEvent(raw);
    if (error) {
      result.rejected++;
      state.rejected++;
      console.warn(`[spiel-ereignis] verworfen: ${error}`);
      continue;
    }
    if (seen.has(event.id) || queued.has(event.id)) {
      result.duplicates++;
      state.duplicates++;
      continue;
    }
    queued.add(event.id);
    queue.push({ event, attempts: 0 });
    result.accepted++;
  }
  if (result.accepted) {
    state.lastEventAt = Date.now();
    setImmediate(work);
  }
  return result;
}

async function work() {
  const client = state.client;
  if (state.working || !client) return;
  state.working = true;
  try {
    while (queue.length) {
      const batch = queue.splice(0, 50);
      const buckets = new Map();
      for (const item of batch) {
        const { event } = item;
        try {
          await handle(client, event, buckets);
          queued.delete(event.id);
          markSeen(event.id);
          remember(event);
          state.processed++;
        } catch (err) {
          item.attempts++;
          state.lastError = `${event.type}: ${err.message}`;
          console.error(`[spiel-ereignis] ${event.type} ${event.id} Versuch ${item.attempts}/${MAX_ATTEMPTS}:`, err.message);
          if (item.attempts >= MAX_ATTEMPTS) {
            state.failed++;
            queued.delete(event.id);
            markSeen(event.id); // aufgeben, aber nie doppelt verarbeiten
          } else {
            setTimeout(() => {
              queue.push(item);
              setImmediate(work);
            }, 2000 * item.attempts);
          }
        }
      }
      await flushLogs(client, buckets);
      db.save();
    }
  } finally {
    state.working = false;
  }
}

function start(client) {
  state.client = client;
  setImmediate(work);
}

const status = () => ({
  lastEventAt: state.lastEventAt,
  lastError: state.lastError,
  queued: queue.length,
  processed: state.processed,
  rejected: state.rejected,
  duplicates: state.duplicates,
  failed: state.failed,
});

// Ereignis-Historie eines Bereichs, neueste zuerst
function historyFor(scope, { types = null, userId = null, query = null, limit = 20 } = {}) {
  const q = query?.toLowerCase();
  const result = [];
  const list = history();
  for (let i = list.length - 1; i >= 0 && result.length < limit; i--) {
    const e = list[i];
    if (!inScope(scope, e.ownerId)) continue;
    if (types && !types.includes(e.type)) continue;
    if (userId && e.userId !== userId && e.victim?.id !== userId && e.killer?.id !== userId) continue;
    if (q && !`${e.name ?? ''} ${e.text ?? ''} ${e.vehicle?.plate ?? ''}`.toLowerCase().includes(q)) continue;
    result.push(e);
  }
  return result;
}

module.exports = { start, ingest, work, on, status, guildsFor, responsibleGuilds, historyFor, logLine, handle, flushLogs };
