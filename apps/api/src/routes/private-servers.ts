import { type FastifyInstance } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { privateServers } from '@enrp/core';
import { reason, robloxUserId } from './schemas';

/**
 * Privatserver-Discords: Verwaltung (Haupt-Discord/Dashboard), Abgleich durch den Bot und die Befehle des
 * Privatserver-Teams (/ps). Die /ps-Routen prüfen statt Plattform-Rechten den Discord, aus dem die Person handelt.
 */
export async function privateServerRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const { core } = app.deps;
  const tags = ['Privatserver'];
  const linkParam = z.object({ id: z.uuid() });

  app.get(
    '/private-servers',
    {
      schema: {
        tags,
        summary: 'Verknüpfte Privatserver-Discords',
        querystring: z.object({ all: z.coerce.boolean().default(false) }),
      },
    },
    async (request) => privateServers.listLinks(core, request.actor, request.query.all),
  );
  app.post(
    '/private-servers',
    {
      schema: {
        tags,
        summary: 'Discord-Server mit dem Roblox-Besitzer von Privatservern verknüpfen',
        body: z.object({ link: privateServers.linkSchema, reason }),
      },
    },
    async (request) => privateServers.linkGuild(core, request.actor, request.body.link, request.body.reason),
  );
  app.get(
    '/private-servers/:id',
    { schema: { tags, summary: 'Verknüpfung mit Rollen, Spielrechten und laufenden Servern', params: linkParam } },
    async (request) => privateServers.getLinkDetail(core, request.actor, request.params.id),
  );
  app.post(
    '/private-servers/:id/unlink',
    {
      schema: {
        tags,
        summary: 'Verknüpfung entfernen (alle Spielrechte dieses Discords entfallen)',
        params: linkParam,
        body: z.object({ reason }),
      },
    },
    async (request) => privateServers.unlinkGuild(core, request.actor, request.params.id, request.body.reason),
  );

  // Bot (Service-Token ohne handelnde Person)
  app.get(
    '/private-servers/bot/links',
    { schema: { tags, summary: 'Aktive Verknüpfungen mit Rollen (nur Bot)' } },
    async (request) => privateServers.botLinks(core.db, request.actor),
  );
  app.post(
    '/private-servers/:id/sync',
    {
      schema: {
        tags,
        summary: 'Rollenabgleich → Spielrechte (nur Bot)',
        params: linkParam,
        body: privateServers.syncSchema,
      },
      bodyLimit: 4 * 1024 * 1024,
    },
    async (request) => privateServers.syncGrants(core, request.actor, request.params.id, request.body),
  );

  // Privatserver-Discord (/ps): handelnde Person + X-Actor-Guild
  const ptags = ['Privatserver-Discord'];
  app.get(
    '/private-servers/guild/status',
    { schema: { tags: ptags, summary: 'Eigene Privatserver mit Spielern, Teamsperre und Rechte-Rollen' } },
    async (request) => privateServers.guildStatus(core, request.actor),
  );
  app.patch(
    '/private-servers/guild/settings',
    {
      schema: {
        tags: ptags,
        summary: 'Teamsperre, Team-Rolle, Log-Kanal (Server verwalten)',
        body: privateServers.guildSettingsSchema,
      },
    },
    async (request) => privateServers.updateGuildSettings(core, request.actor, request.body),
  );
  app.put(
    '/private-servers/guild/rights/:right',
    {
      schema: {
        tags: ptags,
        summary: 'Discord-Rolle für ein Spielrecht setzen oder entfernen (Server verwalten)',
        params: z.object({ right: z.string().regex(/^[a-z0-9_]{2,30}$/) }),
        body: z.object({
          roleId: z
            .string()
            .regex(/^\d{15,22}$/)
            .nullable(),
        }),
      },
    },
    async (request) => privateServers.setRightRole(core, request.actor, request.params.right, request.body.roleId),
  );
  app.get(
    '/private-servers/guild/grants',
    { schema: { tags: ptags, summary: 'Vergebene Spielrechte' } },
    async (request) => privateServers.guildGrants(core, request.actor),
  );
  app.post(
    '/private-servers/guild/players/:robloxUserId/actions',
    {
      schema: {
        tags: ptags,
        summary: 'Aktion an einem Spieler auf einem eigenen Privatserver (nie am Besitzer)',
        params: z.object({ robloxUserId }),
        body: z.object({ command: privateServers.guildActionSchema, reason }),
      },
    },
    async (request) => {
      const result = await privateServers.guildAction(
        core,
        request.actor,
        request.params.robloxUserId,
        request.body.command,
        request.body.reason,
      );
      app.deps.robloxMessaging
        ?.publish('ENRP_Commands', JSON.stringify({ serverIds: [result.server.id] }))
        .catch((err: Error) => request.log.warn({ err: err.message }, 'Open-Cloud-Weckruf fehlgeschlagen'));
      return result;
    },
  );
}
