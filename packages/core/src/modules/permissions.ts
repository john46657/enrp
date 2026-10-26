import {
  checkGrantChange,
  covers,
  isKnownCommand,
  isPermissionPattern,
  LOCKED_COMMANDS,
  COMMAND_PERMISSIONS,
  resolveCommandAccess,
  isCriticalPattern,
  type Grant,
  type Subject,
} from '@enrp/permissions';
import {
  and,
  appRoles,
  asc,
  commandOverrides,
  eq,
  roleBindings,
  rolePermissions,
  type DbExecutor,
} from '@enrp/database';
import { AppError, errors } from '@enrp/shared';
import { type Actor, actorId, requirePermission, requireUser } from '../actor';
import { loadGrantsForRoles, loadSubject } from '../access';
import { createApproval, registerApprovalExecutor } from '../approvals';
import { writeAudit } from '../audit';
import { type CoreContext, type TxContext } from '../context';
import { recordConfigVersion } from '../settings';

export async function listRoles(db: DbExecutor) {
  const roles = await db.select().from(appRoles).orderBy(asc(appRoles.priority));
  const perms = await db.select().from(rolePermissions);
  const bindings = await db.select().from(roleBindings);
  return roles
    .map((role) => ({
      ...role,
      grants: perms
        .filter((p) => p.roleId === role.id)
        .map((p) => ({ permission: p.permission, factionIds: p.factionIds })),
      bindings: bindings.filter((b) => b.roleId === role.id),
    }))
    .sort((a, b) => b.priority - a.priority);
}

async function getRole(db: DbExecutor, idOrKey: string) {
  const isUuid = /^[0-9a-f-]{36}$/i.test(idOrKey);
  const [role] = await db
    .select()
    .from(appRoles)
    .where(isUuid ? eq(appRoles.id, idOrKey) : eq(appRoles.key, idOrKey));
  if (!role) throw errors.notFound('Rolle');
  return role;
}

function validateGrants(grants: Grant[]): void {
  for (const grant of grants) {
    if (!isPermissionPattern(grant.permission)) throw errors.badRequest(`Unbekannte Berechtigung: ${grant.permission}`);
  }
}

async function applyRoleGrants(ctx: TxContext, actor: Actor, roleId: string, grants: Grant[], reason: string) {
  const previous = await loadGrantsForRoles(ctx.db, [roleId]);
  await ctx.db.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
  if (grants.length) {
    await ctx.db
      .insert(rolePermissions)
      .values(
        grants.map((g) => ({
          roleId,
          permission: g.permission,
          factionIds: g.factionIds?.length ? g.factionIds : null,
        })),
      );
  }
  await recordConfigVersion(ctx.db, {
    scope: `role:${roleId}`,
    value: grants,
    previous,
    actorId: actorId(actor),
    reason,
  });
  await writeAudit(
    ctx.db,
    actor,
    {
      action: 'permissions.role.update',
      resourceType: 'role',
      resourceId: roleId,
      reason,
      before: previous,
      after: grants,
    },
    ctx.now(),
  );
}

/**
 * Setzt die Berechtigungen einer Rolle. Schutz gegen Rechteausweitung über checkGrantChange;
 * kritische Änderungen werden als Freigabeanfrage angelegt statt direkt angewendet.
 */
export async function updateRoleGrants(
  ctx: CoreContext,
  actor: Actor,
  roleIdOrKey: string,
  grants: Grant[],
  reason: string,
) {
  const user = requireUser(actor);
  validateGrants(grants);
  const role = await getRole(ctx.db, roleIdOrKey);
  if (role.key === 'owner' && !user.subject.isOwner)
    throw errors.forbidden('Die Owner-Rolle kann nur von Ownern geändert werden.');
  const previous = await loadGrantsForRoles(ctx.db, [role.id]);
  const check = checkGrantChange(user.subject, grants, previous);
  if (!check.allowed)
    throw new AppError('ESCALATION_DENIED', check.reason ?? 'Nicht erlaubt.', { exceeding: check.exceeding });
  if (check.requiresApproval) {
    const approval = await createApproval(ctx, actor, {
      actionType: 'permissions.role.update',
      summary: `Rechte der Rolle „${role.name}“ ändern`,
      payload: { roleId: role.id, grants },
      reason,
    });
    return { status: 'approval_required' as const, approval };
  }
  await ctx.db.transaction((tx) => applyRoleGrants({ ...ctx, db: tx }, actor, role.id, grants, reason));
  return { status: 'applied' as const };
}

registerApprovalExecutor('permissions.role.update', {
  requiredPermission: 'permissions:approve',
  execute: async (ctx, payload, approval) => {
    const grants = payload.grants as Grant[];
    validateGrants(grants);
    await applyRoleGrants(
      ctx,
      { kind: 'system', name: `approval:${approval.id}` },
      String(payload.roleId),
      grants,
      approval.reason,
    );
    return { applied: grants.length };
  },
});

