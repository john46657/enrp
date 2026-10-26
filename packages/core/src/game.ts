import {
  AppError,
  BROADCAST_COMMANDS,
  commandPayloadSchemas,
  type Actor,
  type CommandType,
  type GameEvent,
  type Heartbeat,
  type Permission,
} from '@emden-network/shared';
import { withTransaction, type Pool, type PoolClient } from '@emden-network/database';
import { authorize } from './authz.js';
import { writeAudit } from './audit.js';
import { DutyService } from './duty.js';
import { ensureUser, getActiveLinkByRoblox } from './users.js';

/** Server gilt als aktiv, wenn der letzte Heartbeat höchstens so alt ist. */
export const SERVER_STALE_SECONDS = 90;
const EVENT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const EVENT_MAX_FUTURE_MS = 60 * 1000;
const JOB_LEASE_SECONDS = 60;

const JOB_PERMISSIONS: Record<CommandType, Permission> = {
  announce: 'server.announce',
  restart_announce: 'server.announce',
  kick: 'moderation.game_kick',
  ban: 'moderation.game_ban',
  unban: 'moderation.game_ban',
};

export interface GameSettings {
  maintenance: { enabled: boolean; message: string | null };
}

export type EventOutcome = { eventId: string; status: 'processed' | 'duplicate' | 'rejected'; reason?: string };

export interface PendingJob {
  id: string;
  type: CommandType;
  payload: unknown;
  expiresAt: Date;
}

export class GameService {
  private readonly duty: DutyService;

  constructor(private readonly pool: Pool) {
    this.duty = new DutyService(pool);
  }

  async getSettings(): Promise<GameSettings> {
    const { rows } = await this.pool.query<{ value: { enabled?: boolean; message?: string | null } }>(`SELECT value FROM game_settings WHERE key = 'maintenance'`);
    const v = rows[0]?.value ?? {};
    return { maintenance: { enabled: v.enabled === true, message: v.message ?? null } };
  }

  async setMaintenance(actor: Actor, guildId: string, enabled: boolean, message: string | null): Promise<void> {
    await withTransaction(this.pool, async (tx) => {
      await authorize(this.pool, actor, 'server.maintenance', { guildId });
      const userId = await ensureUser(tx, actor.discordId);
      await tx.query(
        `INSERT INTO game_settings (key, value, updated_by) VALUES ('maintenance', $1, $2)
         ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = now(), updated_by = $2`,
        [JSON.stringify({ enabled, message }), userId],
      );
      await writeAudit(tx, { actorType: 'discord_user', actorId: actor.discordId, action: 'game.maintenance_set', guildId, metadata: { enabled, message } });
    });
  }

