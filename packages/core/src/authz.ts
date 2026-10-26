import { AppError, checkPermission, type Actor, type Permission, type PermissionContext } from '@emden-network/shared';
import type { Pool } from '@emden-network/database';
import { writeAudit } from './audit.js';

/**
 * Prüft eine Berechtigung serverseitig und protokolliert verweigerte Versuche.
 * Muss unmittelbar vor jeder kritischen Änderung aufgerufen werden – unabhängig davon,
 * ob der Command in Discord sichtbar war.
 *
 * Bewusst ein Pool und kein Transaktions-Client: Die Protokollierung einer Verweigerung darf nicht
 * mit der fachlichen Transaktion zurückgerollt werden.
 */
export async function authorize(db: Pool, actor: Actor, permission: Permission, ctx: PermissionContext & { guildId?: string } = {}): Promise<void> {
  const decision = checkPermission(actor, permission, ctx);
  if (decision.allowed) return;
  await writeAudit(db, {
    actorType: 'discord_user',
    actorId: actor.discordId,
    action: 'permission.denied',
    guildId: ctx.guildId ?? null,
    outcome: 'denied',
    reason: decision.reason,
    metadata: { permission, faction: ctx.faction ?? null },
  });
  throw new AppError('FORBIDDEN', 403, `${permission}: ${decision.reason}`);
}
