import { type DbExecutor, type gameServers } from '@enrp/database';
import { type Actor, hasPermission, requirePermission } from '../actor';
import { type LivePlayer, type LiveVehicle, serverOverview } from './game';

/**
 * Live-Lage aus dem letzten Heartbeat jedes laufenden Servers: Spieler mit Team, Fahndungsstufe, Gefängnis und
 * Rufname sowie gespawnte Fahrzeuge mit Kennzeichen. Der Zustand steht in game_servers.live und wird bei jedem
 * Heartbeat überschrieben – es entstehen keine Kopien oder Historien der Live-Daten.
 */

export type { LivePlayer, LiveVehicle };
export interface LiveState {
  at: string;
  teams: string[];
  players: LivePlayer[];
  vehicles: LiveVehicle[];
}

/** Kennzeichen vergleichbar machen: Großbuchstaben, ohne Leer- und Trennzeichen. */
export const normalizePlate = (plate: string | null | undefined) =>
  String(plate ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9ÄÖÜ]/g, '');

type ServerRow = typeof gameServers.$inferSelect;

export interface LiveServer {
  id: string;
  jobId: string;
  serverType: ServerRow['serverType'];
  privateServerOwnerId: number | null;
  playerCount: number;
  maxPlayers: number | null;
  lastHeartbeatAt: Date;
}

const serverInfo = (s: ServerRow): LiveServer => ({
  id: s.id,
  jobId: s.jobId,
  serverType: s.serverType,
  privateServerOwnerId: s.privateServerOwnerId,
  playerCount: s.playerCount,
  maxPlayers: s.maxPlayers,
  lastHeartbeatAt: s.lastHeartbeatAt,
});

const liveOf = (s: ServerRow): LiveState => {
  const live = (s.live ?? {}) as Partial<LiveState>;
  return {
    at: live.at ?? s.lastHeartbeatAt.toISOString(),
    teams: Array.isArray(live.teams) ? live.teams : [],
    players: Array.isArray(live.players) ? live.players : [],
    vehicles: Array.isArray(live.vehicles) ? live.vehicles : [],
  };
};

/** Laufende Server mit ihrem Live-Zustand (ohne Rechteprüfung – nur für interne Abläufe). */
export async function onlineServers(db: DbExecutor, now: Date) {
  const { servers } = await serverOverview(db, now);
  return servers.map((s) => ({ server: serverInfo(s), live: liveOf(s) }));
}

/** Ist ein Spieler gerade online? Liefert Server und Live-Daten oder null. */
export async function findOnlinePlayer(db: DbExecutor, now: Date, robloxUserId: number) {
  for (const { server, live } of await onlineServers(db, now)) {
    const player = live.players.find((p) => p.userId === robloxUserId);
    if (player) return { server, player };
  }
  return null;
}

export function canViewLive(actor: Actor) {
  if (!hasPermission(actor, 'roblox_servers:view') && !hasPermission(actor, 'dispatch:view'))
    requirePermission(actor, 'roblox_servers:view');
}

/** Alle Spieler auf laufenden Servern, optional gefiltert nach Name/Anzeigename/ID oder Team. */
export async function livePlayers(db: DbExecutor, actor: Actor, now: Date, filter: { q?: string; team?: string } = {}) {
  canViewLive(actor);
  const q = filter.q?.trim().toLowerCase();
  const team = filter.team?.trim().toLowerCase();
  const items = (await onlineServers(db, now)).flatMap(({ server, live }) =>
    live.players
      .filter(
        (p) =>
          (!q ||
            String(p.userId) === q ||
            p.username.toLowerCase().includes(q) ||
            (p.displayName ?? '').toLowerCase().includes(q)) &&
          (!team || (p.team ?? '').toLowerCase() === team),
      )
      .map((p) => ({ ...p, wanted: p.wanted ?? 0, jailed: p.jailed ?? false, server })),
  );
  return { items, total: items.length };
}

/** Gespawnte Fahrzeuge, optional nach Kennzeichen (teilweise) oder Besitzer gefiltert. */
export async function liveVehicles(
  db: DbExecutor,
  actor: Actor,
  now: Date,
  filter: { plate?: string; ownerId?: number } = {},
) {
  canViewLive(actor);
  const plate = filter.plate ? normalizePlate(filter.plate) : null;
  const servers = await onlineServers(db, now);
  const names = new Map<number, string>();
  for (const { live } of servers) for (const p of live.players) names.set(p.userId, p.username);
  const items = servers.flatMap(({ server, live }) =>
    live.vehicles
      .filter(
        (v) => (!plate || normalizePlate(v.plate).includes(plate)) && (!filter.ownerId || v.ownerId === filter.ownerId),
      )
      .map((v) => ({ ...v, ownerName: v.ownerId ? (names.get(v.ownerId) ?? null) : null, server })),
  );
  return { items, total: items.length };
}

/** Teams, die auf laufenden Servern existieren (für Auswahllisten). */
export async function liveTeams(db: DbExecutor, now: Date) {
  return [...new Set((await onlineServers(db, now)).flatMap(({ live }) => live.teams))].sort();
}