  /** Registriert/aktualisiert einen Spielserver und dessen Spielerliste. Liefert die aktuellen Einstellungen. */
  async heartbeat(hb: Heartbeat): Promise<{ serverId: string; settings: GameSettings }> {
    const serverId = await withTransaction(this.pool, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO game_servers (job_id, place_id, place_version, player_count, max_players, last_heartbeat_at, shutdown_at)
         VALUES ($1, $2, $3, $4, $5, now(), CASE WHEN $6 THEN now() END)
         ON CONFLICT (job_id) DO UPDATE SET place_id = EXCLUDED.place_id, place_version = EXCLUDED.place_version,
           player_count = EXCLUDED.player_count, max_players = EXCLUDED.max_players, last_heartbeat_at = now(),
           shutdown_at = CASE WHEN $6 THEN now() ELSE game_servers.shutdown_at END
         RETURNING id`,
        [hb.jobId, hb.placeId, hb.placeVersion ?? null, hb.players.length, hb.maxPlayers ?? null, hb.shuttingDown === true],
      );
      const id = rows[0]!.id;
      await tx.query('DELETE FROM game_server_players WHERE game_server_id = $1 AND NOT (roblox_user_id = ANY($2::bigint[]))', [id, hb.players]);
      if (hb.players.length > 0) {
        await tx.query(
          `INSERT INTO game_server_players (game_server_id, roblox_user_id) SELECT $1, unnest($2::bigint[]) ON CONFLICT DO NOTHING`,
          [id, hb.players],
        );
      }
      if (hb.shuttingDown) await this.duty.endAllForServer(tx, id);
      return id;
    });
    return { serverId, settings: await this.getSettings() };
  }

  private async serverIdFor(jobId: string): Promise<string> {
    const { rows } = await this.pool.query<{ id: string }>('SELECT id FROM game_servers WHERE job_id = $1', [jobId]);
    if (!rows[0]) throw new AppError('CONFLICT', 409, 'Unbekannter Server – zuerst Heartbeat senden');
    return rows[0].id;
  }

  /** Nimmt Spielereignisse entgegen. Jede eventId wird genau einmal verarbeitet. */
  async ingestEvents(jobId: string, events: GameEvent[]): Promise<EventOutcome[]> {
    const serverId = await this.serverIdFor(jobId);
    const out: EventOutcome[] = [];
    for (const ev of events) out.push(await this.ingestOne(serverId, ev));
    return out;
  }

  private async ingestOne(serverId: string, ev: GameEvent): Promise<EventOutcome> {
    const occurredAt = new Date(ev.occurredAt);
    const now = Date.now();
    if (occurredAt.getTime() > now + EVENT_MAX_FUTURE_MS || occurredAt.getTime() < now - EVENT_MAX_AGE_MS) {
      return { eventId: ev.eventId, status: 'rejected', reason: 'TIMESTAMP_OUT_OF_RANGE' };
    }
    const { eventId, type, occurredAt: _o, ...rest } = ev;
    const inserted = await this.pool.query(
      `INSERT INTO game_events (game_server_id, event_id, type, roblox_user_id, payload, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (event_id) DO NOTHING RETURNING id`,
      [serverId, eventId, type, 'robloxUserId' in rest ? rest.robloxUserId : null, JSON.stringify(rest), occurredAt],
    );
    if (inserted.rowCount === 0) return { eventId, status: 'duplicate' };

    let result: EventOutcome;
    try {
      result = await this.apply(serverId, ev, occurredAt);
    } catch (err) {
      if (!(err instanceof AppError)) {
        // Technischer Fehler: Event wieder freigeben, damit der Spielserver es erneut senden kann.
        await this.pool.query('DELETE FROM game_events WHERE event_id = $1', [eventId]).catch(() => {});
        throw err;
      }
      result = { eventId, status: 'rejected', reason: err.internalDetail ?? err.code };
    }
    await this.pool.query('UPDATE game_events SET processing_result = $2 WHERE event_id = $1', [eventId, result.reason ? `${result.status}:${result.reason}` : result.status]);
    return result;
  }

  private async apply(serverId: string, ev: GameEvent, at: Date): Promise<EventOutcome> {
    switch (ev.type) {
      case 'player.join':
        await this.pool.query('INSERT INTO game_server_players (game_server_id, roblox_user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [serverId, ev.robloxUserId]);
        return { eventId: ev.eventId, status: 'processed' };
      case 'player.leave': {
        await this.pool.query('DELETE FROM game_server_players WHERE game_server_id = $1 AND roblox_user_id = $2', [serverId, ev.robloxUserId]);
        // Verlässt ein Spieler den Server, endet sein Spiel-Dienst.
        const link = await getActiveLinkByRoblox(this.pool, ev.robloxUserId);
        if (link) {
          const open = await this.duty.current(link.discordId);
          if (open?.source === 'game') await this.duty.end({ userId: link.userId, at });
        }
        return { eventId: ev.eventId, status: 'processed' };
      }
      case 'duty.start': {
        const link = await getActiveLinkByRoblox(this.pool, ev.robloxUserId);
        if (!link) return { eventId: ev.eventId, status: 'rejected', reason: 'NOT_LINKED' };
        const r = await this.duty.start({ userId: link.userId, factionKey: ev.faction, source: 'game', at, eventId: ev.eventId, gameServerId: serverId });
        return { eventId: ev.eventId, status: r.duplicate ? 'duplicate' : 'processed' };
      }
      case 'duty.end': {
        const link = await getActiveLinkByRoblox(this.pool, ev.robloxUserId);
        if (!link) return { eventId: ev.eventId, status: 'rejected', reason: 'NOT_LINKED' };
        const r = await this.duty.end({ userId: link.userId, at, eventId: ev.eventId });
        return { eventId: ev.eventId, status: r.duplicate ? 'duplicate' : 'processed' };
      }
    }
  }

  /**
   * Legt einen Admin-Auftrag an. Typ und Payload werden gegen eine feste Allowlist geprüft;
   * die Berechtigung wird hier – nicht im Discord-Command – verbindlich geprüft.
   */
  async createJob(actor: Actor, guildId: string, type: CommandType, payload: unknown, opts: { ttlSeconds?: number; reason?: string } = {}): Promise<{ id: string; expiresAt: Date }> {
    const schema = commandPayloadSchemas[type];
    if (!schema) throw new AppError('VALIDATION', 400, 'unbekannter Auftragstyp');
    const parsed = schema.safeParse(payload);
    if (!parsed.success) throw new AppError('VALIDATION', 400, parsed.error.issues.map((i) => i.message).join('; '));
    const ttl = Math.min(Math.max(opts.ttlSeconds ?? 300, 30), 3600);

    return withTransaction(this.pool, async (tx) => {
      await authorize(this.pool, actor, JOB_PERMISSIONS[type], { guildId });
      const userId = await ensureUser(tx, actor.discordId);
      const { rows } = await tx.query<{ id: string; expires_at: Date }>(
        `INSERT INTO command_jobs (type, payload, broadcast, created_by, expires_at)
         VALUES ($1, $2, $3, $4, now() + make_interval(secs => $5)) RETURNING id, expires_at`,
        [type, JSON.stringify(parsed.data), BROADCAST_COMMANDS.has(type), userId, ttl],
      );
      const job = rows[0]!;
      if (type === 'kick' || type === 'ban') {
        const p = parsed.data as { robloxUserId: string; reason: string; durationSeconds?: number | null };
        const target = await getActiveLinkByRoblox(tx, p.robloxUserId);
        await tx.query(
          `INSERT INTO moderation_cases (guild_id, action, target_user_id, target_roblox_id, moderator_id, reason, expires_at, command_job_id)
           VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $7::int IS NULL THEN NULL ELSE now() + make_interval(secs => $7::int) END, $8)`,
          [guildId, type === 'kick' ? 'game_kick' : 'game_ban', target?.userId ?? null, p.robloxUserId, userId, p.reason, type === 'ban' ? (p.durationSeconds ?? null) : null, job.id],
        );
      }
      await writeAudit(tx, {
        actorType: 'discord_user', actorId: actor.discordId, action: `game.job_created`, targetType: 'command_job', targetId: job.id, guildId,
        reason: opts.reason ?? null, metadata: { type, payload: parsed.data },
      });
      return { id: job.id, expiresAt: job.expires_at };
    });
  }

  /**
   * Liefert die für diesen Server freigegebenen Aufträge.
   * Broadcast-Aufträge erhält jeder Server einmal (bis er ein Ergebnis meldet);
   * Einzel-Aufträge werden atomar mit einem Lease für genau einen Server reserviert.
   */
  async pollJobs(jobId: string, limit = 10): Promise<PendingJob[]> {
    await this.serverIdFor(jobId);
    await this.expireJobs();
    const broadcast = await this.pool.query<PendingJob>(
      `SELECT c.id, c.type, c.payload, c.expires_at AS "expiresAt" FROM command_jobs c
       WHERE c.broadcast AND c.status = 'pending' AND c.expires_at > now()
         AND NOT EXISTS (SELECT 1 FROM command_job_results r WHERE r.command_job_id = c.id AND r.job_id = $1)
       ORDER BY c.created_at LIMIT $2`,
      [jobId, limit],
    );
    const single = await this.pool.query<PendingJob>(
      `UPDATE command_jobs SET status = 'claimed', claimed_by = $1, claimed_at = now(), lease_until = now() + make_interval(secs => $3), attempts = attempts + 1
       WHERE id IN (
         SELECT id FROM command_jobs
         WHERE NOT broadcast AND expires_at > now()
           AND (status = 'pending' OR (status = 'claimed' AND (lease_until < now() OR claimed_by = $1)))
           AND (target_job_id IS NULL OR target_job_id = $1)
         ORDER BY created_at LIMIT $2 FOR UPDATE SKIP LOCKED)
       RETURNING id, type, payload, expires_at AS "expiresAt"`,
      [jobId, limit, JOB_LEASE_SECONDS],
    );
    return [...broadcast.rows, ...single.rows];
  }

  /** Ergebnis eines Auftrags. Idempotent: wiederholte Meldungen desselben Servers ändern nichts. */
  async reportResult(jobId: string, commandJobId: string, success: boolean, message?: string): Promise<{ status: string; duplicate: boolean }> {
    if (!/^[0-9a-f-]{36}$/i.test(commandJobId)) throw new AppError('NOT_FOUND', 404);
    await this.serverIdFor(jobId);
    const result = await this.applyResult(jobId, commandJobId, success, message);
    // Der Statuswechsel auf 'expired' wird committet, erst danach wird abgelehnt.
    if (result.status === 'expired' && !result.duplicate) throw new AppError('SESSION_EXPIRED', 410, 'Auftrag abgelaufen');
    return result;
  }

  private async applyResult(jobId: string, commandJobId: string, success: boolean, message?: string): Promise<{ status: string; duplicate: boolean }> {
    return withTransaction(this.pool, async (tx: PoolClient) => {
      const { rows } = await tx.query<{ status: string; broadcast: boolean; claimed_by: string | null; expired: boolean; type: string }>(
        'SELECT status, broadcast, claimed_by, expires_at <= now() AS expired, type FROM command_jobs WHERE id = $1 FOR UPDATE',
        [commandJobId],
      );
      const job = rows[0];
      if (!job) throw new AppError('NOT_FOUND', 404);

      if (job.broadcast) {
        const r = await tx.query(
          'INSERT INTO command_job_results (command_job_id, job_id, success, message) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
          [commandJobId, jobId, success, message ?? null],
        );
        if (r.rowCount && job.type === 'kick' && success) {
          // Kick ist erledigt, sobald ein Server den Spieler entfernt hat.
          await tx.query(`UPDATE command_jobs SET status = 'succeeded', completed_at = now() WHERE id = $1 AND status = 'pending'`, [commandJobId]);
        }
        return { status: job.status, duplicate: r.rowCount === 0 };
      }

      if (job.status === 'succeeded' || job.status === 'failed') {
        if (job.claimed_by === jobId) return { status: job.status, duplicate: true };
        throw new AppError('CONFLICT', 409, 'bereits abgeschlossen');
      }
      if (job.status !== 'claimed' || job.claimed_by !== jobId) throw new AppError('CONFLICT', 409, 'nicht für diesen Server reserviert');
      if (job.expired) {
        await tx.query(`UPDATE command_jobs SET status = 'expired', completed_at = now() WHERE id = $1`, [commandJobId]);
        return { status: 'expired', duplicate: false };
      }
      const status = success ? 'succeeded' : 'failed';
      await tx.query(
        `UPDATE command_jobs SET status = $2, completed_at = now(), result = $3 WHERE id = $1`,
        [commandJobId, status, JSON.stringify({ success, message: message ?? null })],
      );
      await writeAudit(tx, { actorType: 'game_server', actorId: jobId, action: 'game.job_completed', targetType: 'command_job', targetId: commandJobId, outcome: success ? 'success' : 'failure', reason: message ?? null });
      return { status, duplicate: false };
    });
  }

  /** Schließt abgelaufene Aufträge ab. */
  async expireJobs(): Promise<number> {
    const r = await this.pool.query(
      `UPDATE command_jobs c SET completed_at = now(),
         status = CASE WHEN c.broadcast AND EXISTS (SELECT 1 FROM command_job_results r WHERE r.command_job_id = c.id AND r.success)
                       THEN 'succeeded'::command_job_status ELSE 'expired'::command_job_status END
       WHERE c.status IN ('pending', 'claimed') AND c.expires_at <= now()`,
    );
    return r.rowCount ?? 0;
  }

  /** Beendet Spiel-Dienste auf Servern ohne Heartbeat (Absturz). */
  async reapStaleServers(): Promise<number> {
    const { rows } = await this.pool.query<{ id: string }>(
      `SELECT id FROM game_servers WHERE shutdown_at IS NULL AND last_heartbeat_at < now() - make_interval(secs => $1 * 3)`,
      [SERVER_STALE_SECONDS],
    );
    let ended = 0;
    for (const { id } of rows) {
      await withTransaction(this.pool, async (tx) => {
        ended += await this.duty.endAllForServer(tx, id);
        await tx.query('UPDATE game_servers SET shutdown_at = now() WHERE id = $1', [id]);
        await tx.query('DELETE FROM game_server_players WHERE game_server_id = $1', [id]);
      });
    }
    return ended;
  }

  async status(): Promise<{ servers: number; players: number; maintenance: GameSettings['maintenance']; list: { jobId: string; players: number; maxPlayers: number | null; lastHeartbeatAt: Date }[] }> {
    const { rows } = await this.pool.query<{ job_id: string; player_count: number; max_players: number | null; last_heartbeat_at: Date }>(
      `SELECT job_id, player_count, max_players, last_heartbeat_at FROM game_servers
       WHERE shutdown_at IS NULL AND last_heartbeat_at > now() - make_interval(secs => $1) ORDER BY player_count DESC`,
      [SERVER_STALE_SECONDS],
    );
    const settings = await this.getSettings();
    return {
      servers: rows.length,
      players: rows.reduce((a, r) => a + r.player_count, 0),
      maintenance: settings.maintenance,
      list: rows.map((r) => ({ jobId: r.job_id, players: r.player_count, maxPlayers: r.max_players, lastHeartbeatAt: r.last_heartbeat_at })),
    };
  }

  /** Verifizierte Spieler auf aktiven Servern (Roblox-ID + ggf. Discord-ID). */
  async onlinePlayers(): Promise<{ robloxUserId: string; robloxUsername: string | null; discordId: string | null }[]> {
    const { rows } = await this.pool.query<{ roblox_user_id: string; roblox_username: string | null; discord_id: string | null }>(
      `SELECT p.roblox_user_id, l.roblox_username, u.discord_id FROM game_server_players p
       JOIN game_servers s ON s.id = p.game_server_id AND s.shutdown_at IS NULL AND s.last_heartbeat_at > now() - make_interval(secs => $1)
       LEFT JOIN discord_links l ON l.roblox_user_id = p.roblox_user_id AND l.revoked_at IS NULL
       LEFT JOIN users u ON u.id = l.user_id ORDER BY l.roblox_username NULLS LAST LIMIT 200`,
      [SERVER_STALE_SECONDS],
    );
    return rows.map((r) => ({ robloxUserId: r.roblox_user_id, robloxUsername: r.roblox_username, discordId: r.discord_id }));
  }
}
