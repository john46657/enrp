import { OWNER_ROLE } from '@emden/shared';
import { eq } from 'drizzle-orm';
import { writeAudit } from '../audit.js';
import type { Database } from '../db/database.js';
import { users } from '../db/schema.js';

export type BootstrapResult = 'created' | 'promoted' | 'owner_exists';

/**
 * Gesicherte Ersteinrichtung: Solange es noch KEINEN Owner gibt, wird die in OWNER_DISCORD_USER_ID
 * eingetragene Discord-ID zum Owner. Gibt es bereits einen Owner, passiert nichts – ein später
 * geänderter Wert kann also keinen weiteren Owner erzeugen. Es gibt kein Standardkonto und kein Passwort;
 * nur wer die Umgebungsvariablen des Servers setzen kann, kann den ersten Owner bestimmen.
 */
export async function ensureBootstrapOwner(db: Database, discordUserId: string): Promise<BootstrapResult> {
  return db.transaction(async (tx) => {
    const [owner] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.roleKey, OWNER_ROLE))
      .limit(1);
    if (owner) return 'owner_exists';

    const [existing] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.discordUserId, discordUserId))
      .limit(1);
    let userId: string;
    let result: BootstrapResult;
    if (existing) {
      await tx.update(users).set({ roleKey: OWNER_ROLE, status: 'active' }).where(eq(users.id, existing.id));
      userId = existing.id;
      result = 'promoted';
    } else {
      const [created] = await tx
        .insert(users)
        // Der richtige Name wird bei der ersten Anmeldung von Discord übernommen.
        .values({ discordUserId, displayName: 'Owner', roleKey: OWNER_ROLE })
        .returning({ id: users.id });
      userId = (created as { id: string }).id;
      result = 'created';
    }
    await writeAudit(tx, {
      actor: { type: 'system', label: 'Ersteinrichtung' },
      action: 'owner.bootstrap',
      outcome: 'success',
      target: { type: 'user', id: userId },
      details: { discordUserId, source: 'OWNER_DISCORD_USER_ID', result },
    });
    return result;
  });
}
