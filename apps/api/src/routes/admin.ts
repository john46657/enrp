import {
  OWNER_ROLE,
  PERMISSIONS,
  PERMISSION_KEYS,
  auditLogResponseSchema,
  createUserRequestSchema,
  isPermission,
  rolesResponseSchema,
  updateRolePermissionsRequestSchema,
  updateUserRequestSchema,
  userResponseSchema,
  usersResponseSchema,
} from '@emden/shared';
import { and, asc, desc, eq, inArray, lt } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { auditActionLabel, writeAudit, type AuditAction } from '../audit.js';
import { requirePermission } from '../auth/guards.js';
import {
  assertCanAssignRole,
  assertCanEditRole,
  assertCanManageUser,
  canAssignRole,
  canEditRole,
} from '../auth/policy.js';
import { deleteUserSessions, type AuthenticatedUser } from '../auth/sessions.js';
import type { Database } from '../db/database.js';
import { auditLog, rolePermissions, roles, users } from '../db/schema.js';
import { HttpError, parseInput } from '../errors.js';
import { responseSchema } from './schema.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

const userColumns = {
  id: users.id,
  discordUserId: users.discordUserId,
  displayName: users.displayName,
  status: users.status,
  createdAt: users.createdAt,
  lastLoginAt: users.lastLoginAt,
  roleKey: roles.key,
  roleName: roles.name,
  roleRank: roles.rank,
};

type UserRow = {
  id: string;
  discordUserId: string;
  displayName: string;
  status: 'active' | 'disabled';
  createdAt: Date;
  lastLoginAt: Date | null;
  roleKey: string;
  roleName: string;
  roleRank: number;
};

function toManagedUser(row: UserRow) {
  return {
    id: row.id,
    discordUserId: row.discordUserId,
    displayName: row.displayName,
    status: row.status,
    createdAt: row.createdAt,
    lastLoginAt: row.lastLoginAt,
    role: { key: row.roleKey, name: row.roleName, rank: row.roleRank },
  };
}

const userIdParams = z.object({ id: z.uuid('Ungültige Benutzer-ID.') });
const roleKeyParams = z.object({ key: z.string().regex(/^[a-z][a-z0-9_]{1,31}$/, 'Ungültiger Rollenname.') });
const auditQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.coerce.number().int().positive().optional(),
});

