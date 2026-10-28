import { lt, lte, or } from 'drizzle-orm';
import type { SessionSettings } from './auth/sessions.js';
import type { Database } from './db/database.js';
import { auditLog, sessions } from './db/schema.js';

export interface MaintenanceSettings {
  session: SessionSettings;
  auditRetentionDays: number;
}

/**
 * Aufräumen nach den Aufbewahrungsregeln. Idempotent: Mehrfaches Ausführen schadet nicht.
 * - abgelaufene oder zu lange untätige Sitzungen
 * - Audit-Einträge, die älter als AUDIT_RETENTION_DAYS sind
 */
export async function runMaintenance(
  db: Database,
  now: Date,
  settings: MaintenanceSettings,
): Promise<{ sessions: number; auditEntries: number }> {
  const idleLimit = new Date(now.getTime() - settings.session.idleMinutes * 60_000);
  const expired = await db
    .delete(sessions)
    .where(or(lte(sessions.expiresAt, now), lte(sessions.lastSeenAt, idleLimit)))
    .returning({ id: sessions.id });

  const retentionLimit = new Date(now.getTime() - settings.auditRetentionDays * 86_400_000);
  const old = await db
    .delete(auditLog)
    .where(lt(auditLog.occurredAt, retentionLimit))
    .returning({ id: auditLog.id });

  return { sessions: expired.length, auditEntries: old.length };
}
