import { type FastifyInstance } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getSetting, guilds, loadFlags } from '@enrp/core';
import { AppError } from '@enrp/shared';

/** Konfiguration, die der Discord-Bot regelmäßig abruft (Begrüßung, deaktivierte Befehle, Flags). */
export async function botRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const { core } = app.deps;
  // Nur der Bot selbst (Service-Token ohne handelnde Person)
  const onlyBot = (request: { authMethod?: string; actor: { kind: string } }) => {
    if (request.authMethod !== 'bot' || request.actor.kind !== 'service')
      throw new AppError('FORBIDDEN', 'Nur für den Bot.');
  };
  const snowflake = z.string().regex(/^\d{15,22}$/);
  // Weitere Discords: der Bot meldet Beitritt und Austritt (Haupt-Discord wird nicht gespeichert).
  app.post(
    '/bot/guilds',
    {
      schema: {
        tags: ['Bot'],
        summary: 'Bot ist einem weiteren Discord beigetreten (nur Service-Token)',
        body: z.object({ id: snowflake, name: z.string().min(1).max(100) }),
      },
    },
    async (request) => {
      onlyBot(request);
      return guilds.registerGuild(core, request.body);
    },
  );
  app.post(
    '/bot/guilds/:id/left',
    {
      schema: { tags: ['Bot'], summary: 'Bot hat einen Discord verlassen', params: z.object({ id: snowflake }) },
    },
    async (request) => {
      onlyBot(request);
      await guilds.markGuildLeft(core, request.params.id);
      return { ok: true };
    },
  );
  app.get(
    '/bot/config',
    { schema: { tags: ['Bot'], summary: 'Bot-Konfiguration (nur Service-Token)' } },
    async (request) => {
      if (request.authMethod !== 'bot') throw new AppError('FORBIDDEN', 'Nur für den Bot.');
      const flags = Object.fromEntries(await loadFlags(core.db));
      return {
        welcome: await getSetting(core.db, 'welcome'),
        bot: await getSetting(core.db, 'bot'),
        notifications: await getSetting(core.db, 'notifications'),
        verification: await getSetting(core.db, 'verification'),
        flags,
      };
    },
  );
}
