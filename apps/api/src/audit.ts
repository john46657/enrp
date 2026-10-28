import type { Database } from './db/database.js';
import { auditLog } from './db/schema.js';

/** Alle protokollierten Aktionen an einer Stelle – so bleibt das Audit-Log einheitlich auswertbar. */
export const AUDIT_ACTIONS = {
  'auth.login': 'Anmeldung',
  'auth.login_denied': 'Anmeldung abgelehnt',
  'auth.logout': 'Abmeldung',
  'owner.bootstrap': 'Owner bei der Ersteinrichtung angelegt',
  'user.create': 'Benutzer freigeschaltet',
  'user.update': 'Benutzer geändert',
  'role.permissions_update': 'Rollenrechte geändert',
} as const;
export type AuditAction = keyof typeof AUDIT_ACTIONS;

export function auditActionLabel(action: string): string {
  return (AUDIT_ACTIONS as Record<string, string>)[action] ?? action;
}

export type AuditActor =
  | { type: 'user'; userId: string; label: string }
  | { type: 'system'; label: string }
  | { type: 'cli'; label: string };

export interface AuditEntry {
  actor: AuditActor;
  action: AuditAction;
  outcome: 'success' | 'denied' | 'failure';
  target?: { type: string; id: string };
  /** Nur einfache Werte (Text, Zahl, Wahrheitswert) – niemals Tokens oder Geheimnisse. */
  details?: Record<string, string | number | boolean | null>;
  requestId?: string;
}

/** Drizzle-Datenbank oder -Transaktion. */
type Executor = Pick<Database, 'insert'>;

const MAX_DETAIL_LENGTH = 200;

function sanitize(details: AuditEntry['details']): Record<string, string | number | boolean | null> {
  const clean: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(details ?? {}).slice(0, 20)) {
    clean[key.slice(0, 64)] = typeof value === 'string' ? value.slice(0, MAX_DETAIL_LENGTH) : value;
  }
  return clean;
}

export async function writeAudit(db: Executor, entry: AuditEntry): Promise<void> {
  await db.insert(auditLog).values({
    actorType: entry.actor.type,
    actorUserId: entry.actor.type === 'user' ? entry.actor.userId : null,
    actorLabel: entry.actor.label.slice(0, 128) || 'Unbekannt',
    action: entry.action,
    outcome: entry.outcome,
    targetType: entry.target?.type ?? null,
    targetId: entry.target?.id ?? null,
    details: sanitize(entry.details),
    requestId: entry.requestId ?? null,
  });
}
