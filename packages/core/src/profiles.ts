import type { Pool } from '@emden-network/database';
import { DutyService } from './duty.js';
import { getMembership, type Membership } from './factions.js';
import { getActiveLinkByDiscord, getActiveLinkByRoblox, type LinkedAccount } from './users.js';

export interface PlayerProfile {
  discordId: string;
  roblox: { id: string; username: string | null; displayName: string | null; linkedAt: Date } | null;
  faction: { key: string; name: string; rank: { key: string; name: string; level: number }; joinedAt: Date } | null;
  /** Dienstzeit (Discord + Spiel) */
  dutyTime: { totalSeconds: number; last30DaysSeconds: number };
  /** Spielzeit aus player.join/player.leave-Ereignissen; null ohne Roblox-Verknüpfung */
  playTime: { totalSeconds: number; last30DaysSeconds: number } | null;
  onDuty: boolean;
}

/** Freigegebene Profildaten. Enthält bewusst keine Tokens, keine E-Mail und keine Moderationsdaten. */
export async function getProfile(pool: Pool, by: { discordId: string } | { robloxUserId: string }): Promise<PlayerProfile | null> {
  let link: LinkedAccount | null;
  let discordId: string;
  if ('discordId' in by) {
    discordId = by.discordId;
    link = await getActiveLinkByDiscord(pool, discordId);
  } else {
    link = await getActiveLinkByRoblox(pool, by.robloxUserId);
    if (!link) return null;
    discordId = link.discordId;
  }
  const membership: Membership | null = await getMembership(pool, discordId);
  const duty = new DutyService(pool);
  const [total, last30, current, playTotal, play30] = await Promise.all([
    duty.totalSeconds({ discordId }, null),
    duty.totalSeconds({ discordId }, 30),
    duty.current(discordId),
    link ? playtimeSeconds(pool, link.robloxUserId, null) : Promise.resolve(0),
    link ? playtimeSeconds(pool, link.robloxUserId, 30) : Promise.resolve(0),
  ]);
  return {
    discordId,
    roblox: link ? { id: link.robloxUserId, username: link.robloxUsername, displayName: link.robloxDisplayName, linkedAt: link.linkedAt } : null,
    faction: membership
      ? { key: membership.factionKey, name: membership.factionName, rank: { key: membership.rank.key, name: membership.rank.name, level: membership.rank.level }, joinedAt: membership.joinedAt }
      : null,
    dutyTime: { totalSeconds: total, last30DaysSeconds: last30 },
    playTime: link ? { totalSeconds: playTotal, last30DaysSeconds: play30 } : null,
    onDuty: current !== null,
  };
}

/**
 * Spielzeit aus Beitritts-/Verlassen-Ereignissen: jedes player.join wird mit dem nächsten Ereignis desselben
 * Spielers auf demselben Server gepaart. Fehlt das Verlassen (Server abgestürzt), zählt die Zeit bis zum
 * letzten Heartbeat des Servers, maximal 24 Stunden.
 */
export async function playtimeSeconds(pool: Pool, robloxUserId: string, days: number | null): Promise<number> {
  const { rows } = await pool.query<{ s: string | null }>(
    `WITH ev AS (
       SELECT e.type, e.occurred_at, e.game_server_id,
              lead(e.occurred_at) OVER w AS next_at, lead(e.type) OVER w AS next_type
       FROM game_events e
       WHERE e.roblox_user_id = $1 AND e.type IN ('player.join', 'player.leave')
       WINDOW w AS (PARTITION BY e.game_server_id ORDER BY e.occurred_at, e.id)
     ), spans AS (
       SELECT ev.occurred_at AS started,
              least(coalesce(CASE WHEN ev.next_type = 'player.leave' THEN ev.next_at END,
                             CASE WHEN ev.next_at IS NULL THEN coalesce(s.shutdown_at, s.last_heartbeat_at) END,
                             ev.occurred_at),
                    ev.occurred_at + interval '24 hours') AS ended
       FROM ev JOIN game_servers s ON s.id = ev.game_server_id
       WHERE ev.type = 'player.join'
     )
     SELECT sum(extract(epoch FROM (ended - greatest(started, coalesce(now() - make_interval(days => $2), started))))) AS s
     FROM spans WHERE ended > started AND ($2::int IS NULL OR ended > now() - make_interval(days => $2))`,
    [robloxUserId, days],
  );
  return Math.max(0, Math.round(Number(rows[0]?.s ?? 0)));
}
