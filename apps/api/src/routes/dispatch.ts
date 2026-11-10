import { type FastifyInstance } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { dispatch, live } from '@enrp/core';
import { DISPATCH_SOURCE } from '@enrp/shared';
import { csvList, idParam, paginationQuery, snowflake } from './schemas';

/** Leitstelle: Einsätze (Ingame-Notrufe + eigene), Einheiten, Mod-Calls und Live-Lage aus dem Spiel. */
export async function dispatchRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const { core } = app.deps;
  const tags = ['Leitstelle'];

  app.get(
    '/dispatch/incidents',
    {
      schema: {
        tags,
        summary: 'Einsätze (offene zuerst, nach Priorität)',
        querystring: paginationQuery.extend({
          status: csvList,
          source: z.enum(DISPATCH_SOURCE).optional(),
          department: z.string().max(40).optional(),
          q: z.string().max(100).optional(),
        }),
      },
    },
    async (request) => dispatch.listIncidents(core.db, request.actor, request.query),
  );
  app.post(
    '/dispatch/incidents',
    {
      schema: { tags, summary: 'Eigenen Einsatz anlegen', body: dispatch.createIncidentSchema },
      config: { idempotent: true },
    },
    async (request) => dispatch.createIncident(core, request.actor, request.body),
  );
  app.get(
    '/dispatch/incidents/:id',
    { schema: { tags, summary: 'Einsatz mit Einheiten, Anrufer und Verlauf', params: idParam } },
    async (request) => dispatch.getIncidentDetail(core, request.actor, request.params.id),
  );
  app.post(
    '/dispatch/incidents/:id/assign',
    {
      schema: {
        tags,
        summary: 'Einheit zuweisen (ohne unitId: sich selbst)',
        params: idParam,
        body: z.object({ unitId: snowflake.optional() }),
      },
    },
    async (request) => dispatch.assignUnit(core, request.actor, request.params.id, request.body.unitId),
  );
  app.post(
    '/dispatch/incidents/:id/status',
    {
      schema: { tags, summary: 'Status ändern', params: idParam, body: z.object({ status: dispatch.statusSchema }) },
    },
    async (request) => dispatch.setStatus(core, request.actor, request.params.id, request.body.status),
  );
  app.post(
    '/dispatch/incidents/:id/notes',
    {
      schema: {
        tags,
        summary: 'Notiz hinzufügen',
        params: idParam,
        body: z.object({ text: z.string().trim().min(1).max(1000) }),
      },
    },
    async (request) => dispatch.addNote(core, request.actor, request.params.id, request.body.text),
  );
  app.post(
    '/dispatch/incidents/:id/close',
    {
      schema: {
        tags,
        summary: 'Einsatz abschließen (mit Bericht)',
        params: idParam,
        body: z.object({ report: z.string().max(3000).optional() }),
      },
    },
    async (request) => dispatch.closeIncident(core, request.actor, request.params.id, request.body.report),
  );
  app.get(
    '/dispatch/units',
    {
      schema: {
        tags,
        summary: 'Einheiten mit Status, Einsatz und Spielstatus',
        querystring: z.object({ all: z.coerce.boolean().default(false) }),
      },
    },
    async (request) => dispatch.listUnits(core, request.actor, request.query.all),
  );
  app.put(
    '/dispatch/units/me',
    { schema: { tags, summary: 'Eigenen Einheitenstatus und Rufnamen setzen', body: dispatch.unitStatusSchema } },
    async (request) => dispatch.setOwnUnitStatus(core, request.actor, request.body),
  );
  app.get(
    '/dispatch/stats',
    {
      schema: {
        tags,
        summary: 'Statistik der Leitstelle',
        querystring: z.object({ days: z.coerce.number().int().min(1).max(365).default(7) }),
      },
    },
    async (request) => dispatch.stats(core.db, request.actor, core.now(), request.query.days),
  );

  // Mod-Calls
  app.get(
    '/mod-calls',
    {
      schema: {
        tags: ['Mod-Calls'],
        summary: 'Mod-Calls aus dem Spiel (offene zuerst)',
        querystring: paginationQuery.extend({ status: csvList }),
      },
    },
    async (request) => dispatch.listModCalls(core.db, request.actor, request.query),
  );
  app.post(
    '/mod-calls/:id/claim',
    { schema: { tags: ['Mod-Calls'], summary: 'Mod-Call übernehmen (Spieler wird benachrichtigt)', params: idParam } },
    async (request) => dispatch.claimModCall(core, request.actor, request.params.id),
  );
  app.post(
    '/mod-calls/:id/close',
    {
      schema: {
        tags: ['Mod-Calls'],
        summary: 'Mod-Call schließen',
        params: idParam,
        body: z.object({ note: z.string().max(1000).optional() }),
      },
    },
    async (request) => dispatch.closeModCall(core, request.actor, request.params.id, request.body.note),
  );

  // Live-Lage
  app.get(
    '/roblox/live/players',
    {
      schema: {
        tags: ['Live-Lage'],
        summary: 'Spieler auf laufenden Servern (Team, Fahndung, Gefängnis, Rufname)',
        querystring: z.object({ q: z.string().max(60).optional(), team: z.string().max(40).optional() }),
      },
    },
    async (request) => live.livePlayers(core.db, request.actor, core.now(), request.query),
  );
  app.get(
    '/roblox/live/vehicles',
    {
      schema: {
        tags: ['Live-Lage'],
        summary: 'Gespawnte Fahrzeuge (Kennzeichensuche)',
        querystring: z.object({
          plate: z.string().max(16).optional(),
          ownerId: z.coerce.number().int().positive().optional(),
        }),
      },
    },
    async (request) => live.liveVehicles(core.db, request.actor, core.now(), request.query),
  );
}