export async function createRole(
  ctx: CoreContext,
  actor: Actor,
  input: { key: string; name: string; description?: string; priority?: number },
  reason: string,
) {
  requirePermission(actor, 'permissions:configure');
  if (!/^[a-z][a-z0-9_]{1,40}$/.test(input.key)) throw errors.badRequest('Ungültiger Rollenschlüssel.');
  return ctx.db.transaction(async (tx) => {
    const [role] = await tx
      .insert(appRoles)
      .values({ key: input.key, name: input.name, description: input.description ?? '', priority: input.priority ?? 0 })
      .onConflictDoNothing()
      .returning();
    if (!role) throw errors.conflict('Eine Rolle mit diesem Schlüssel existiert bereits.');
    await writeAudit(
      tx,
      actor,
      { action: 'permissions.role.create', resourceType: 'role', resourceId: role.id, reason, after: role },
      ctx.now(),
    );
    return role;
  });
}

/**
 * Verknüpft eine Plattform-Rolle mit einer Discord-Rolle oder einem Nutzer.
 * Wer verknüpft, muss alle Rechte der Rolle selbst besitzen.
 */
export async function bindRole(
  ctx: CoreContext,
  actor: Actor,
  input: { roleId: string; discordRoleId?: string; discordUserId?: string },
  reason: string,
) {
  const user = requireUser(actor);
  requirePermission(actor, 'permissions:edit');
  if (!input.discordRoleId === !input.discordUserId)
    throw errors.badRequest('Genau eine Discord-Rolle oder ein Nutzer angeben.');
  const role = await getRole(ctx.db, input.roleId);
  const grants = await loadGrantsForRoles(ctx.db, [role.id]);
  const exceeding = grants.filter((g) => !covers(user.subject, g));
  if (exceeding.length)
    throw new AppError('ESCALATION_DENIED', 'Diese Rolle hat Rechte, die du selbst nicht besitzt.', { exceeding });
  const critical = grants.some((g) => isCriticalPattern(g.permission));
  if (critical && !user.subject.isOwner) {
    const approval = await createApproval(ctx, actor, {
      actionType: 'permissions.role.bind',
      summary: `Rolle „${role.name}“ ${input.discordRoleId ? `der Discord-Rolle ${input.discordRoleId}` : `dem Nutzer ${input.discordUserId}`} zuweisen`,
      payload: {
        roleId: role.id,
        discordRoleId: input.discordRoleId ?? null,
        discordUserId: input.discordUserId ?? null,
      },
      reason,
    });
    return { status: 'approval_required' as const, approval };
  }
  const binding = await ctx.db.transaction((tx) =>
    applyBinding({ ...ctx, db: tx }, actor, role.id, input.discordRoleId ?? null, input.discordUserId ?? null, reason),
  );
  return { status: 'applied' as const, binding };
}

async function applyBinding(
  ctx: TxContext,
  actor: Actor,
  roleId: string,
  discordRoleId: string | null,
  discordUserId: string | null,
  reason: string,
) {
  const [binding] = await ctx.db
    .insert(roleBindings)
    .values({ roleId, discordRoleId, discordUserId, createdBy: actorId(actor) })
    .onConflictDoNothing()
    .returning();
  if (!binding) throw errors.conflict('Diese Zuweisung existiert bereits.');
  await writeAudit(
    ctx.db,
    actor,
    { action: 'permissions.role.bind', resourceType: 'role', resourceId: roleId, reason, after: binding },
    ctx.now(),
  );
  return binding;
}

registerApprovalExecutor('permissions.role.bind', {
  requiredPermission: 'permissions:approve',
  execute: async (ctx, payload, approval) => {
    const binding = await applyBinding(
      ctx,
      { kind: 'system', name: `approval:${approval.id}` },
      String(payload.roleId),
      (payload.discordRoleId as string | null) ?? null,
      (payload.discordUserId as string | null) ?? null,
      approval.reason,
    );
    return { bindingId: binding.id };
  },
});

export async function unbindRole(ctx: CoreContext, actor: Actor, bindingId: string, reason: string) {
  requirePermission(actor, 'permissions:edit');
  return ctx.db.transaction(async (tx) => {
    const [binding] = await tx.delete(roleBindings).where(eq(roleBindings.id, bindingId)).returning();
    if (!binding) throw errors.notFound('Zuweisung');
    await writeAudit(
      tx,
      actor,
      { action: 'permissions.role.unbind', resourceType: 'role', resourceId: binding.roleId, reason, before: binding },
      ctx.now(),
    );
    return binding;
  });
}

// ---------------------------------------------------------------------------
// Befehlsrechte (/permissions view|grant|revoke|test|reset)
// ---------------------------------------------------------------------------

export async function listCommandOverrides(db: DbExecutor, command?: string) {
  return db
    .select()
    .from(commandOverrides)
    .where(command ? eq(commandOverrides.command, command) : undefined)
    .orderBy(asc(commandOverrides.command));
}

