import { mergeGrants, type Grant, type Subject } from '@enrp/permissions';
import { and, appRoles, eq, inArray, isNull, or, roleBindings, rolePermissions, type DbExecutor } from '@enrp/database';
import { type UserActor } from './actor';
import { type CoreConfig } from './context';

export interface ResolvedRole {
  id: string;
  key: string;
  name: string;
}

/**
 * Ermittelt die Plattform-Rollen einer Person über Discord-Rollen und direkte Zuweisungen. Zuweisungen mit
 * Discord-Server gelten nur, wenn die Aktion aus genau diesem Discord kommt (Rechte je Discord getrennt).
 */
export async function resolveRoles(
  db: DbExecutor,
  discordUserId: string,
  discordRoleIds: readonly string[],
  guildId?: string | null,
): Promise<ResolvedRole[]> {
  const target = discordRoleIds.length
    ? or(eq(roleBindings.discordUserId, discordUserId), inArray(roleBindings.discordRoleId, [...discordRoleIds]))
    : eq(roleBindings.discordUserId, discordUserId);
  const scope = guildId
    ? or(isNull(roleBindings.guildId), eq(roleBindings.guildId, guildId))
    : isNull(roleBindings.guildId);
  const condition = and(target, scope);
  const rows = await db
    .selectDistinct({ id: appRoles.id, key: appRoles.key, name: appRoles.name })
    .from(roleBindings)
    .innerJoin(appRoles, eq(appRoles.id, roleBindings.roleId))
    .where(condition);
  return rows;
}

export async function loadGrantsForRoles(db: DbExecutor, roleIds: string[]): Promise<Grant[]> {
  if (!roleIds.length) return [];
  const rows = await db
    .select({ permission: rolePermissions.permission, factionIds: rolePermissions.factionIds })
    .from(rolePermissions)
    .where(inArray(rolePermissions.roleId, roleIds));
  return mergeGrants(rows.map((r) => ({ permission: r.permission, factionIds: r.factionIds })));
}

export async function loadSubject(
  db: DbExecutor,
  config: Pick<CoreConfig, 'ownerDiscordIds'>,
  discordUserId: string,
  discordRoleIds: readonly string[],
  guildId?: string | null,
): Promise<Subject & { roles: ResolvedRole[] }> {
  const roles = await resolveRoles(db, discordUserId, discordRoleIds, guildId);
  const grants = await loadGrantsForRoles(
    db,
    roles.map((r) => r.id),
  );
  return { isOwner: config.ownerDiscordIds.includes(discordUserId), grants, roles };
}

export async function buildUserActor(
  db: DbExecutor,
  config: Pick<CoreConfig, 'ownerDiscordIds'>,
  input: {
    discordUserId: string;
    roleIds: string[];
    via: 'dashboard' | 'bot' | 'game';
    sessionId?: string;
    guildId?: string;
  },
): Promise<UserActor> {
  const subject = await loadSubject(db, config, input.discordUserId, input.roleIds, input.guildId);
  return {
    kind: 'user',
    discordUserId: input.discordUserId,
    roleIds: input.roleIds,
    via: input.via,
    sessionId: input.sessionId,
    ...(input.guildId ? { guildId: input.guildId } : {}),
    subject,
  };
}
