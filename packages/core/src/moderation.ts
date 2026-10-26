import { AppError, type Actor } from '@emden-network/shared';
import { withTransaction, type Pool } from '@emden-network/database';
import { authorize } from './authz.js';
import { writeAudit } from './audit.js';
import { ensureUser } from './users.js';

export interface ModerationCase {
  id: string;
  action: 'warn' | 'timeout' | 'game_kick' | 'game_ban';
  targetDiscordId: string | null;
  targetRobloxId: string | null;
  moderatorDiscordId: string | null;
  reason: string;
  status: string;
  expiresAt: Date | null;
  createdAt: Date;
}

export class ModerationService {
  constructor(private readonly pool: Pool) {}

  /** Legt einen Discord-Moderationsfall (Verwarnung/Timeout) an. Die Discord-Aktion selbst führt der Bot aus. */
  async recordDiscordCase(actor: Actor, guildId: string, action: 'warn' | 'timeout', targetDiscordId: string, reason: string, durationSeconds?: number): Promise<string> {
    if (targetDiscordId === actor.discordId) throw new AppError('FORBIDDEN', 403, 'Selbstmoderation');
    await authorize(this.pool, actor, action === 'warn' ? 'moderation.warn' : 'moderation.timeout', { guildId });
    return withTransaction(this.pool, async (tx) => {
      const targetId = await ensureUser(tx, targetDiscordId);
      const modId = await ensureUser(tx, actor.discordId);
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO moderation_cases (guild_id, action, target_user_id, target_discord_id, moderator_id, reason, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $7::int IS NULL THEN NULL ELSE now() + make_interval(secs => $7::int) END) RETURNING id`,
        [guildId, action, targetId, targetDiscordId, modId, reason, durationSeconds ?? null],
      );
      const id = rows[0]!.id;
      await writeAudit(tx, { actorType: 'discord_user', actorId: actor.discordId, action: `moderation.${action}`, targetType: 'discord_user', targetId: targetDiscordId, guildId, reason, metadata: { caseId: id, durationSeconds: durationSeconds ?? null } });
      return id;
    });
  }

  async getCase(actor: Actor, guildId: string, id: number): Promise<ModerationCase> {
    await authorize(this.pool, actor, 'moderation.case_view', { guildId });
    const { rows } = await this.pool.query<ModerationCase>(
      `SELECT c.id, c.action, coalesce(c.target_discord_id, t.discord_id) AS "targetDiscordId", c.target_roblox_id AS "targetRobloxId",
              m.discord_id AS "moderatorDiscordId", c.reason, c.status, c.expires_at AS "expiresAt", c.created_at AS "createdAt"
       FROM moderation_cases c LEFT JOIN users t ON t.id = c.target_user_id LEFT JOIN users m ON m.id = c.moderator_id
       WHERE c.id = $1 AND c.guild_id = $2`,
      [id, guildId],
    );
    if (!rows[0]) throw new AppError('NOT_FOUND', 404);
    return rows[0];
  }
}
