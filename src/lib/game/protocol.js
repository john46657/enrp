// Datenformat zwischen Spiel-Skript (roblox/ENRPBridge.server.lua) und Bot – „Bridge-Protokoll v1“.
//
// Spiel → Bot
//   Live-Zustand: jeder Spielserver schreibt alle LIVE_INTERVAL Sekunden einen Snapshot in die MemoryStore-Sorted-Map
//                 ENRPLive (Eintrag "srv-<JobId>", läuft nach 60 s ab).
//   Ereignisse:   Beitritt, Kill, Notruf, Mod-Call usw. landen als Einträge in der MemoryStore-Queue ENRPEvents.
// Bot → Spiel
//   Befehle über MessagingService (Thema ENRPBot), siehe openCloud.publish(). Das Spiel bestätigt mit einem "ack"-Ereignis.
//
// Alles aus dem Spiel wird hier geprüft und auf erwartete Typen/Längen gebracht, bevor der Bot es benutzt.

const { escapeMarkdown } = require('discord.js');

const VERSION = 1;

const EVENT_TYPES = {
  join: 'Beitritt',
  leave: 'Verlassen',
  kill: 'Kill',
  command: 'Befehl',
  modcall: 'Mod-Call',
  call: 'Notruf',
  vehicle: 'Fahrzeug',
  team: 'Teamwechsel',
  ack: 'Bestätigung',
};

// Log-Arten, die je Discord einen eigenen Kanal bekommen können (/spiel-admin logkanal)
const LOG_TYPES = {
  join: 'Beitritte & Verlassen',
  kill: 'Kills',
  command: 'Befehle im Spiel',
  modcall: 'Mod-Calls',
  call: 'Notrufe',
  vehicle: 'Fahrzeuge',
  team: 'Teamwechsel',
  actions: 'Discord-Aktionen im Spiel',
  bolo: 'BOLO-Treffer',
};
// leave-Ereignisse landen im join-Kanal
const logTypeOf = (eventType) => (eventType === 'leave' ? 'join' : eventType);

const MAX_FUTURE_SECONDS = 300; // Zeitstempel aus der Zukunft (Uhrzeit-Abweichung) werden abgelehnt
const STALE_SECONDS = 6 * 3600; // Ältere Ereignisse werden gespeichert, lösen aber keine Benachrichtigung aus

