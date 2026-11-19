// Anmeldungen im Dashboard: Verlauf (wer hat sich wann an- und abgemeldet) und aktive Sitzungen für Bot-Admins.
// Roblox-Konto: zuerst die im Discord-Profil verknüpfte Roblox-Verbindung (OAuth-Scope „connections“),
// sonst das zuletzt in einer Bewerbung bestätigte Roblox-Konto.
const crypto = require('node:crypto');
const { data, bucket, save } = require('../lib/db');

const MAX_EVENTS = 1000; // ältere Einträge fallen heraus
const ONLINE_MS = 5 * 60_000; // „online“, wenn in den letzten 5 Minuten aktiv

const store = () => bucket('dashboardLogins', 'all');
const events = () => (store().events ??= []);

// Sitzungs-IDs sind geheim (sie stecken im Cookie). Nach außen nur ein Kürzel davon.
const publicId = (sessionId) => crypto.createHash('sha256').update(sessionId).digest('hex').slice(0, 16);

// Roblox-Verbindung aus /users/@me/connections.
function robloxFromConnections(connections) {
  const c = (Array.isArray(connections) ? connections : []).find((x) => x?.type === 'roblox' && x.id);
  return c ? { id: String(c.id), name: c.name, verified: Boolean(c.verified), source: 'discord' } : null;
}

// Zuletzt in einer Bewerbung bestätigtes Roblox-Konto (über alle Server).
function robloxFromApplications(userId) {
  let latest = null;
  for (const records of Object.values(data.apps ?? {})) {
    for (const r of Object.values(records ?? {})) {
      if (r?.userId === userId && r.roblox?.id && (!latest || r.createdAt > latest.createdAt)) latest = r;
    }
  }
  return latest ? { id: String(latest.roblox.id), name: latest.roblox.name, verified: true, source: 'bewerbung' } : null;
}

const findRoblox = (userId, connections) => robloxFromConnections(connections) ?? robloxFromApplications(userId);

// type: 'login' | 'logout' | 'ended' (von einem Bot-Admin beendet)
function record(type, user, extra = {}) {
  const list = events();
  list.unshift({
    type,
    at: Date.now(),
    user: { id: user.id, username: user.username, globalName: user.globalName ?? null, avatar: user.avatar ?? null },
    roblox: user.roblox ?? null,
    ...extra,
  });
  if (list.length > MAX_EVENTS) list.length = MAX_EVENTS;
  save();
}

function history({ limit = 200, userId } = {}) {
  return events()
    .filter((e) => !userId || e.user.id === userId)
    .slice(0, Math.min(Math.max(limit, 1), MAX_EVENTS));
}

// Aktive (nicht abgelaufene) Sitzungen, neueste Aktivität zuerst.
function activeSessions(sessions, currentSessionId) {
  const now = Date.now();
  return Object.entries(sessions)
    .filter(([, s]) => s.expiresAt > now)
    .map(([id, s]) => ({
      id: publicId(id),
      user: s.user,
      roblox: s.user.roblox ?? null,
      loginAt: s.createdAt ?? null,
      lastSeen: s.lastSeen ?? s.createdAt ?? null,
      online: Boolean(s.lastSeen && now - s.lastSeen < ONLINE_MS),
      expiresAt: s.expiresAt,
      guilds: s.guilds?.length ?? 0,
      current: id === currentSessionId,
    }))
    .sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0));
}

// Beendet die Sitzung mit diesem Kürzel. Gibt die Sitzung zurück oder null.
function endSession(sessions, shortId) {
  const entry = Object.entries(sessions).find(([id]) => publicId(id) === shortId);
  if (!entry) return null;
  delete sessions[entry[0]];
  save();
  return entry[1];
}

module.exports = { record, history, activeSessions, endSession, findRoblox, robloxFromConnections, robloxFromApplications, publicId, ONLINE_MS };
