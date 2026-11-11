// Brücke zum Dashboard der Plattform: Der neue Bot holt Anfragen bei der API ab (apps/bot/src/legacy-bridge.ts)
// und führt sie hier mit den Altmodulen aus – Daten lesen, Aktionen (Bewerbung entscheiden, Panels posten …) und
// Einstellungen ändern. Rechte prüft die API vorher; hier gelten zusätzlich dieselben Regeln wie in Discord.
const settings = require('./settings');
const { bucket, save } = require('./db');
const { isValidTimeZone } = require('./time');
const { levelInfo } = require('./leveling');
const tickets = require('./tickets');
const stats = require('./stats');
const appMessages = require('./applications/messages');
const appDashboard = require('./applications/dashboard');
const { postRolePanel } = require('../commands/community/rolepanel');

// Bereiche der Einstellungen, die das Dashboard ändern darf (nur Module, die der neue Bot lädt).
const EDITABLE = ['timezone', 'channels', 'roles', 'welcome', 'tickets', 'leveling', 'roblox', 'stats', 'applications'];
const MAX_VALUE_BYTES = 60_000;
const DAYS = ['mo', 'di', 'mi', 'do', 'fr', 'sa', 'so'];

const nameOf = (guild, id) => guild.members.cache.get(id)?.user.username ?? null;

async function textChannel(guild, channelId) {
  const channel = await guild.channels.fetch(String(channelId ?? '')).catch(() => null);
  if (!channel?.isTextBased() || channel.isVoiceBased?.()) throw new Error('Bitte einen Textkanal wählen.');
  return channel;
}

function userId(value) {
  const id = String(value ?? '').trim();
  if (!/^\d{15,22}$/.test(id)) throw new Error('Ungültige Discord-ID.');
  return id;
}

// ---------- Daten lesen ----------

const live = {
  // Einstellungen samt Kanälen und Rollen für die Auswahlfelder.
  guild(guild) {
    const config = settings.forGuild(guild.id);
    return {
      guild: { id: guild.id, name: guild.name, icon: guild.iconURL(), memberCount: guild.memberCount },
      config: Object.fromEntries(EDITABLE.filter((key) => key in config).map((key) => [key, config[key]])),
      changed: settings.overrideCount(guild.id),
      channels: guild.channels.cache
        .map((c) => ({ id: c.id, name: c.name, type: c.type, parentId: c.parentId, position: c.rawPosition ?? 0 }))
        .sort((a, b) => a.position - b.position),
      roles: guild.roles.cache
        .filter((r) => r.id !== guild.id)
        .map((r) => ({ id: r.id, name: r.name, color: r.hexColor, position: r.position, managed: r.managed, editable: r.editable }))
        .sort((a, b) => b.position - a.position),
      questionTypes: appDashboard.QUESTION_TYPES,
      statTypes: Object.fromEntries(Object.entries(stats.TYPES).map(([key, t]) => [key, { label: t.label, name: t.name }])),
      ticketPanels: Object.keys(bucket('ticketPanels', guild.id)).length,
    };
  },
  applications: (guild) => appDashboard.list(guild),
  'app-progress': (guild) => appDashboard.progress(guild),
  'app-bans': (guild) => appDashboard.bans(guild),
  'app-stats': (guild) => appDashboard.stats(guild),
  levels(guild) {
    const all = Object.entries(bucket('levels', guild.id)).sort(([, a], [, b]) => b.xp - a.xp);
    return {
      enabled: Boolean(settings.forGuild(guild.id).leveling.enabled),
      total: all.length,
      top: all.slice(0, 100).map(([id, { xp }], i) => ({ rank: i + 1, userId: id, userName: nameOf(guild, id), xp, ...levelInfo(xp) })),
    };
  },
  tickets: (guild) =>
    Object.entries(tickets.openTickets(guild)).map(([channelId, t]) => ({
      channelId,
      channel: guild.channels.cache.get(channelId)?.name ?? null,
      number: t.number,
      type: t.type,
      owner: t.owner,
      ownerName: nameOf(guild, t.owner),
      claimedBy: t.claimedBy ?? null,
      claimedByName: t.claimedBy ? nameOf(guild, t.claimedBy) : null,
      openedAt: t.openedAt,
    })),
};

// ---------- Aktionen ----------

