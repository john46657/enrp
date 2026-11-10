import { DEFAULT_ROLES } from '@enrp/permissions';
import { KNOWN_FEATURE_FLAGS } from '@enrp/shared';
import { type Database } from './client';
import { appRoles, environments, factions, featureFlags, rolePermissions } from './schema/index';

/** Grunddaten, die das System zum Start braucht. Bereits vorhandene (ggf. angepasste) Einträge bleiben unverändert. */
export const DEFAULT_FACTIONS = [
  { key: 'polizei', name: 'Polizei', color: '#2563eb', hasDuty: true, isDefault: false, sortOrder: 1 },
  { key: 'feuerwehr', name: 'Feuerwehr', color: '#dc2626', hasDuty: true, isDefault: false, sortOrder: 2 },
  { key: 'rettungsdienst', name: 'Rettungsdienst', color: '#f59e0b', hasDuty: true, isDefault: false, sortOrder: 3 },
  { key: 'zivil', name: 'Zivilisten', color: '#64748b', hasDuty: false, isDefault: true, sortOrder: 4 },
] as const;

const DISABLED_BY_DEFAULT = new Set(['kill_switch', 'maintenance_mode']);

export async function seedDatabase(db: Database): Promise<{ roles: number; factions: number; flags: number }> {
  return db.transaction(async (tx) => {
    let roles = 0;
    for (const role of DEFAULT_ROLES) {
      const [created] = await tx
        .insert(appRoles)
        .values({
          key: role.key,
          name: role.name,
          description: role.description,
          priority: role.priority,
          isSystem: role.key === 'owner',
        })
        .onConflictDoNothing({ target: appRoles.key })
        .returning();
      if (!created) continue;
      roles++;
      if (role.grants.length) {
        await tx
          .insert(rolePermissions)
          .values(role.grants.map((g) => ({ roleId: created.id, permission: g.permission })));
      }
    }

    const createdFactions = await tx
      .insert(factions)
      .values(DEFAULT_FACTIONS.map((f) => ({ ...f })))
      .onConflictDoNothing({ target: factions.key })
      .returning();

    const createdFlags = await tx
      .insert(featureFlags)
      .values(
        Object.entries(KNOWN_FEATURE_FLAGS).map(([key, description]) => ({
          key,
          description,
          enabled: !DISABLED_BY_DEFAULT.has(key),
          updatedBy: 'system',
        })),
      )
      .onConflictDoNothing({ target: featureFlags.key })
      .returning();

    await tx
      .insert(environments)
      .values([
        { key: 'development', name: 'Entwicklung', requiresApproval: false },
        { key: 'staging', name: 'Staging', requiresApproval: false },
        { key: 'production', name: 'Produktion', requiresApproval: true },
      ])
      .onConflictDoNothing({ target: environments.key });

    return { roles, factions: createdFactions.length, flags: createdFlags.length };
  });
}
