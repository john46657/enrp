import { AppError, FACTION_KEYS, type Actor, type FactionKey } from '@emden-network/shared';
import { withTransaction, type Pool, type Queryable } from '@emden-network/database';
import { authorize } from './authz.js';
import { writeAudit } from './audit.js';
import { getActiveLinkByDiscord } from './users.js';

export interface Faction {
  id: string;
  key: FactionKey;
  name: string;
  discordRoleId: string | null;
}
export interface Rank {
  id: string;
  key: string;
  name: string;
  level: number;
}
export interface Membership {
  factionId: string;
  factionKey: FactionKey;
  factionName: string;
  rank: Rank;
  joinedAt: Date;
}

export function isFactionKey(v: string): v is FactionKey {
  return (FACTION_KEYS as readonly string[]).includes(v);
}

export async function getFaction(db: Queryable, key: string): Promise<Faction> {
  const { rows } = await db.query<Faction>('SELECT id, key, name, discord_role_id AS "discordRoleId" FROM factions WHERE key = $1', [key]);
  if (!rows[0]) throw new AppError('NOT_FOUND', 404, `Fraktion ${key}`);
  return rows[0];
}

export async function listRanks(db: Queryable, factionKey: string): Promise<Rank[]> {
  const { rows } = await db.query<Rank>(
    'SELECT r.id, r.key, r.name, r.level FROM faction_ranks r JOIN factions f ON f.id = r.faction_id WHERE f.key = $1 ORDER BY r.level',
    [factionKey],
  );
  return rows;
}