/** PostgreSQL-Fehlercode, auch wenn Drizzle den Originalfehler einpackt. */
function pgErrorCode(err: unknown): string | undefined {
  for (
    let current = err;
    current && typeof current === 'object';
    current = (current as { cause?: unknown }).cause
  ) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return undefined;
}

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  const db = app.db.db;

  const actorOf = (user: AuthenticatedUser) => ({
    type: 'user' as const,
    userId: user.id,
    label: user.displayName,
  });
  const currentUser = (request: FastifyRequest): AuthenticatedUser => {
    if (!request.auth) throw new HttpError(401, 'UNAUTHENTICATED', 'Bitte zuerst anmelden.');
    return request.auth.user;
  };

  /**
   * Führt eine verändernde Aktion in einer Transaktion aus. Wird sie wegen fehlender Befugnis abgelehnt (403),
   * ist die Transaktion bereits zurückgenommen – der abgelehnte Versuch wird danach im Audit-Log festgehalten.
   */
  async function mutate<T>(
    request: FastifyRequest,
    audit: { action: AuditAction; target: { type: string; id: string } },
    work: (tx: Tx, actor: AuthenticatedUser) => Promise<T>,
  ): Promise<T> {
    const actor = currentUser(request);
    try {
      return await db.transaction((tx) => work(tx, actor));
    } catch (err) {
      if (err instanceof HttpError && err.statusCode === 403) {
        await writeAudit(db, {
          actor: actorOf(actor),
          action: audit.action,
          outcome: 'denied',
          target: audit.target,
          details: { reason: err.code },
          requestId: request.id,
        });
      }
      throw err;
    }
  }

  async function findRole(tx: Tx, key: string) {
    const [role] = await tx.select().from(roles).where(eq(roles.key, key)).limit(1);
    if (!role) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Die Anfrage enthält ungültige Daten.', [
        { path: 'roleKey', message: 'Diese Rolle gibt es nicht.' },
      ]);
    }
    return role;
  }

  async function loadUser(id: string) {
    const [row] = await db
      .select(userColumns)
      .from(users)
      .innerJoin(roles, eq(roles.key, users.roleKey))
      .where(eq(users.id, id))
      .limit(1);
    if (!row) throw new HttpError(404, 'NOT_FOUND', 'Diesen Benutzer gibt es nicht.');
    return toManagedUser(row);
  }

  // ------------------------------------------------------------------------------------------------
  // Benutzer
  // ------------------------------------------------------------------------------------------------

  app.get(
    '/users',
    {
      preHandler: requirePermission('users.read'),
      schema: { response: { 200: responseSchema(usersResponseSchema) } },
    },
    async () => {
      const rows = await db
        .select(userColumns)
        .from(users)
        .innerJoin(roles, eq(roles.key, users.roleKey))
        .orderBy(desc(roles.rank), asc(users.displayName));
      return { users: rows.map(toManagedUser) };
    },
  );

  app.post(
    '/users',
    {
      preHandler: requirePermission('users.manage'),
      schema: { response: { 201: responseSchema(userResponseSchema) } },
    },
    async (request, reply) => {
      const input = parseInput(createUserRequestSchema, request.body);
      let createdId: string;
      try {
        createdId = await mutate(
          request,
          { action: 'user.create', target: { type: 'discord_user', id: input.discordUserId } },
          async (tx, actor) => {
            const role = await findRole(tx, input.roleKey);
            assertCanAssignRole(actor, role);
            const [row] = await tx
              .insert(users)
              .values({
                discordUserId: input.discordUserId,
                displayName: input.displayName,
                roleKey: role.key,
                createdBy: actor.id,
              })
              .returning({ id: users.id });
            const id = (row as { id: string }).id;
            await writeAudit(tx, {
              actor: actorOf(actor),
              action: 'user.create',
              outcome: 'success',
              target: { type: 'user', id },
              details: { discordUserId: input.discordUserId, role: role.key },
              requestId: request.id,
            });
            return id;
          },
        );
      } catch (err) {
        if (pgErrorCode(err) === '23505') {
          throw new HttpError(409, 'CONFLICT', 'Diese Discord-ID ist bereits freigeschaltet.');
        }
        throw err;
      }
      return reply.status(201).send({ user: await loadUser(createdId) });
    },
  );

  app.patch(
    '/users/:id',
    {
      preHandler: requirePermission('users.manage'),
      schema: { response: { 200: responseSchema(userResponseSchema) } },
    },
    async (request) => {
      const { id } = parseInput(userIdParams, request.params);
      const input = parseInput(updateUserRequestSchema, request.body);
      await mutate(request, { action: 'user.update', target: { type: 'user', id } }, async (tx, actor) => {
        const [target] = await tx
          .select(userColumns)
          .from(users)
          .innerJoin(roles, eq(roles.key, users.roleKey))
          .where(eq(users.id, id))
          .for('update', { of: users })
          .limit(1);
        if (!target) throw new HttpError(404, 'NOT_FOUND', 'Diesen Benutzer gibt es nicht.');
        assertCanManageUser(actor, { id: target.id, roleRank: target.roleRank });

        const changes: Record<string, string> = {};
        const update: Partial<{ roleKey: string; status: 'active' | 'disabled'; displayName: string }> = {};
        if (input.roleKey !== undefined && input.roleKey !== target.roleKey) {
          const role = await findRole(tx, input.roleKey);
          assertCanAssignRole(actor, role);
          update.roleKey = role.key;
          Object.assign(changes, { roleFrom: target.roleKey, roleTo: role.key });
        }
        if (input.status !== undefined && input.status !== target.status) {
          update.status = input.status;
          Object.assign(changes, { statusFrom: target.status, statusTo: input.status });
        }
        if (input.displayName !== undefined && input.displayName !== target.displayName) {
          update.displayName = input.displayName;
          changes.displayName = input.displayName;
        }
        if (Object.keys(update).length === 0) return;

        await tx.update(users).set(update).where(eq(users.id, id));
        // Gesperrte Benutzer werden sofort abgemeldet.
        if (update.status === 'disabled') await deleteUserSessions(tx, id);
        await writeAudit(tx, {
          actor: actorOf(actor),
          action: 'user.update',
          outcome: 'success',
          target: { type: 'user', id },
          details: changes,
          requestId: request.id,
        });
      });
      return { user: await loadUser(id) };
    },
  );

  // ------------------------------------------------------------------------------------------------
  // Rollen und Berechtigungen
  // ------------------------------------------------------------------------------------------------

  async function rolesPayload(actor: AuthenticatedUser) {
    const [roleRows, mapping] = await Promise.all([
      db.select().from(roles).orderBy(desc(roles.rank)),
      db.select().from(rolePermissions),
    ]);
    return {
      roles: roleRows.map((role) => ({
        key: role.key,
        name: role.name,
        description: role.description,
        rank: role.rank,
        permissions:
          role.key === OWNER_ROLE
            ? [...PERMISSION_KEYS].sort()
            : mapping
                .filter((m) => m.roleKey === role.key)
                .map((m) => m.permissionKey)
                .sort(),
        editable: canEditRole(actor, role),
        assignable: canAssignRole(actor, role),
      })),
      permissions: PERMISSION_KEYS.map((key) => ({ key, ...PERMISSIONS[key] })),
    };
  }

  app.get(
    '/roles',
    {
      preHandler: requirePermission('roles.read'),
      schema: { response: { 200: responseSchema(rolesResponseSchema) } },
    },
    async (request) => rolesPayload(currentUser(request)),
  );

  app.put(
    '/roles/:key/permissions',
    {
      preHandler: requirePermission('roles.manage'),
      schema: { response: { 200: responseSchema(rolesResponseSchema) } },
    },
    async (request) => {
      const { key } = parseInput(roleKeyParams, request.params);
      const input = parseInput(updateRolePermissionsRequestSchema, request.body);
      const unknown = input.permissions.filter((permission) => !isPermission(permission));
      if (unknown.length > 0) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'Die Anfrage enthält ungültige Daten.', [
          { path: 'permissions', message: `Unbekannte Berechtigung(en): ${unknown.slice(0, 5).join(', ')}` },
        ]);
      }
      const wanted = [...new Set(input.permissions)].sort();

      await mutate(
        request,
        { action: 'role.permissions_update', target: { type: 'role', id: key } },
        async (tx, actor) => {
          const [role] = await tx.select().from(roles).where(eq(roles.key, key)).for('update').limit(1);
          if (!role) throw new HttpError(404, 'NOT_FOUND', 'Diese Rolle gibt es nicht.');
          const current = (
            await tx.select().from(rolePermissions).where(eq(rolePermissions.roleKey, key))
          ).map((row) => row.permissionKey);
          const added = wanted.filter((permission) => !current.includes(permission));
          const removed = current.filter((permission) => !wanted.includes(permission));
          assertCanEditRole(actor, role, [...added, ...removed]);
          if (added.length + removed.length === 0) return;

          if (removed.length > 0) {
            await tx
              .delete(rolePermissions)
              .where(and(eq(rolePermissions.roleKey, key), inArray(rolePermissions.permissionKey, removed)));
          }
          if (added.length > 0) {
            await tx
              .insert(rolePermissions)
              .values(added.map((permissionKey) => ({ roleKey: key, permissionKey })));
          }
          await writeAudit(tx, {
            actor: actorOf(actor),
            action: 'role.permissions_update',
            outcome: 'success',
            target: { type: 'role', id: key },
            details: { added: added.join(', '), removed: removed.join(', ') },
            requestId: request.id,
          });
        },
      );
      return rolesPayload(currentUser(request));
    },
  );

  // ------------------------------------------------------------------------------------------------
  // Audit-Log (nur lesen)
  // ------------------------------------------------------------------------------------------------

  app.get(
    '/audit-log',
    {
      preHandler: requirePermission('audit.read'),
      schema: { response: { 200: responseSchema(auditLogResponseSchema) } },
    },
    async (request) => {
      const { limit, before } = parseInput(auditQuery, request.query);
      const rows = await db
        .select()
        .from(auditLog)
        .where(before === undefined ? undefined : lt(auditLog.id, before))
        .orderBy(desc(auditLog.id))
        .limit(limit + 1);
      const page = rows.slice(0, limit);
      return {
        entries: page.map((row) => ({
          id: row.id,
          occurredAt: row.occurredAt,
          actorType: row.actorType,
          actorLabel: row.actorLabel,
          action: row.action,
          actionLabel: auditActionLabel(row.action),
          outcome: row.outcome,
          targetType: row.targetType,
          targetId: row.targetId,
          details: row.details as Record<string, string | number | boolean | null>,
        })),
        nextBefore: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
      };
    },
  );
}
