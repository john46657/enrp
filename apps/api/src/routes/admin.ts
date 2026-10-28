import { type FastifyInstance } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ACTION_LABELS,
  ALL_PERMISSIONS,
  COMMAND_PERMISSIONS,
  LOCKED_COMMANDS,
  RESOURCES,
  isCriticalPattern,
} from '@enrp/permissions';
import {
  getConfigVersion,
  getSetting,
  isSettingKey,
  listConfigVersions,
  listFlags,
  loadSubject,
  permissionsAdmin,
  requirePermission,
  setFlag,
  SETTING_DEFINITIONS,
  updateSetting,
} from '@enrp/core';
import { errors } from '@enrp/shared';
import { memberRoles } from '../plugins/auth';
import { idParam, reason, snowflake } from './schemas';

const grantSchema = z.object({
  permission: z.string().max(60),
  factionIds: z.array(z.uuid()).max(10).nullable().optional(),
});

export async function adminRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const { core } = app.deps;
  const ptags = ['Berechtigungen'];

  app.get(
    '/permissions/catalog',
    { schema: { tags: ptags, summary: 'Berechtigungskatalog und Befehlsrechte' } },
    async (request) => {
      requirePermission(request.actor, 'permissions:view');
      return {
        actions: ACTION_LABELS,
        resources: RESOURCES,
        permissions: ALL_PERMISSIONS.map((p) => ({ key: p, critical: isCriticalPattern(p) })),
        commands: Object.entries(COMMAND_PERMISSIONS).map(([command, permission]) => ({
          command,
          permission,
          locked: LOCKED_COMMANDS.has(command),
        })),
      };
    },
  );
  app.get(
    '/permissions/roles',
    { schema: { tags: ptags, summary: 'Rollen mit Rechten und Zuweisungen' } },
    async (request) => {
      requirePermission(request.actor, 'permissions:view');
      return { items: await permissionsAdmin.listRoles(core.db) };
    },
  );
  app.post(
    '/permissions/roles',
    {
      schema: {
        tags: ptags,
        summary: 'Rolle anlegen',
        body: z.object({
          key: z.string().max(40),
          name: z.string().min(2).max(60),
          description: z.string().max(300).optional(),
          priority: z.number().int().min(0).max(999).optional(),
          reason,
        }),
      },
    },
    async (request) => {
      const { reason: r, ...input } = request.body;
      return permissionsAdmin.createRole(core, request.actor, input, r);
    },
  );
  app.put(
    '/permissions/roles/:id/grants',
    {
      schema: {
        tags: ptags,
        summary: 'Rechte einer Rolle setzen (ggf. Freigabe erforderlich)',
        params: idParam,
        body: z.object({ grants: z.array(grantSchema).max(200), reason }),
      },
      config: { idempotent: true },
    },
    async (request) =>
      permissionsAdmin.updateRoleGrants(
        core,
        request.actor,
        request.params.id,
        request.body.grants,
        request.body.reason,
      ),
  );
  app.post(
    '/permissions/bindings',
    {
      schema: {
        tags: ptags,
        summary: 'Rolle einer Discord-Rolle oder Person zuweisen',
        body: z.object({
          roleId: z.string().max(64),
          discordRoleId: snowflake.optional(),
          discordUserId: snowflake.optional(),
          reason,
        }),
      },
      config: { idempotent: true },
    },
    async (request) => {
      const { reason: r, ...input } = request.body;
      return permissionsAdmin.bindRole(core, request.actor, input, r);
    },
  );
  app.post(
    '/permissions/bindings/:id/remove',
    { schema: { tags: ptags, summary: 'Zuweisung entfernen', params: idParam, body: z.object({ reason }) } },
    async (request) => permissionsAdmin.unbindRole(core, request.actor, request.params.id, request.body.reason),
  );
  app.get(
    '/permissions/commands',
    {
      schema: {
        tags: ptags,
        summary: 'Befehls-Overrides',
        querystring: z.object({ command: z.string().max(60).optional() }),
      },
    },
    async (request) => {
      requirePermission(request.actor, 'permissions:view');
      if (request.query.command) return permissionsAdmin.describeCommand(core.db, request.query.command);
      return { items: await permissionsAdmin.listCommandOverrides(core.db) };
    },
  );
  app.post(
    '/permissions/commands/override',
    {
      schema: {
        tags: ptags,
        summary: '/permissions grant|revoke',
        body: z.object({
          command: z.string().max(60),
          discordRoleId: snowflake,
          effect: z.enum(['allow', 'deny']),
          reason,
        }),
      },
      config: { idempotent: true },
    },
    async (request) => {
      const { reason: r, ...input } = request.body;
      return permissionsAdmin.setCommandOverride(core, request.actor, input, r);
    },
  );
  app.post(
    '/permissions/commands/reset',
    {
      schema: {
        tags: ptags,
        summary: '/permissions reset – Overrides entfernen',
        body: z.object({ command: z.string().max(60), discordRoleId: snowflake.optional(), reason }),
      },
    },
    async (request) =>
      permissionsAdmin.removeCommandOverride(
        core,
        request.actor,
        { command: request.body.command, discordRoleId: request.body.discordRoleId },
        request.body.reason,
      ),
  );
  // Vorabprüfung des Bots vor jeder Befehlsausführung (für die handelnde Person).
  app.post(
    '/permissions/check',
    {
      schema: {
        tags: ptags,
        summary: 'Befehlszugriff der handelnden Person prüfen',
        body: z.object({ command: z.string().max(60) }),
      },
    },
    async (request) => {
      const actor = request.actor;
      if (actor.kind !== 'user') throw errors.unauthenticated();
      return permissionsAdmin.checkCommandAccess(core.db, core.config.ownerDiscordIds, {
        command: request.body.command,
        discordUserId: actor.discordUserId,
        roleIds: actor.roleIds,
        subject: actor.subject,
      });
    },
  );
  app.post(
    '/permissions/test',
    {
      schema: {
        tags: ptags,
        summary: '/permissions test – Zugriff einer anderen Person prüfen',
        body: z.object({
          discordUserId: snowflake,
          roleIds: z.array(snowflake).max(250).optional(),
          command: z.string().max(60),
        }),
      },
    },
    async (request) => {
      requirePermission(request.actor, 'permissions:view');
      const roleIds = request.body.roleIds ?? (await memberRoles(app, request.body.discordUserId)).roleIds;
      const subject = await loadSubject(core.db, core.config, request.body.discordUserId, roleIds);
      const access = await permissionsAdmin.checkCommandAccess(core.db, core.config.ownerDiscordIds, {
        command: request.body.command,
        discordUserId: request.body.discordUserId,
        roleIds,
        subject,
      });
      return { ...access, roles: subject.roles.map((r) => r.name) };
    },
  );

  // Einstellungen & Konfigurationshistorie
  const stags = ['Konfiguration'];
  app.get('/settings', { schema: { tags: stags, summary: 'Alle Einstellungen' } }, async (request) => {
    requirePermission(request.actor, 'settings:view');
    const items = await Promise.all(
      Object.entries(SETTING_DEFINITIONS).map(async ([key, def]) => ({
        key,
        label: def.label,
        critical: def.critical,
        value: await getSetting(core.db, key as keyof typeof SETTING_DEFINITIONS),
      })),
    );
    return { items };
  });
  app.put(
    '/settings/:key',
    {
      schema: {
        tags: stags,
        summary: 'Einstellung ändern',
        params: z.object({ key: z.string().max(40) }),
        body: z.object({ value: z.unknown(), reason }),
      },
      config: { idempotent: true },
    },
    async (request) => {
      if (!isSettingKey(request.params.key)) throw errors.notFound('Einstellung');
      return updateSetting(core, request.actor, request.params.key, request.body.value, request.body.reason);
    },
  );
  app.get(
    '/config/history',
    {
      schema: {
        tags: stags,
        summary: 'Konfigurationshistorie',
        querystring: z.object({
          scope: z.string().max(100).optional(),
          limit: z.coerce.number().int().min(1).max(200).default(50),
        }),
      },
    },
    async (request) => {
      requirePermission(request.actor, 'settings:view');
      return { items: await listConfigVersions(core.db, request.query.scope, request.query.limit) };
    },
  );
  app.get(
    '/config/history/:scope/:version',
    {
      schema: {
        tags: stags,
        summary: 'Einzelne Version',
        params: z.object({ scope: z.string().max(100), version: z.coerce.number().int().min(1) }),
      },
    },
    async (request) => {
      requirePermission(request.actor, 'settings:view');
      const row = await getConfigVersion(core.db, request.params.scope, request.params.version);
      if (!row) throw errors.notFound('Version');
      return row;
    },
  );

  // Feature-Flags & Kill-Switch
  const ftags = ['Feature-Flags'];
  app.get('/flags', { schema: { tags: ftags, summary: 'Feature-Flags' } }, async (request) => {
    requirePermission(request.actor, 'feature_flags:view');
    return { items: await listFlags(core.db) };
  });
  app.put(
    '/flags/:key',
    {
      schema: {
        tags: ftags,
        summary: 'Flag setzen (auch kill_switch, maintenance_mode)',
        params: z.object({ key: z.string().max(50) }),
        body: z.object({ enabled: z.boolean(), description: z.string().max(300).optional(), reason }),
      },
      config: { idempotent: true },
    },
    async (request) => setFlag(core, request.actor, { key: request.params.key, ...request.body }),
  );
  app.get(
    '/flags/:key/history',
    { schema: { tags: ftags, summary: 'Änderungshistorie', params: z.object({ key: z.string().max(50) }) } },
    async (request) => {
      requirePermission(request.actor, 'feature_flags:view');
      return { items: await listConfigVersions(core.db, `feature_flag:${request.params.key}`, 50) };
    },
  );
}
