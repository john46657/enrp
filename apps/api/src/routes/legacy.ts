import { type FastifyInstance } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { legacy } from '@enrp/core';
import { AppError } from '@enrp/shared';

/**
 * Altmodule des Bots (Bewerbungen, Level, Rollenpanel, Ticketpanel, /einstellungen) im Dashboard.
 * Die API prüft Rechte und schreibt das Audit-Log; ausgeführt wird beim Bot (siehe packages/core legacy.ts).
 */
export async function legacyRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const { core } = app.deps;
  const tags = ['Altmodule'];
  const name = z.object({ name: z.string().regex(/^[a-z-]{1,40}$/) });

  app.get(
    '/legacy/live/:name',
    { schema: { tags, summary: 'Daten der Altmodule lesen (beantwortet der Bot)', params: name } },
    async (request) => ({ data: await legacy.readLive(core, request.actor, request.params.name) }),
  );
  app.post(
    '/legacy/actions/:name',
    {
      schema: {
        tags,
        summary: 'Aktion in den Altmodulen ausführen (z. B. Bewerbung entscheiden, Panel posten)',
        params: name,
        body: z.record(z.string(), z.unknown()),
      },
    },
    async (request) => ({
      result: (await legacy.runAction(core, request.actor, request.params.name, request.body)) ?? null,
    }),
  );
  app.put(
    '/legacy/settings',
    {
      schema: {
        tags,
        summary: 'Einstellungen der Altmodule ändern (alle Änderungen oder keine)',
        body: legacy.legacySettingsSchema,
      },
    },
    async (request) => legacy.saveSettings(core, request.actor, request.body),
  );
  app.post(
    '/legacy/settings/reset',
    { schema: { tags, summary: 'Einstellungen der Altmodule auf die config.json zurücksetzen' } },
    async (request) => legacy.resetSettings(core, request.actor),
  );

  // ---------- Bot ----------
  const onlyBot = (request: { authMethod?: string; actor: { kind: string } }) => {
    if (request.authMethod !== 'bot' || request.actor.kind !== 'service')
      throw new AppError('FORBIDDEN', 'Nur für den Bot.');
  };
  app.get(
    '/bot/legacy/requests',
    {
      schema: {
        tags: ['Bot'],
        summary: 'Offene Anfragen an die Altmodule abholen (Long-Polling, nur Service-Token)',
        querystring: z.object({ wait: z.coerce.number().int().min(0).max(25).default(20) }),
      },
    },
    async (request) => {
      onlyBot(request);
      const gone = new AbortController();
      request.raw.socket.once('close', () => gone.abort());
      return { items: await legacy.claimRequests(core, request.query.wait * 1000, gone.signal) };
    },
  );
  app.post(
    '/bot/legacy/requests/:id/result',
    {
      // Listen (z. B. bis zu 500 Bewerbungen mit Antworten) können größer sein als übliche Anfragen.
      bodyLimit: 8 * 1024 * 1024,
      schema: {
        tags: ['Bot'],
        summary: 'Ergebnis einer Anfrage an die Altmodule melden (nur Service-Token)',
        params: z.object({ id: z.uuid() }),
        body: legacy.legacyResultSchema,
      },
    },
    async (request) => {
      onlyBot(request);
      return legacy.completeRequest(core, request.params.id, request.body);
    },
  );
}
