import { sql, type DbExecutor } from '@enrp/database';
import { systemActor } from '../actor';
import { writeAudit } from '../audit';
import { type CoreContext } from '../context';
import { getSetting, type SettingValue } from '../settings';

interface RetentionRule {
  key: string;
  label: string;
  days: (r: SettingValue<'retention'>) => number;
  /** SQL-Bedingung für zu löschende Zeilen; $cutoff wird ersetzt. */
  table: string;
  where: (cutoff: Date) => ReturnType<typeof sql>;
  audit?: boolean;
}

/** Aufbewahrungsregeln. Alle Fristen sind über die Einstellung "retention" konfigurierbar. */
export const RETENTION_RULES: RetentionRule[] = [
  { key: 'game_events', label: 'Rohdaten der Spielereignisse', days: (r) => r.gameEventsDays, table: 'game_events', where: (c) => sql`received_at < ${c}` },
  { key: 'request_nonces', label: 'Replay-Schutz-Nonces', days: () => 1, table: 'request_nonces', where: (c) => sql`received_at < ${c}` },
  { key: 'idempotency_keys', label: 'Idempotenzschlüssel', days: () => 2, table: 'idempotency_keys', where: (c) => sql`created_at < ${c}` },
  { key: 'oauth_states', label: 'Abgelaufene OAuth-Zustände', days: () => 1, table: 'oauth_states', where: (c) => sql`expires_at < ${c}` },
  { key: 'admin_sessions', label: 'Abgelaufene Dashboard-Sitzungen', days: () => 30, table: 'admin_sessions', where: (c) => sql`expires_at < ${c}` },
  { key: 'verifications', label: 'Verifizierungsprotokoll', days: (r) => r.verificationLogDays, table: 'verifications', where: (c) => sql`created_at < ${c}` },
  { key: 'security_events', label: 'Sicherheitsereignisse', days: (r) => r.securityEventsDays, table: 'security_events', where: (c) => sql`occurred_at < ${c}` },
  { key: 'job_runs', label: 'Jobhistorie', days: (r) => r.jobRunsDays, table: 'job_runs', where: (c) => sql`started_at < ${c}` },
  { key: 'closed_tickets', label: 'Geschlossene Tickets', days: (r) => r.closedTicketsDays, table: 'tickets', where: (c) => sql`status = 'closed' and closed_at < ${c}` },
  { key: 'privacy_exports', label: 'Abgelaufene Datenauskünfte (Inhalt)', days: () => 0, table: 'privacy_requests', where: (c) => sql`type = 'export' and result is not null and expires_at < ${c}` },
  { key: 'audit_events', label: 'Audit-Log', days: (r) => r.auditEventsDays, table: 'audit_events', where: (c) => sql`occurred_at < ${c}`, audit: true },
];

function cutoffFor(rule: RetentionRule, retention: SettingValue<'retention'>, now: Date) {
  return new Date(now.getTime() - rule.days(retention) * 86400_000);
}

/** /data cleanup-preview: was würde die nächste Bereinigung löschen? */
export async function retentionPreview(db: DbExecutor, now: Date) {
  const retention = await getSetting(db, 'retention');
  const items = [];
  for (const rule of RETENTION_RULES) {
    const cutoff = cutoffFor(rule, retention, now);
    const r = await db.execute<{ c: number }>(sql`select count(*)::int as c from ${sql.identifier(rule.table)} where ${rule.where(cutoff)}`);
    items.push({ key: rule.key, label: rule.label, days: rule.days(retention), cutoff, rows: r.rows[0]?.c ?? 0 });
  }
  return items;
}

/**
 * Wendet die Aufbewahrungsfristen an (Worker, täglich). Datenauskünfte werden geleert statt gelöscht,
 * das Audit-Log nur in einer markierten Wartungstransaktion. Jede Bereinigung wird protokolliert.
 */
export async function applyRetention(ctx: CoreContext, options: { maxRowsPerRule?: number } = {}) {
  const now = ctx.now();
  const retention = await getSetting(ctx.db, 'retention');
  const limit = options.maxRowsPerRule ?? 10_000;
  const summary: Record<string, number> = {};
  for (const rule of RETENTION_RULES) {
    const cutoff = cutoffFor(rule, retention, now);
    const deleted = await ctx.db.transaction(async (tx) => {
      if (rule.key === 'privacy_exports') {
        const r = await tx.execute(sql`update privacy_requests set result = null where ${rule.where(cutoff)}`);
        return r.rowCount ?? 0;
      }
      if (rule.audit) await tx.execute(sql`set local enrp.audit_maintenance = 'on'`);
      const r = await tx.execute(
        sql`delete from ${sql.identifier(rule.table)} where ctid in (select ctid from ${sql.identifier(rule.table)} where ${rule.where(cutoff)} limit ${limit})`,
      );
      return r.rowCount ?? 0;
    });
    summary[rule.key] = deleted;
  }
  await writeAudit(ctx.db, systemActor('retention'), { action: 'retention.apply', resourceType: 'retention', metadata: summary }, now);
  return summary;
}