const str = (value, max) => (typeof value === 'string' ? value.slice(0, max) : typeof value === 'number' ? String(value).slice(0, max) : '');
const id = (value) => {
  const text = String(value ?? '');
  return /^\d{1,20}$/.test(text) ? text : '';
};
const int = (value, min, max, fallback = 0) => {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const nowSeconds = () => Math.floor(Date.now() / 1000);
// Freitext von Spielern: keine Discord-Formatierung (z. B. getarnte Links) und keine Erwähnungen
const plain = (value, max) => escapeMarkdown(str(value, max)).replace(/@/g, '@\u200b').replace(/https?:\/\//gi, (m) => m.replace('//', '/\u200b/'));

function parsePlayer(p) {
  if (!p || typeof p !== 'object' || !id(p.id)) return null;
  return {
    id: id(p.id),
    name: str(p.n, 20) || id(p.id),
    display: str(p.d, 40) || str(p.n, 20),
    team: str(p.t, 40) || null,
    staff: str(p.s, 30) || null,
    wanted: int(p.w, 0, 5),
    jailedUntil: int(p.j, -1, 4_102_444_800), // 0 = frei, -1 = bis zur Freilassung, sonst Unix-Zeit
    callsign: str(p.c, 20) || null,
    joinedAt: int(p.since, 0, 4_102_444_800) || null,
  };
}

const normalizePlate = (plate) => String(plate ?? '').toUpperCase().replace(/[^A-Z0-9ÄÖÜ]/g, '');

function parseVehicle(v) {
  if (!v || typeof v !== 'object') return null;
  const plate = str(v.p, 16);
  const model = str(v.m, 60);
  if (!plate && !model) return null;
  return {
    model: model || 'Unbekannt',
    ownerId: id(v.o) || null,
    ownerName: str(v.on, 20) || null,
    plate: plate || null,
    plateKey: normalizePlate(plate),
    color: str(v.c, 30) || null,
    hex: /^#[0-9a-f]{6}$/i.test(str(v.h, 7)) ? str(v.h, 7) : null,
  };
}

// Snapshot eines Spielservers → bereinigtes Objekt oder null
function parseSnapshot(raw) {
  if (!raw || typeof raw !== 'object' || raw.v !== VERSION || typeof raw.job !== 'string' || !raw.job) return null;
  return {
    job: raw.job.slice(0, 64),
    ownerId: id(raw.owner) && raw.owner !== 0 && raw.owner !== '0' ? id(raw.owner) : null,
    private: Boolean(raw.ps),
    maxPlayers: int(raw.max, 0, 700),
    startedAt: int(raw.started, 0, 4_102_444_800) || null,
    at: int(raw.at, 0, 4_102_444_800),
    version: int(raw.ver, 0, 1e9),
    teams: (Array.isArray(raw.teams) ? raw.teams : []).map((t) => str(t, 40)).filter(Boolean).slice(0, 50),
    players: (Array.isArray(raw.players) ? raw.players : []).map(parsePlayer).filter(Boolean).slice(0, 200),
    vehicles: (Array.isArray(raw.vehicles) ? raw.vehicles : []).map(parseVehicle).filter(Boolean).slice(0, 300),
  };
}

// Ereignis aus der Queue → { event } oder { error }
function parseEvent(raw, now = nowSeconds()) {
  if (!raw || typeof raw !== 'object') return { error: 'kein Objekt' };
  if (raw.v !== VERSION) return { error: `falsche Version ${raw.v}` };
  if (typeof raw.id !== 'string' || !/^[\w-]{8,64}$/.test(raw.id)) return { error: 'ungültige id' };
  if (!(raw.type in EVENT_TYPES)) return { error: `unbekannter Typ ${String(raw.type).slice(0, 20)}` };
  const at = int(raw.at, 0, 4_102_444_800);
  if (!at) return { error: 'kein Zeitstempel' };
  if (at > now + MAX_FUTURE_SECONDS) return { error: 'Zeitstempel liegt in der Zukunft' };

  const event = {
    id: raw.id,
    type: raw.type,
    at,
    stale: at < now - STALE_SECONDS,
    job: str(raw.job, 64),
    ownerId: id(raw.owner) && String(raw.owner) !== '0' ? id(raw.owner) : null,
    userId: id(raw.u) || null,
    name: str(raw.n, 20) || null,
  };
  switch (raw.type) {
    case 'join':
      event.staff = str(raw.s, 30) || null;
      break;
    case 'leave':
      event.duration = int(raw.dur, 0, 7 * 86_400);
      event.staff = str(raw.s, 30) || null;
      break;
    case 'kill':
      event.victim = { id: id(raw.vu) || null, name: str(raw.vn, 20) || null };
      event.killer = id(raw.ku) ? { id: id(raw.ku), name: str(raw.kn, 20) || null } : null;
      event.weapon = plain(raw.w, 40) || null;
      break;
    case 'command':
      event.text = plain(raw.text, 300);
      event.source = str(raw.src, 20) || 'spiel';
      break;
    case 'modcall':
      event.text = plain(raw.text, 300);
      break;
    case 'call':
      event.callNumber = int(raw.num, 0, 1e9);
      event.team = str(raw.team, 40) || 'Polizei';
      event.text = plain(raw.text, 500);
      event.location = plain(raw.loc, 100) || null;
      event.position = Number.isFinite(Number(raw.x)) && Number.isFinite(Number(raw.z)) ? { x: Math.round(Number(raw.x)), z: Math.round(Number(raw.z)) } : null;
      break;
    case 'vehicle':
      event.action = raw.act === 'despawn' ? 'despawn' : 'spawn';
      event.vehicle = parseVehicle(raw);
      break;
    case 'team':
      event.from = str(raw.from, 40) || null;
      event.to = str(raw.to, 40) || null;
      break;
    case 'ack':
      event.commandId = str(raw.cmd, 64);
      event.ok = Boolean(raw.ok);
      event.message = str(raw.msg, 200);
      break;
    default:
      break;
  }
  return { event };
}

// Gehört ein Spielserver (Besitzer-ID, null = öffentlich) zum Bereich eines Discords?
function inScope(scope, ownerId) {
  if (scope.type === 'main') return true;
  if (scope.type === 'private') return String(ownerId ?? '') === String(scope.ownerId);
  return false;
}

module.exports = {
  VERSION,
  EVENT_TYPES,
  LOG_TYPES,
  logTypeOf,
  MAX_FUTURE_SECONDS,
  STALE_SECONDS,
  parseSnapshot,
  parseEvent,
  parsePlayer,
  parseVehicle,
  normalizePlate,
  inScope,
  nowSeconds,
};