export async function describeCommand(db: DbExecutor, command: string) {
  if (!isKnownCommand(command) && !Object.keys(COMMAND_PERMISSIONS).some((c) => c.startsWith(`${command} `))) {
    throw errors.notFound('Befehl');
  }
  const overrides = await db.select().from(commandOverrides).where(eq(commandOverrides.command, command));
  return {
    command,
    defaultPermission: COMMAND_PERMISSIONS[command] ?? null,
    locked: LOCKED_COMMANDS.has(command),
    subcommands: Object.entries(COMMAND_PERMISSIONS)
      .filter(([c]) => c.startsWith(`${command} `))
      .map(([c, permission]) => ({ command: c, permission, locked: LOCKED_COMMANDS.has(c) })),
    overrides,
  };
}

function assertCommandName(command: string): void {
  const known = isKnownCommand(command) || Object.keys(COMMAND_PERMISSIONS).some((c) => c.startsWith(`${command} `));
  if (!known) throw errors.badRequest(`Unbekannter Befehl: ${command}`);
}

/**
 * Setzt einen Override. Wer Rechte gewährt, muss den Befehl selbst ausführen dürfen;
 * gesperrte Befehle (z. B. /permissions grant, /deploy approve) lassen sich nicht öffnen.
 */
export async function setCommandOverride(
  ctx: CoreContext,
  actor: Actor,
  input: { command: string; discordRoleId: string; effect: 'allow' | 'deny' },
  reason: string,
) {
  const user = requireUser(actor);
  requirePermission(actor, 'permissions:edit');
  assertCommandName(input.command);
  const affected = isKnownCommand(input.command)
    ? [input.command]
    : Object.keys(COMMAND_PERMISSIONS).filter((c) => c.startsWith(`${input.command} `));
  if (input.effect === 'allow') {
    const locked = affected.filter((c) => LOCKED_COMMANDS.has(c));
    if (locked.length && affected.length === locked.length) {
      throw new AppError('ESCALATION_DENIED', 'Dieser Befehl kann nicht per Override freigegeben werden.', { locked });
    }
    for (const c of affected) {
      const permission = COMMAND_PERMISSIONS[c];
      if (permission && !covers(user.subject, { permission })) {
        throw new AppError('ESCALATION_DENIED', `Du kannst /${c} nicht freigeben, weil dir „${permission}“ fehlt.`);
      }
    }
  }
  return ctx.db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(commandOverrides)
      .where(and(eq(commandOverrides.command, input.command), eq(commandOverrides.discordRoleId, input.discordRoleId)));
    const [row] = await tx
      .insert(commandOverrides)
      .values({ ...input, createdBy: user.discordUserId, reason })
      .onConflictDoUpdate({
        target: [commandOverrides.command, commandOverrides.discordRoleId],
        set: { effect: input.effect, createdBy: user.discordUserId, reason, createdAt: ctx.now() },
      })
      .returning();
    await recordConfigVersion(tx, {
      scope: `command:${input.command}`,
      value: row,
      previous: before ?? null,
      actorId: user.discordUserId,
      reason,
    });
    await writeAudit(
      tx,
      actor,
      {
        action: `permissions.command.${input.effect}`,
        resourceType: 'command',
        resourceId: input.command,
        reason,
        before: before ?? null,
        after: row,
      },
      ctx.now(),
    );
    return row!;
  });
}

export async function removeCommandOverride(
  ctx: CoreContext,
  actor: Actor,
  input: { command: string; discordRoleId?: string },
  reason: string,
) {
  requirePermission(actor, 'permissions:edit');
  assertCommandName(input.command);
  return ctx.db.transaction(async (tx) => {
    const removed = await tx
      .delete(commandOverrides)
      .where(
        input.discordRoleId
          ? and(eq(commandOverrides.command, input.command), eq(commandOverrides.discordRoleId, input.discordRoleId))
          : eq(commandOverrides.command, input.command),
      )
      .returning();
    await recordConfigVersion(tx, {
      scope: `command:${input.command}`,
      value: null,
      previous: removed,
      actorId: actorId(actor),
      reason,
    });
    await writeAudit(
      tx,
      actor,
      {
        action: input.discordRoleId ? 'permissions.command.remove' : 'permissions.command.reset',
        resourceType: 'command',
        resourceId: input.command,
        reason,
        before: removed,
      },
      ctx.now(),
    );
    return { removed: removed.length };
  });
}

/** Ergebnis von /permissions test bzw. Vorabprüfung des Bots vor jeder Befehlsausführung. */
export async function checkCommandAccess(
  db: DbExecutor,
  ownerIds: string[],
  input: { command: string; discordUserId: string; roleIds: string[]; subject?: Subject },
) {
  const subject =
    input.subject ?? (await loadSubject(db, { ownerDiscordIds: ownerIds }, input.discordUserId, input.roleIds));
  const overrides = await db.select().from(commandOverrides);
  return resolveCommandAccess(input.command, subject, input.roleIds, overrides);
}
