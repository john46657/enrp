import { AppError, type Actor, type FactionKey } from '@emden-network/shared';
import { isPgError, PgErrorCode, withTransaction, type Pool, type Queryable } from '@emden-network/database';
import { authorize } from './authz.js';
import { writeAudit } from './audit.js';
import { getMembership } from './factions.js';

const MAX_SESSION_MS = 24 * 60 * 60 * 1000;
/** Erlaubte Abweichung von Zeitstempeln des Spielservers gegenüber der Serverzeit */
const MAX_CLOCK_SKEW_MS = 60 * 1000;

export interface DutySession {
  id: string;
  discordId: string;
  factionKey: FactionKey;
  source: 'discord' | 'game';
  startedAt: Date;
  endedAt: Date | null;
}

export interface StartDutyInput {
  userId: string;
  factionKey: FactionKey;
  source: 'discord' | 'game';
  at?: Date;
  eventId?: string;
  gameServerId?: string;
}

export interface EndDutyInput {
  userId: string;
  at?: Date;
  eventId?: string;
}

const SESSION_COLUMNS = `d.id, u.discord_id AS "discordId", f.key AS "factionKey", d.source, d.started_at AS "startedAt", d.ended_at AS "endedAt"`;

export class DutyService {
  constructor(private readonly pool: Pool) {}

