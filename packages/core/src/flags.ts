import { eq, featureFlags, type DbExecutor } from '@enrp/database';
import { AppError, errors, KNOWN_FEATURE_FLAGS } from '@enrp/shared';
import { type Actor, actorId, requirePermission } from './actor';
import { writeAudit } from './audit';
import { type CoreContext } from './context';
import { recordConfigVersion } from './settings';

const CACHE_TTL_MS = 3_000;
let cache: { at: number; flags: Map<string, boolean> } | null = null;

export function invalidateFlagCache(): void {
  cache = null;
}

export async function loadFlags(db: DbExecutor, now = Date.now()): Promise<Map<string, boolean>> {
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.flags;
  const rows = await db.select({ key: featureFlags.key, enabled: featureFlags.enabled }).from(featureFlags);
  const flags = new Map(rows.map((r) => [r.key, r.enabled]));
  cache = { at: now, flags };
  return flags;
}

/** Unbekannte Flags gelten als aktiv; kill_switch und maintenance_mode als inaktiv. */
export async function isFlagEnabled(db: DbExecutor, key: string): Promise<boolean> {
  const flags = await loadFlags(db);
  if (flags.has(key)) return flags.get(key)!;
  return key !== 'kill_switch' && key !== 'maintenance_mode';
}

/** Feature-Flags schalten nur Funktionen ab – sie ersetzen nie Authentifizierung oder Berechtigungsprüfungen. */
export async function assertFeature(db: DbExecutor, key: string): Promise<void> {
  if (!(await isFlagEnabled(db, key))) {
    throw new AppError('FEATURE_DISABLED', `Diese Funktion ist derzeit deaktiviert (${key}).`);
  }
}

export async function assertNotKilled(db: DbExecutor): Promise<void> {
  if (await isFlagEnabled(db, 'kill_switch')) {
    throw new AppError('KILL_SWITCH_ACTIVE', 'Der Notfall-Kill-Switch ist aktiv. Schreibende Aktionen sind gesperrt.');
  }
}

export async function listFlags(db: DbExecutor) {
  return db.select().from(featureFlags).orderBy(featureFlags.key);
}

const FLAG_KEY = /^[a-z][a-z0-9_]{1,48}$/;

export async function setFlag(
  ctx: CoreContext,
  actor: Actor,
  input: { key: string; enabled: boolean; reason: string; description?: string },
) {
  requirePermission(actor, 'feature_flags:edit');
  if (!FLAG_KEY.test(input.key)) throw errors.badRequest('Ungültiger Flag-Name (a–z, 0–9, _).');
  const result = await ctx.db.transaction(async (tx) => {
    const [existing] = await tx.select().from(featureFlags).where(eq(featureFlags.key, input.key));
    if (!existing && !(input.key in KNOWN_FEATURE_FLAGS)) {
      // Neue Flags anzulegen ist eine Konfigurationsänderung.
      requirePermission(actor, 'feature_flags:configure');
    }
    const [row] = await tx
      .insert(featureFlags)
      .values({
        key: input.key,
        enabled: input.enabled,
        description: input.description ?? KNOWN_FEATURE_FLAGS[input.key as keyof typeof KNOWN_FEATURE_FLAGS] ?? '',
        updatedBy: actorId(actor),
      })
      .onConflictDoUpdate({ target: featureFlags.key, set: { enabled: input.enabled, updatedBy: actorId(actor) } })
      .returning();
    await recordConfigVersion(tx, {
      scope: `feature_flag:${input.key}`,
      value: { enabled: input.enabled },
      previous: existing ? { enabled: existing.enabled } : null,
      actorId: actorId(actor),
      reason: input.reason,
    });
    await writeAudit(
      tx,
      actor,
      {
        action: input.key === 'kill_switch' ? (input.enabled ? 'killswitch.activate' : 'killswitch.deactivate') : 'feature_flag.update',
        resourceType: 'feature_flag',
        resourceId: input.key,
        reason: input.reason,
        before: existing ? { enabled: existing.enabled } : null,
        after: { enabled: input.enabled },
      },
      ctx.now(),
    );
    return row!;
  });
  invalidateFlagCache();
  if (input.key === 'kill_switch' || input.key === 'maintenance_mode') {
    ctx.realtime.publish('alerts', 'flag.changed', { key: input.key, enabled: input.enabled });
  }
  return result;
}
