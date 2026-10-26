import { mergeGrants, type Grant, type Subject } from '@enrp/permissions';
import { appRoles, eq, inArray, or, roleBindings, rolePermissions, type DbExecutor } from '@enrp/database';
import { type UserActor } from './actor';
import { type CoreConfig } from './context';

export interface ResolvedRole {
  id: string;
  key: string;
  name: string;
}

/** Ermittelt die Plattform-Rollen einer Person über Discord-Rollen und direkte Zuweisungen. */
export async function resolveRoles(db: DbExecutor, discordUserId: string, discordRoleIds: readonly string[]): Promise<ResolvedRole[]> {
  const condition = discordRoleIds.length
    ? or(eq(roleBindings.discordUserId, discordUserId), inArray(roleBindings.discordRoleId, [...discordRoleIds]))
    : eq(roleBindings.discordUserId, discordUserId);
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
): Promise<Subject & { roles: ResolvedRole[] }> {
  const roles = await resolveRoles(db, discordUserId, discordRoleIds);
  const grants = await loadGrantsForRoles(
    db,
    roles.map((r) => r.id),
  );
  return { isOwner: config.ownerDiscordIds.includes(discordUserId), grants, roles };
}

export async function buildUserActor(
  db: DbExecutor,
  config: Pick<CoreConfig, 'ownerDiscordIds'>,
  input: { discordUserId: string; roleIds: string[]; via: 'dashboard' | 'bot'; sessionId?: string },
): Promise<UserActor> {
  const subject = await loadSubject(db, config, input.discordUserId, input.roleIds);
  return { kind: 'user', discordUserId: input.discordUserId, roleIds: input.roleIds, via: input.via, sessionId: input.sessionId, subject };
}
