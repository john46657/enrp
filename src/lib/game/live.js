// Live-Daten aus dem Spiel: Jeder Spielserver schickt alle 15 Sekunden einen Snapshot an die Bridge
// (POST /bridge/v1/live). Die Daten liegen nur im Arbeitsspeicher – keine Kopien der Live-Daten in der Datenbank.
const links = require('../roblox/links');
const { parseSnapshot, inScope, nowSeconds, normalizePlate } = require('./protocol');

const STALE_AFTER = 60; // Sekunden ohne Snapshot → Server gilt als beendet

const snapshots = new Map(); // job → Snapshot
const hooks = [];
const state = { lastContactAt: null, received: 0, rejected: 0, timer: null };

const onUpdate = (fn) => hooks.push(fn);

// Snapshot vom Spiel annehmen. Gibt false zurück, wenn er ungültig ist.
function ingest(raw) {
  const snapshot = parseSnapshot(raw);
  if (!snapshot) {
    state.rejected++;
    return false;
  }
  snapshot.receivedAt = Date.now();
  snapshots.set(snapshot.job, snapshot);
  state.lastContactAt = Date.now();
  state.received++;
  for (const hook of hooks) Promise.resolve(hook(snapshot)).catch((err) => console.error('[live] Hook:', err.message));
  return true;
}

// Server, der sich beim Herunterfahren abmeldet
function remove(job) {
  return snapshots.delete(String(job));
}

function prune(now = Date.now()) {
  for (const [job, snapshot] of snapshots) if (now - snapshot.receivedAt > STALE_AFTER * 1000) snapshots.delete(job);
}

function start() {
  clearInterval(state.timer);
  state.timer = setInterval(prune, 10_000);
}

const status = () => ({
  lastContactAt: state.lastContactAt,
  received: state.received,
  rejected: state.rejected,
  servers: snapshots.size,
  connected: Boolean(state.lastContactAt && Date.now() - state.lastContactAt < STALE_AFTER * 1000),
});

// Für den Live-Status: „vor X Sekunden“ je Server
const ageSeconds = (snapshot) => Math.round((Date.now() - snapshot.receivedAt) / 1000);

// ---------- Abfragen (immer auf den Bereich eines Discords beschränkt) ----------

const serversFor = (scope) => [...snapshots.values()].filter((s) => inScope(scope, s.ownerId)).sort((a, b) => b.players.length - a.players.length);

function serverLabel(snapshot) {
  const shortJob = snapshot.job.replace(/[^a-z0-9]/gi, '').slice(0, 6) || snapshot.job.slice(0, 6);
  if (!snapshot.ownerId) return `🌐 Öffentlich · ${shortJob}`;
  const link = links.listPrivateServers().find((l) => l.ownerId === snapshot.ownerId);
  return `🔒 ${link ? link.name : `Privatserver ${snapshot.ownerId}`} · ${shortJob}`;
}

// Server per Kurz-ID (Anfang der JobId) finden
const findServer = (scope, query) => {
  const q = String(query ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!q) return null;
  return serversFor(scope).find((s) => s.job.toLowerCase().replace(/[^a-z0-9]/g, '').startsWith(q)) ?? null;
};

// Alle Spieler mit Server: [{ player, server }]
const playersFor = (scope) => serversFor(scope).flatMap((server) => server.players.map((player) => ({ player, server })));

// Spieler per ID, Name oder Anzeigename (genau, sonst Anfang, sonst enthalten)
function findPlayers(scope, query) {
  const q = String(query ?? '').trim().toLowerCase().replace(/^@/, '');
  if (!q) return [];
  const all = playersFor(scope);
  const exact = all.filter(({ player }) => player.id === q || player.name.toLowerCase() === q || player.display.toLowerCase() === q);
  if (exact.length) return exact;
  const prefix = all.filter(({ player }) => player.name.toLowerCase().startsWith(q) || player.display.toLowerCase().startsWith(q));
  if (prefix.length) return prefix;
  return all.filter(({ player }) => player.name.toLowerCase().includes(q) || player.display.toLowerCase().includes(q));
}

const vehiclesFor = (scope) => serversFor(scope).flatMap((server) => server.vehicles.map((vehicle) => ({ vehicle, server })));

function findVehicles(scope, { plate, ownerId, ownerName } = {}) {
  const key = plate ? normalizePlate(plate) : null;
  const name = ownerName?.toLowerCase();
  return vehiclesFor(scope).filter(
    ({ vehicle }) =>
      (!key || vehicle.plateKey.includes(key)) &&
      (!ownerId || vehicle.ownerId === ownerId) &&
      (!name || vehicle.ownerName?.toLowerCase() === name),
  );
}

const staffFor = (scope) => playersFor(scope).filter(({ player }) => player.staff);

function totals(scope) {
  const servers = serversFor(scope);
  return {
    servers: servers.length,
    players: servers.reduce((sum, s) => sum + s.players.length, 0),
    capacity: servers.reduce((sum, s) => sum + s.maxPlayers, 0),
    staff: servers.reduce((sum, s) => sum + s.players.filter((p) => p.staff).length, 0),
    vehicles: servers.reduce((sum, s) => sum + s.vehicles.length, 0),
    wanted: servers.reduce((sum, s) => sum + s.players.filter((p) => p.wanted > 0).length, 0),
    jailed: servers.reduce((sum, s) => sum + s.players.filter((p) => p.jailedUntil !== 0).length, 0),
  };
}

// Nur für Tests
const _clear = () => snapshots.clear();

module.exports = { start, ingest, remove, prune, status, ageSeconds, onUpdate, serversFor, serverLabel, findServer, playersFor, findPlayers, vehiclesFor, findVehicles, staffFor, totals, nowSeconds, _clear };
