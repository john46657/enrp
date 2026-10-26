import type { Pool } from '@emden-network/database';

/**
 * Aufbewahrungsfristen (siehe docs/datenschutz.md). Werte in Tagen.
 * OAuth-Sessions werden separat über VerificationService.cleanup (24 h) bereinigt.
 */
export const RETENTION_DAYS = {
  gameEvents: 180,
  outboxDone: 30,
  commandJobs: 90,
  auditLogs: 365,
  revokedLinks: 365,
} as const;

export async function purgeExpiredData(pool: Pool): Promise<Record<string, number>> {
  const run = async (sql: string, days: number) => (await pool.query(sql, [days])).rowCount ?? 0;
  return {
    gameEvents: await run(`DELETE FROM game_events WHERE received_at < now() - make_interval(days => $1)`, RETENTION_DAYS.gameEvents),
    outbox: await run(`DELETE FROM outbox_events WHERE status IN ('done', 'failed') AND created_at < now() - make_interval(days => $1)`, RETENTION_DAYS.outboxDone),
    commandJobs: await run(`DELETE FROM command_jobs WHERE status NOT IN ('pending', 'claimed') AND created_at < now() - make_interval(days => $1)`, RETENTION_DAYS.commandJobs),
    auditLogs: await run(`DELETE FROM audit_logs WHERE occurred_at < now() - make_interval(days => $1)`, RETENTION_DAYS.auditLogs),
    revokedLinks: await run(`DELETE FROM discord_links WHERE revoked_at < now() - make_interval(days => $1)`, RETENTION_DAYS.revokedLinks),
  };
}
