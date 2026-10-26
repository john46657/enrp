import { securityEvents, type DbExecutor } from '@enrp/database';
import { hmacHex } from './crypto';

export type SecuritySeverity = 'info' | 'warning' | 'critical';

/**
 * Speichert Sicherheitsereignisse. IP-Adressen werden nur als HMAC gespeichert (Datenminimierung),
 * Details dürfen keine Tokens oder Geheimnisse enthalten.
 */
export async function recordSecurityEvent(
  db: DbExecutor,
  hashSecret: string,
  event: {
    type: string;
    severity?: SecuritySeverity;
    actorId?: string | null;
    ip?: string | null;
    details?: Record<string, unknown>;
  },
): Promise<void> {
  await db.insert(securityEvents).values({
    type: event.type,
    severity: event.severity ?? 'warning',
    actorId: event.actorId ?? null,
    ipHash: event.ip ? hashIp(hashSecret, event.ip) : null,
    details: event.details ?? null,
  });
}

export function hashIp(secret: string, ip: string): string {
  return hmacHex(secret, `ip:${ip}`).slice(0, 32);
}