const actions = {
  'app-decide': (guild, body, member) => appDashboard.decide(guild, body, member),
  'app-status': (guild, body, member) => appDashboard.changeStatus(guild, body, member),
  'app-note': (guild, body, member) => appDashboard.addNote(guild, body, member),
  'app-delete': (guild, body, member) => appDashboard.remove(guild, body, member),
  'app-ban-add': (guild, body, member) => appDashboard.addBan(guild, body, member),
  'app-ban-lift': (guild, body, member) => appDashboard.liftBan(guild, body, member),
  'app-panel-post': (guild, body) => appDashboard.postPanel(guild, body),
  'ticket-panel-post': async (guild, { channelId }) => {
    await tickets.postPanel(await textChannel(guild, channelId));
  },
  'ticket-panels-refresh': (guild) => tickets.refreshPanels(guild),
  'role-panel-post': async (guild, { channelId, title, description, roleIds }) => {
    const text = String(title ?? '').trim();
    if (!text || text.length > 256) throw new Error('Die Überschrift fehlt oder ist zu lang (höchstens 256 Zeichen).');
    const about = String(description ?? '').trim();
    if (about.length > 2000) throw new Error('Die Beschreibung ist zu lang (höchstens 2000 Zeichen).');
    const roles = (Array.isArray(roleIds) ? roleIds : []).map((id) => guild.roles.cache.get(String(id)));
    if (roles.some((r) => !r)) throw new Error('Eine der Rollen gibt es nicht mehr.');
    const message = await postRolePanel(await textChannel(guild, channelId), { title: text, description: about, roles });
    return { messageId: message.id };
  },
  'level-set': (guild, body) => {
    const id = userId(body.userId);
    const xp = Number(body.xp);
    if (!Number.isInteger(xp) || xp < 0 || xp > 100_000_000) throw new Error('XP: ganze Zahl von 0 bis 100.000.000.');
    bucket('levels', guild.id)[id] = { ...bucket('levels', guild.id)[id], xp };
    save();
    return { userId: id, xp, ...levelInfo(xp) };
  },
  'level-reset': (guild, body) => {
    const id = userId(body.userId);
    if (!bucket('levels', guild.id)[id]) throw new Error('Diese Person hat keine XP.');
    delete bucket('levels', guild.id)[id];
    save();
  },
};

// ---------- Einstellungen ----------

function validateChange(change) {
  if (!change || typeof change.path !== 'string') return 'Ungültige Änderung.';
  const parts = change.path.split('.');
  if (!EDITABLE.includes(parts[0])) return `„${parts[0]}“ kann im Dashboard nicht geändert werden.`;
  if (parts.some((p) => !p || ['__proto__', 'prototype', 'constructor'].includes(p))) return 'Ungültiger Pfad.';
  if (change.value !== undefined && change.value !== null && JSON.stringify(change.value).length > MAX_VALUE_BYTES) return 'Wert ist zu groß.';
  if ((parts.at(-1) === 'timezone' || parts.at(-1) === 'timeZone') && !isValidTimeZone(change.value)) return `Unbekannte Zeitzone „${change.value}“.`;
  return null;
}

const isTime = (value) => {
  const match = typeof value === 'string' && value.match(/^(\d{2}):(\d{2})$/);
  if (!match) return false;
  const [h, m] = [Number(match[1]), Number(match[2])];
  return h < 24 ? m < 60 : h === 24 && m === 0;
};