  /**
   * Beginnt eine Dienstsitzung. Idempotent bezüglich eventId; höchstens eine offene Sitzung je Nutzer
   * (durch partiellen Unique-Index garantiert).
   */
  async start(input: StartDutyInput): Promise<{ session: DutySession; duplicate: boolean }> {
    const at = input.at ?? new Date();
    assertPlausibleTime(at);
    if (input.factionKey === 'zivil') throw new AppError('VALIDATION', 400, 'Zivilisten haben keinen Dienst');

    if (input.eventId) {
      const existing = await this.findBy('d.start_event_id = $1', [input.eventId]);
      if (existing) return { session: existing, duplicate: true };
    }

    return withTransaction(this.pool, async (tx) => {
      const { rows: member } = await tx.query<{ faction_id: string; discord_id: string }>(
        `SELECT m.faction_id, u.discord_id FROM faction_members m JOIN factions f ON f.id = m.faction_id JOIN users u ON u.id = m.user_id
         WHERE m.user_id = $1 AND m.left_at IS NULL AND f.key = $2`,
        [input.userId, input.factionKey],
      );
      if (!member[0]) throw new AppError('FORBIDDEN', 403, 'kein Mitglied dieser Fraktion');
      try {
        const { rows } = await tx.query<{ id: string }>(
          `INSERT INTO duty_sessions (user_id, faction_id, source, started_at, start_event_id, game_server_id)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [input.userId, member[0].faction_id, input.source, at, input.eventId ?? null, input.gameServerId ?? null],
        );
        await writeAudit(tx, {
          actorType: input.source === 'game' ? 'game_server' : 'discord_user',
          actorId: input.source === 'game' ? (input.gameServerId ?? null) : member[0].discord_id,
          action: 'duty.started', targetType: 'discord_user', targetId: member[0].discord_id,
          metadata: { faction: input.factionKey, source: input.source },
        });
        const session = await this.findBy('d.id = $1', [rows[0]!.id], tx);
        return { session: session!, duplicate: false };
      } catch (err) {
        if (isPgError(err, PgErrorCode.UniqueViolation)) {
          const constraint = (err as { constraint?: string }).constraint;
          if (constraint === 'duty_sessions_start_event_uq') {
            throw new AppError('CONFLICT', 409, 'Event wurde parallel verarbeitet');
          }
          throw new AppError('CONFLICT', 409, 'bereits im Dienst');
        }
        throw err;
      }
    });
  }

  /**
   * Beendet die offene Dienstsitzung. Doppelte Beendigung (gleiche eventId oder keine offene Sitzung)
   * führt zu keiner Änderung. Endzeit vor Beginn wird abgelehnt; Sitzungen über 24 h werden gekappt.
   */
  async end(input: EndDutyInput): Promise<{ session: DutySession | null; duplicate: boolean; capped: boolean }> {
    const at = input.at ?? new Date();
    assertPlausibleTime(at);
    if (input.eventId) {
      const existing = await this.findBy('d.end_event_id = $1', [input.eventId]);
      if (existing) return { session: existing, duplicate: true, capped: false };
    }
    return withTransaction(this.pool, async (tx) => {
      const { rows } = await tx.query<{ id: string; started_at: Date; discord_id: string; faction_key: string }>(
        `SELECT d.id, d.started_at, u.discord_id, f.key AS faction_key FROM duty_sessions d JOIN users u ON u.id = d.user_id JOIN factions f ON f.id = d.faction_id
         WHERE d.user_id = $1 AND d.ended_at IS NULL FOR UPDATE OF d`,
        [input.userId],
      );
      const open = rows[0];
      if (!open) return { session: null, duplicate: true, capped: false };
      if (at.getTime() < open.started_at.getTime()) throw new AppError('VALIDATION', 400, 'Dienstende liegt vor Dienstbeginn');
      let end = at;
      let capped = false;
      if (at.getTime() - open.started_at.getTime() > MAX_SESSION_MS) {
        end = new Date(open.started_at.getTime() + MAX_SESSION_MS);
        capped = true;
      }
      await tx.query(
        `UPDATE duty_sessions SET ended_at = $2, end_event_id = $3,
           corrected_at = CASE WHEN $4 THEN now() ELSE corrected_at END,
           correction_reason = CASE WHEN $4 THEN 'Automatisch auf 24 Stunden begrenzt' ELSE correction_reason END,
           original_ended_at = CASE WHEN $4 THEN $5::timestamptz ELSE original_ended_at END
         WHERE id = $1`,
        [open.id, end, input.eventId ?? null, capped, at],
      );
      await writeAudit(tx, {
        actorType: 'system', action: 'duty.ended', targetType: 'discord_user', targetId: open.discord_id,
        metadata: { faction: open.faction_key, sessionId: open.id, capped },
      });
      return { session: await this.findBy('d.id = $1', [open.id], tx), duplicate: false, capped };
    });
  }

  async current(discordId: string): Promise<DutySession | null> {
    return this.findBy('u.discord_id = $1 AND d.ended_at IS NULL', [discordId]);
  }

  async onDuty(factionKey: string): Promise<DutySession[]> {
    const { rows } = await this.pool.query<DutySession>(
      `SELECT ${SESSION_COLUMNS} FROM duty_sessions d JOIN users u ON u.id = d.user_id JOIN factions f ON f.id = d.faction_id
       WHERE f.key = $1 AND d.ended_at IS NULL ORDER BY d.started_at`,
      [factionKey],
    );
    return rows;
  }

  /** Summierte Dienstzeit in Sekunden (laufende Sitzungen bis jetzt) innerhalb der letzten `days` Tage. */
  async totalSeconds(filter: { discordId?: string; factionKey?: string }, days: number | null): Promise<number> {
    const { rows } = await this.pool.query<{ s: string | null }>(
      `SELECT sum(extract(epoch FROM (coalesce(d.ended_at, now()) - greatest(d.started_at, coalesce(now() - make_interval(days => $3), d.started_at))))) AS s
       FROM duty_sessions d JOIN users u ON u.id = d.user_id JOIN factions f ON f.id = d.faction_id
       WHERE ($1::text IS NULL OR u.discord_id = $1) AND ($2::text IS NULL OR f.key = $2)
         AND ($3::int IS NULL OR coalesce(d.ended_at, now()) > now() - make_interval(days => $3))`,
      [filter.discordId ?? null, filter.factionKey ?? null, days],
    );
    return Math.max(0, Math.round(Number(rows[0]?.s ?? 0)));
  }

  async topMembers(factionKey: string, days: number, limit = 10): Promise<{ discordId: string; seconds: number }[]> {
    const { rows } = await this.pool.query<{ discord_id: string; s: string }>(
      `SELECT u.discord_id, sum(extract(epoch FROM (coalesce(d.ended_at, now()) - greatest(d.started_at, now() - make_interval(days => $2))))) AS s
       FROM duty_sessions d JOIN users u ON u.id = d.user_id JOIN factions f ON f.id = d.faction_id
       WHERE f.key = $1 AND coalesce(d.ended_at, now()) > now() - make_interval(days => $2)
       GROUP BY u.discord_id ORDER BY s DESC LIMIT $3`,
      [factionKey, days, limit],
    );
    return rows.map((r) => ({ discordId: r.discord_id, seconds: Math.round(Number(r.s)) }));
  }

  /** Korrigiert Beginn/Ende einer Sitzung. Originalwerte bleiben erhalten; Aktion wird protokolliert. */
  async correct(actor: Actor, guildId: string, sessionId: string, change: { startedAt?: Date; endedAt?: Date }, reason: string): Promise<DutySession> {
    if (!/^[0-9a-f-]{36}$/i.test(sessionId)) throw new AppError('VALIDATION', 400, 'Sitzungs-ID');
    return withTransaction(this.pool, async (tx) => {
      const { rows } = await tx.query<{ started_at: Date; ended_at: Date | null; faction_key: FactionKey; discord_id: string; corrected_at: Date | null }>(
        `SELECT d.started_at, d.ended_at, f.key AS faction_key, u.discord_id, d.corrected_at FROM duty_sessions d
         JOIN factions f ON f.id = d.faction_id JOIN users u ON u.id = d.user_id WHERE d.id = $1 FOR UPDATE OF d`,
        [sessionId],
      );
      const s = rows[0];
      if (!s) throw new AppError('NOT_FOUND', 404);
      await authorize(this.pool, actor, 'duty.correct', { faction: s.faction_key, guildId });
      const startedAt = change.startedAt ?? s.started_at;
      const endedAt = change.endedAt ?? s.ended_at;
      if (startedAt.getTime() > Date.now() + MAX_CLOCK_SKEW_MS || (endedAt && endedAt.getTime() > Date.now() + MAX_CLOCK_SKEW_MS)) {
        throw new AppError('VALIDATION', 400, 'Zeitpunkt in der Zukunft');
      }
      if (endedAt && endedAt < startedAt) throw new AppError('VALIDATION', 400, 'Ende vor Beginn');
      if (endedAt && endedAt.getTime() - startedAt.getTime() > MAX_SESSION_MS) throw new AppError('VALIDATION', 400, 'Sitzung länger als 24 Stunden');
      await tx.query(
        `UPDATE duty_sessions SET started_at = $2, ended_at = $3, corrected_at = now(), correction_reason = $4,
           corrected_by = (SELECT id FROM users WHERE discord_id = $5),
           original_started_at = coalesce(original_started_at, $6), original_ended_at = coalesce(original_ended_at, $7)
         WHERE id = $1`,
        [sessionId, startedAt, endedAt, reason, actor.discordId, s.started_at, s.ended_at],
      );
      await writeAudit(tx, {
        actorType: 'discord_user', actorId: actor.discordId, action: 'duty.corrected', targetType: 'discord_user', targetId: s.discord_id, guildId, reason,
        metadata: { faction: s.faction_key, sessionId, before: { startedAt: s.started_at, endedAt: s.ended_at }, after: { startedAt, endedAt } },
      });
      return (await this.findBy('d.id = $1', [sessionId], tx))!;
    });
  }

  /** CSV-Export der Sitzungen einer Fraktion (Semikolon-getrennt, UTC-Zeitstempel). */
  async exportCsv(actor: Actor, guildId: string, factionKey: FactionKey, days: number): Promise<string> {
    await authorize(this.pool, actor, 'duty.export', { faction: factionKey, guildId });
    const { rows } = await this.pool.query<{ id: string; discord_id: string; roblox_user_id: string | null; source: string; started_at: Date; ended_at: Date | null; corrected: boolean }>(
      `SELECT d.id, u.discord_id, l.roblox_user_id, d.source, d.started_at, d.ended_at, d.corrected_at IS NOT NULL AS corrected
       FROM duty_sessions d JOIN users u ON u.id = d.user_id JOIN factions f ON f.id = d.faction_id
       LEFT JOIN discord_links l ON l.user_id = u.id AND l.revoked_at IS NULL
       WHERE f.key = $1 AND d.started_at > now() - make_interval(days => $2) ORDER BY d.started_at`,
      [factionKey, days],
    );
    await writeAudit(this.pool, { actorType: 'discord_user', actorId: actor.discordId, action: 'duty.exported', guildId, metadata: { faction: factionKey, days, rows: rows.length } });
    const header = 'sitzung;discord_id;roblox_id;quelle;beginn_utc;ende_utc;dauer_minuten;korrigiert';
    const lines = rows.map((r) => {
      const minutes = r.ended_at ? Math.round((r.ended_at.getTime() - r.started_at.getTime()) / 60000) : '';
      return [r.id, r.discord_id, r.roblox_user_id ?? '', r.source, r.started_at.toISOString(), r.ended_at?.toISOString() ?? '', minutes, r.corrected ? 'ja' : 'nein'].join(';');
    });
    return [header, ...lines].join('\n') + '\n';
  }

  /** Beendet alle offenen Spiel-Sitzungen eines Servers (Server heruntergefahren / verschwunden). */
  async endAllForServer(db: Queryable, gameServerId: string): Promise<number> {
    const r = await db.query(
      `UPDATE duty_sessions SET ended_at = least(now(), started_at + interval '24 hours') WHERE game_server_id = $1 AND source = 'game' AND ended_at IS NULL`,
      [gameServerId],
    );
    return r.rowCount ?? 0;
  }

  private async findBy(where: string, params: unknown[], db: Queryable = this.pool): Promise<DutySession | null> {
    const { rows } = await db.query<DutySession>(
      `SELECT ${SESSION_COLUMNS} FROM duty_sessions d JOIN users u ON u.id = d.user_id JOIN factions f ON f.id = d.faction_id WHERE ${where} LIMIT 1`,
      params,
    );
    return rows[0] ?? null;
  }
}

function assertPlausibleTime(at: Date): void {
  if (Number.isNaN(at.getTime())) throw new AppError('VALIDATION', 400, 'ungültiger Zeitstempel');
  if (at.getTime() > Date.now() + MAX_CLOCK_SKEW_MS) throw new AppError('VALIDATION', 400, 'Zeitstempel liegt in der Zukunft');
}

/** Hilfsfunktion für Discord-Commands: Dienst des Aufrufers in seiner Fraktion starten. */
export async function startOwnDuty(pool: Pool, duty: DutyService, userId: string, discordId: string, requestedFaction?: FactionKey) {
  const m = await getMembership(pool, discordId);
  if (!m) throw new AppError('FORBIDDEN', 403, 'keine Fraktion');
  if (requestedFaction && requestedFaction !== m.factionKey) throw new AppError('FORBIDDEN', 403, 'fremde Fraktion');
  return duty.start({ userId, factionKey: m.factionKey, source: 'discord' });
}