export async function getMembership(db: Queryable, discordId: string): Promise<Membership | null> {
  const { rows } = await db.query<{ faction_id: string; faction_key: FactionKey; faction_name: string; rank_id: string; rank_key: string; rank_name: string; rank_level: number; joined_at: Date }>(
    `SELECT m.faction_id, f.key AS faction_key, f.name AS faction_name, r.id AS rank_id, r.key AS rank_key, r.name AS rank_name, r.level AS rank_level, m.joined_at
     FROM faction_members m JOIN users u ON u.id = m.user_id JOIN factions f ON f.id = m.faction_id JOIN faction_ranks r ON r.id = m.rank_id
     WHERE u.discord_id = $1 AND m.left_at IS NULL`,
    [discordId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    factionId: r.faction_id,
    factionKey: r.faction_key,
    factionName: r.faction_name,
    rank: { id: r.rank_id, key: r.rank_key, name: r.rank_name, level: r.rank_level },
    joinedAt: r.joined_at,
  };
}

export interface RosterEntry {
  discordId: string;
  robloxUsername: string | null;
  rankName: string;
  rankLevel: number;
  onDuty: boolean;
  joinedAt: Date;
}

export async function getRoster(db: Queryable, factionKey: string): Promise<RosterEntry[]> {
  const { rows } = await db.query<RosterEntry>(
    `SELECT u.discord_id AS "discordId", l.roblox_username AS "robloxUsername", r.name AS "rankName", r.level AS "rankLevel",
            EXISTS (SELECT 1 FROM duty_sessions d WHERE d.user_id = u.id AND d.ended_at IS NULL) AS "onDuty", m.joined_at AS "joinedAt"
     FROM faction_members m
     JOIN factions f ON f.id = m.faction_id
     JOIN faction_ranks r ON r.id = m.rank_id
     JOIN users u ON u.id = m.user_id
     LEFT JOIN discord_links l ON l.user_id = u.id AND l.revoked_at IS NULL
     WHERE f.key = $1 AND m.left_at IS NULL
     ORDER BY r.level DESC, m.joined_at`,
    [factionKey],
  );
  return rows;
}

export type RankChangeMode = 'promote' | 'demote' | 'set';

export class FactionService {
  constructor(private readonly pool: Pool) {}

  /** Nimmt ein verifiziertes Mitglied mit dem niedrigsten Rang in die Fraktion auf. */
  async invite(actor: Actor, guildId: string, factionKey: string, targetDiscordId: string): Promise<{ rank: Rank }> {
    if (!isFactionKey(factionKey)) throw new AppError('NOT_FOUND', 404);
    return withTransaction(this.pool, async (tx) => {
      await authorize(this.pool, actor, 'faction.manage_members', { faction: factionKey, guildId });
      const link = await getActiveLinkByDiscord(tx, targetDiscordId);
      if (!link) throw new AppError('NOT_LINKED', 409, 'Ziel ist nicht verifiziert');
      const existing = await getMembership(tx, targetDiscordId);
      if (existing) throw new AppError('CONFLICT', 409, `bereits Mitglied: ${existing.factionKey}`);
      const faction = await getFaction(tx, factionKey);
      const ranks = await listRanks(tx, factionKey);
      const lowest = ranks[0];
      if (!lowest) throw new AppError('INTERNAL', 500, 'Fraktion ohne Ränge');
      await tx.query('INSERT INTO faction_members (faction_id, user_id, rank_id) VALUES ($1, $2, $3)', [faction.id, link.userId, lowest.id]);
      await writeAudit(tx, {
        actorType: 'discord_user', actorId: actor.discordId, action: 'faction.member_added', targetType: 'discord_user', targetId: targetDiscordId, guildId,
        metadata: { faction: factionKey, rank: lowest.key },
      });
      return { rank: lowest };
    });
  }

  async remove(actor: Actor, guildId: string, targetDiscordId: string, reason: string): Promise<{ factionKey: FactionKey }> {
    return withTransaction(this.pool, async (tx) => {
      const m = await getMembership(tx, targetDiscordId);
      if (!m) throw new AppError('NOT_FOUND', 404, 'keine Mitgliedschaft');
      await authorize(this.pool, actor, 'faction.manage_members', { faction: m.factionKey, guildId });
      await tx.query(
        `UPDATE faction_members SET left_at = now(), left_reason = $2 WHERE user_id = (SELECT id FROM users WHERE discord_id = $1) AND left_at IS NULL`,
        [targetDiscordId, reason],
      );
      // Laufenden Dienst beenden
      await tx.query(`UPDATE duty_sessions SET ended_at = now() WHERE user_id = (SELECT id FROM users WHERE discord_id = $1) AND ended_at IS NULL`, [targetDiscordId]);
      await writeAudit(tx, {
        actorType: 'discord_user', actorId: actor.discordId, action: 'faction.member_removed', targetType: 'discord_user', targetId: targetDiscordId, guildId,
        reason, metadata: { faction: m.factionKey },
      });
      return { factionKey: m.factionKey };
    });
  }

  async changeRank(actor: Actor, guildId: string, targetDiscordId: string, rankKey: string, mode: RankChangeMode): Promise<{ from: Rank; to: Rank; factionKey: FactionKey }> {
    return withTransaction(this.pool, async (tx) => {
      const m = await getMembership(tx, targetDiscordId);
      if (!m) throw new AppError('NOT_FOUND', 404, 'keine Mitgliedschaft');
      await authorize(this.pool, actor, 'faction.manage_members', { faction: m.factionKey, guildId });
      const target = (await listRanks(tx, m.factionKey)).find((r) => r.key === rankKey);
      if (!target) throw new AppError('VALIDATION', 400, `Rang ${rankKey} existiert nicht in ${m.factionKey}`);
      if (target.id === m.rank.id) throw new AppError('CONFLICT', 409, 'gleicher Rang');
      if (mode === 'promote' && target.level <= m.rank.level) throw new AppError('VALIDATION', 400, 'Beförderung muss ranghöher sein');
      if (mode === 'demote' && target.level >= m.rank.level) throw new AppError('VALIDATION', 400, 'Degradierung muss rangniedriger sein');
      await tx.query(
        `UPDATE faction_members SET rank_id = $2 WHERE user_id = (SELECT id FROM users WHERE discord_id = $1) AND left_at IS NULL`,
        [targetDiscordId, target.id],
      );
      await writeAudit(tx, {
        actorType: 'discord_user', actorId: actor.discordId, action: `faction.rank_${mode}`, targetType: 'discord_user', targetId: targetDiscordId, guildId,
        metadata: { faction: m.factionKey, from: m.rank.key, to: target.key },
      });
      return { from: m.rank, to: target, factionKey: m.factionKey };
    });
  }

  /** Fraktionsbezogene Audit-Einträge zu einem Mitglied. */
  async memberAudit(actor: Actor, guildId: string, targetDiscordId: string, limit = 15) {
    const m = await getMembership(this.pool, targetDiscordId);
    const { rows: lastFaction } = await this.pool.query<{ faction: FactionKey }>(
      `SELECT metadata->>'faction' AS faction FROM audit_logs WHERE target_id = $1 AND action LIKE 'faction.%' ORDER BY occurred_at DESC LIMIT 1`,
      [targetDiscordId],
    );
    const faction = m?.factionKey ?? lastFaction[0]?.faction;
    if (!faction) return [];
    await authorize(this.pool, actor, 'faction.audit', { faction, guildId });
    const { rows } = await this.pool.query<{ occurred_at: Date; actor_id: string | null; action: string; reason: string | null; metadata: Record<string, unknown> }>(
      `SELECT occurred_at, actor_id, action, reason, metadata FROM audit_logs
       WHERE target_id = $1 AND (action LIKE 'faction.%' OR action LIKE 'duty.%') AND (metadata->>'faction' = $2 OR metadata->>'faction' IS NULL)
       ORDER BY occurred_at DESC LIMIT $3`,
      [targetDiscordId, faction, limit],
    );
    return rows;
  }
}