// Prüft die Vorschau der neuen Einstellungen auf Werte, mit denen die Altmodule nicht arbeiten können.
function checkConfig(config) {
  const t = config.tickets;
  if (!Array.isArray(t?.types) || !t.types.length) return 'Mindestens eine Ticket-Kategorie ist nötig.';
  if (!Number.isInteger(t.maxOpenPerUser) || t.maxOpenPerUser < 0 || t.maxOpenPerUser > 50) return 'Tickets pro Nutzer: 0 bis 50.';
  if (typeof t.channelName !== 'string' || !t.channelName.trim() || t.channelName.length > 90) return 'Der Kanalname für Tickets fehlt oder ist zu lang.';
  for (const type of t.types) {
    if (!type.id || !String(type.label ?? '').trim()) return 'Jede Ticket-Kategorie braucht einen Namen.';
    if (!Number.isInteger(type.capacity) || type.capacity < 0 || type.capacity > 1000) return `${type.label}: Kapazität 0 bis 1000.`;
    if (!Array.isArray(type.roles)) return `${type.label}: ungültige Team-Rollen.`;
  }
  const hours = t.openingHours;
  if (!Array.isArray(hours?.periods)) return 'Ungültige Öffnungszeiten.';
  for (const period of hours.periods) {
    if (!Array.isArray(period.days) || !period.days.length || period.days.some((d) => !DAYS.includes(d))) return `Öffnungszeiten: Tage müssen aus ${DAYS.join(', ')} sein.`;
    if (!isTime(period.from) || !isTime(period.to)) return 'Öffnungszeiten: Uhrzeiten als HH:MM (00:00 bis 24:00).';
  }
  if (hours.enabled && !hours.periods.length) return 'Öffnungszeiten sind an, aber es sind keine Zeiten eingetragen.';
  const l = config.leveling;
  if (!Number.isInteger(l.cooldownSeconds) || l.cooldownSeconds < 0 || l.cooldownSeconds > 3600) return 'Level-Cooldown: 0 bis 3600 Sekunden.';
  if (!Number.isInteger(l.xpMin) || !Number.isInteger(l.xpMax) || l.xpMin < 0 || l.xpMax < l.xpMin || l.xpMax > 1000) return 'XP pro Nachricht: 0 bis 1000, Minimum höchstens so groß wie das Maximum.';
  for (const [level, roleId] of Object.entries(l.roleRewards ?? {})) {
    if (!/^\d+$/.test(level) || Number(level) < 1 || Number(level) > 500) return 'Level-Belohnungen: Level 1 bis 500.';
    if (typeof roleId !== 'string' || !/^\d{15,22}$/.test(roleId)) return `Level-Belohnung ${level}: ungültige Rolle.`;
  }
  if (typeof config.welcome?.message !== 'string' || config.welcome.message.length > 1500) return 'Die Willkommensnachricht ist zu lang (höchstens 1500 Zeichen).';
  return appDashboard.checkConfig(config);
}

const touched = (paths, prefix) => paths.some((p) => p === prefix || p.startsWith(`${prefix}.`));

async function refreshAfterSave(guild, paths) {
  const run = (label, promise) => Promise.resolve(promise).catch((err) => console.error(`[dashboard] ${label}:`, err.message));
  if (touched(paths, 'tickets')) await run('Ticketpanel', tickets.refreshPanels(guild));
  if (touched(paths, 'stats')) await run('Statistik', stats.updateStats(guild));
  if (['channels', 'roles', 'applications'].some((prefix) => touched(paths, prefix))) await run('Bewerbungspanel', appMessages.refreshPanels(guild));
}

// Änderungen: [{ path: "tickets.panel.title", value: "…" }, …] – alle oder keine werden übernommen.
async function saveSettings(guild, changes) {
  if (!Array.isArray(changes) || !changes.length || changes.length > 100) throw new Error('Keine gültigen Änderungen.');
  for (const change of changes) {
    const error = validateChange(change);
    if (error) throw new Error(error);
  }
  const { invalid, config } = settings.preview(guild.id, changes);
  if (invalid) throw new Error(`Unbekannte Einstellung: ${invalid}`);
  const error = checkConfig(config);
  if (error) throw new Error(error);
  for (const { path, value } of changes) settings.set(guild.id, path, value ?? undefined);
  await refreshAfterSave(guild, changes.map((c) => c.path));
  return { changed: settings.overrideCount(guild.id) };
}

async function resetSettings(guild) {
  settings.reset(guild.id);
  await refreshAfterSave(guild, EDITABLE);
  return { changed: 0 };
}

/**
 * Führt eine Anfrage der Plattform aus. request: { kind, name, payload, actorDiscordId }.
 * Fehler mit verständlicher Meldung werden als Error geworfen und landen so im Dashboard.
 */
async function handle(guild, request) {
  const payload = request.payload ?? {};
  if (request.kind === 'live') {
    const fn = live[request.name];
    if (!fn) throw new Error('Diese Daten kennt der Bot nicht (Bot aktualisieren?).');
    return fn(guild);
  }
  if (request.kind === 'settings') return saveSettings(guild, payload.changes);
  if (request.kind === 'reset') return resetSettings(guild);
  if (request.kind === 'action') {
    const fn = actions[request.name];
    if (!fn) throw new Error('Diese Aktion kennt der Bot nicht (Bot aktualisieren?).');
    // Aktionen laufen im Namen der Person aus dem Dashboard (Log-Einträge, „entschieden von“).
    const member = request.actorDiscordId ? await guild.members.fetch(request.actorDiscordId).catch(() => null) : null;
    if (!member) throw new Error('Du bist nicht auf dem Discord-Server. Aktionen aus dem Dashboard brauchen ein Mitglied des Servers.');
    return (await fn(guild, payload, member)) ?? null;
  }
  throw new Error('Unbekannte Anfrage.');
}

module.exports = { handle, saveSettings, resetSettings, checkConfig, validateChange, EDITABLE, LIVE: Object.keys(live), ACTIONS: Object.keys(actions) };
