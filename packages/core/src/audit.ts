import type { Queryable } from '@emden-network/database';

export type ActorType = 'discord_user' | 'system' | 'game_server' | 'api';

export interface AuditEntry {
  actorType: ActorType;
  actorId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  guildId?: string | null;
  outcome?: 'success' | 'denied' | 'failure';
  reason?: string | null;
  metadata?: Record<string, unknown>;
}

// Schlüssel, die niemals in Audit-Metadaten landen dürfen.
const FORBIDDEN_KEYS = /token|secret|password|verifier|code$|authorization|cookie/i;

function scrub(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    out[k] = FORBIDDEN_KEYS.test(k) ? '[entfernt]' : v;
  }
  return out;
}

export async function writeAudit(db: Queryable, e: AuditEntry): Promise<void> {
  await db.query(
    `INSERT INTO audit_logs (actor_type, actor_id, action, target_type, target_id, guild_id, outcome, reason, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      e.actorType,
      e.actorId ?? null,
      e.action,
      e.targetType ?? null,
      e.targetId ?? null,
      e.guildId ?? null,
      e.outcome ?? 'success',
      e.reason ?? null,
      JSON.stringify(scrub(e.metadata ?? {})),
    ],
  );
}
