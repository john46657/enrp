import { type FastifyInstance } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { duty, factionsModule, players, requirePermission, vehiclesModule } from '@enrp/core';
import { errors, periodStart } from '@enrp/shared';
import { requireAuthenticated } from '../plugins/auth';
import { boolQuery, idParam, isoDate, paginationQuery, reason, robloxUserId, snowflake, statsPeriod } from './schemas';

export async function worldRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const { core } = app.deps;

  async function resolveRobloxId(input: { robloxUserId?: number; robloxUsername?: string }) {
    if (input.robloxUserId) return input.robloxUserId;
    if (input.robloxUsername) {
      const user = await players.findRobloxUserByName(core.db, input.robloxUsername);
      if (!user) throw errors.notFound('Roblox-Spieler (noch nie im Spiel gesehen)');
      return user.id;
    }
    throw errors.badRequest('robloxUserId oder robloxUsername angeben.');
  }

  // ---------------------------------------------------------------- Spieler
  const ptags = ['Spieler'];
  app.get(
    '/players',
    {
      schema: {
        tags: ptags,
        summary: 'Spielersuche',
        querystring: paginationQuery.extend({
          faction: z.string().max(40).optional(),
          verified: boolQuery,
          sortBy: z.enum(['playtime', 'name', 'lastSeen']).optional(),
        }),
      },
    },
    async (request) =>
      players.searchPlayers(core.db, request.actor, {
        ...request.query,
        factionKey: request.query.faction,
        sort: request.query.sortBy,
      }),
  );
  app.get('/players/me', { schema: { tags: ptags, summary: 'Eigenes Profil' } }, async (request) => {
    requireAuthenticated(request);
    return players.getPlayerProfile(
      core.db,
      request.actor,
      { discordUserId: (request.actor as { discordUserId: string }).discordUserId },
      core.now(),
    );
  });
  app.get(
    '/players/roblox/:robloxUserId',
    { schema: { tags: ptags, summary: 'Profil nach Roblox-ID', params: z.object({ robloxUserId }) } },
    async (request) =>
      players.getPlayerProfile(core.db, request.actor, { robloxUserId: request.params.robloxUserId }, core.now()),
  );
  app.get(
    '/players/discord/:discordUserId',
    { schema: { tags: ptags, summary: 'Profil nach Discord-ID', params: z.object({ discordUserId: snowflake }) } },
    async (request) =>
      players.getPlayerProfile(core.db, request.actor, { discordUserId: request.params.discordUserId }, core.now()),
  );
  app.get(
    '/players/history',
    {
      schema: {
        tags: ptags,
        summary: 'Änderungshistorie eines Profils',
        querystring: z.object({ discordUserId: snowflake.optional(), robloxUserId: robloxUserId.optional() }),
      },
    },
    async (request) => {
      requireAuthenticated(request);
      const q = request.query;
      const ref = q.robloxUserId
        ? { robloxUserId: q.robloxUserId }
        : { discordUserId: q.discordUserId ?? (request.actor as { discordUserId: string }).discordUserId };
      return { items: await players.getProfileHistory(core.db, request.actor, ref) };
    },
  );
  app.get(
    '/leaderboards/playtime',
    {
      schema: {
        tags: ['Ranglisten'],
        summary: 'Rangliste Spielzeit (öffentlich)',
        querystring: z.object({ limit: z.coerce.number().int().min(1).max(100).default(10) }),
      },
    },
    async (request) => ({
      items: await players.playtimeLeaderboard(core.db, request.query.limit),
    }),
  );
  app.get(
    '/leaderboards/duty',
    {
      schema: {
        tags: ['Ranglisten'],
        summary: 'Rangliste Dienstzeit (öffentlich)',
        querystring: z.object({
          period: statsPeriod,
          faction: z.string().max(40).optional(),
          limit: z.coerce.number().int().min(1).max(100).default(10),
        }),
      },
    },
    async (request) => {
      const factionIds = request.query.faction
        ? [(await factionsModule.getFaction(core.db, request.query.faction)).id]
        : undefined;
      return {
        items: await duty.dutyLeaderboard(core.db, {
          since: periodStart(request.query.period, core.now()),
          factionIds,
          limit: request.query.limit,
        }),
      };
    },
  );

  // ---------------------------------------------------------------- Fraktionen
  const ftags = ['Fraktionen'];
  app.get('/factions', { schema: { tags: ftags, summary: 'Fraktionsübersicht (öffentlich)' } }, async () => ({
    items: await factionsModule.listFactions(core.db),
  }));
  app.get(
    '/factions/stats',
    { schema: { tags: ftags, summary: 'Fraktionsstatistiken', querystring: z.object({ period: statsPeriod }) } },
    async (request) => {
      requirePermission(request.actor, 'factions:view');
      return { items: await factionsModule.factionStats(core.db, periodStart(request.query.period, core.now())) };
    },
  );
  app.get(
    '/factions/:key',
    { schema: { tags: ftags, summary: 'Fraktion', params: z.object({ key: z.string().max(40) }) } },
    async (request) => factionsModule.getFaction(core.db, request.params.key),
  );
  app.get(
    '/factions/:key/members',
    {
      schema: {
        tags: ftags,
        summary: 'Mitgliederliste',
        params: z.object({ key: z.string().max(40) }),
        querystring: paginationQuery,
      },
    },
    async (request) => {
      const faction = await factionsModule.getFaction(core.db, request.params.key);
      requirePermission(request.actor, 'factions:view', { factionId: faction.id });
      return factionsModule.listMembers(core.db, faction.id, request.query);
    },
  );
  app.get(
    '/factions/:key/history',
    {
      schema: {
        tags: ftags,
        summary: 'Änderungshistorie der Mitgliedschaften',
        params: z.object({ key: z.string().max(40) }),
      },
    },
    async (request) => {
      const faction = await factionsModule.getFaction(core.db, request.params.key);
      requirePermission(request.actor, 'factions:view', { factionId: faction.id });
      return { items: await factionsModule.membershipHistory(core.db, { factionId: faction.id }) };
    },
  );
  app.post(
    '/factions/:key/members',
    {
      schema: {
        tags: ftags,
        summary: 'Aufnehmen oder versetzen',
        params: z.object({ key: z.string().max(40) }),
        body: z.object({
          robloxUserId: robloxUserId.optional(),
          robloxUsername: z.string().max(40).optional(),
          reason,
        }),
      },
      config: { idempotent: true },
    },
    async (request) =>
      factionsModule.assignFaction(core, request.actor, {
        robloxUserId: await resolveRobloxId(request.body),
        factionKey: request.params.key,
        reason: request.body.reason,
      }),
  );
  app.post(
    '/factions/members/remove',
    {
      schema: {
        tags: ftags,
        summary: 'Aus Fraktion entfernen',
        body: z.object({
          robloxUserId: robloxUserId.optional(),
          robloxUsername: z.string().max(40).optional(),
          reason,
        }),
      },
      config: { idempotent: true },
    },
    async (request) =>
      factionsModule.removeFromFaction(core, request.actor, {
        robloxUserId: await resolveRobloxId(request.body),
        reason: request.body.reason,
      }),
  );
  app.patch(
    '/factions/:key',
    {
      schema: {
        tags: ftags,
        summary: 'Fraktion konfigurieren (Name, Farbe, Discord-Rolle, aktiv)',
        params: z.object({ key: z.string().max(40) }),
        body: z.object({
          name: z.string().min(2).max(60).optional(),
          description: z.string().max(500).optional(),
          color: z
            .string()
            .regex(/^#[0-9a-fA-F]{6}$/)
            .optional(),
          discordRoleId: snowflake.nullable().optional(),
          isActive: z.boolean().optional(),
          reason,
        }),
      },
    },
    async (request) => {
      const { reason: r, ...patch } = request.body;
      return factionsModule.updateFaction(core, request.actor, request.params.key, patch, r);
    },
  );

  // ---------------------------------------------------------------- Dienst
  const dtags = ['Dienstsystem'];
  app.get(
    '/duty/status/:robloxUserId',
    { schema: { tags: dtags, summary: 'Aktueller Dienststatus (öffentlich)', params: z.object({ robloxUserId }) } },
    async (request) => {
      const active = await duty.getActiveDuty(core.db, request.params.robloxUserId);
      return { onDuty: Boolean(active), faction: active?.faction ?? null, since: active?.session.startedAt ?? null };
    },
  );
  app.get('/duty/on-duty', { schema: { tags: dtags, summary: 'Anzahl im Dienst je Fraktion' } }, async () => ({
    items: await duty.onDutyCounts(core.db),
  }));
  app.get(
    '/duty/stats',
    {
      schema: {
        tags: dtags,
        summary: 'Dienststatistik (Person oder Fraktion)',
        querystring: z.object({
          robloxUserId: robloxUserId.optional(),
          faction: z.string().max(40).optional(),
          period: statsPeriod,
        }),
      },
    },
    async (request) => {
      const since = periodStart(request.query.period, core.now());
      const factionIds = request.query.faction
        ? [(await factionsModule.getFaction(core.db, request.query.faction)).id]
        : undefined;
      return duty.dutyTotals(core.db, { robloxUserId: request.query.robloxUserId, factionIds, since });
    },
  );
  app.get(
    '/duty/sessions',
    {
      schema: {
        tags: dtags,
        summary: 'Historie der Dienstsessions',
        querystring: paginationQuery.extend({
          robloxUserId: robloxUserId.optional(),
          faction: z.string().max(40).optional(),
          status: z.enum(['active', 'completed', 'auto_closed', 'invalidated']).optional(),
          flagged: boolQuery,
          period: statsPeriod,
        }),
      },
    },
    async (request) => {
      const scope = factionsModule.factionScope(request.actor, 'duty:view');
      if (Array.isArray(scope) && !scope.length) throw errors.forbidden('Dir fehlt die Berechtigung „duty:view“.');
      let factionIds: string[] | 'all' = scope;
      if (request.query.faction) {
        const f = await factionsModule.getFaction(core.db, request.query.faction);
        if (scope !== 'all' && !scope.includes(f.id)) throw errors.forbidden();
        factionIds = [f.id];
      }
      return duty.listDutySessions(core.db, {
        ...request.query,
        factionIds,
        since: periodStart(request.query.period, core.now()),
      });
    },
  );
  app.post(
    '/duty/sessions/:id/correct',
    {
      schema: {
        tags: dtags,
        summary: 'Dienstsession korrigieren oder ungültig machen',
        params: idParam,
        body: z.object({
          startedAt: isoDate.optional(),
          endedAt: isoDate.optional(),
          invalidate: z.boolean().optional(),
          reason,
        }),
      },
      config: { idempotent: true },
    },
    async (request) => {
      const { reason: r, ...patch } = request.body;
      return duty.correctDutySession(core, request.actor, request.params.id, patch, r);
    },
  );
  app.get(
    '/duty/sessions/:id/corrections',
    { schema: { tags: dtags, summary: 'Korrekturen einer Session', params: idParam } },
    async (request) => {
      requirePermission(request.actor, 'duty:view');
      return { items: await duty.listCorrections(core.db, request.params.id) };
    },
  );

  // ---------------------------------------------------------------- Fahrzeuge
  const vtags = ['Fahrzeuge'];
  app.get('/vehicles/categories', { schema: { tags: vtags, summary: 'Fahrzeugkategorien' } }, async (request) => {
    requirePermission(request.actor, 'vehicles:view');
    return { items: await vehiclesModule.listVehicleCategories(core.db) };
  });
  app.post(
    '/vehicles/categories',
    {
      schema: {
        tags: vtags,
        summary: 'Kategorie anlegen',
        body: z.object({
          key: z.string().max(40),
          name: z.string().min(2).max(60),
          sortOrder: z.number().int().optional(),
          reason,
        }),
      },
    },
    async (request) => {
      const { reason: r, ...input } = request.body;
      return vehiclesModule.createVehicleCategory(core, request.actor, input, r);
    },
  );
  app.get(
    '/vehicles',
    {
      schema: {
        tags: vtags,
        summary: 'Fahrzeugübersicht',
        querystring: paginationQuery.extend({
          categoryId: z.uuid().optional(),
          factionId: z.uuid().optional(),
          status: z.enum(['active', 'maintenance', 'disabled', 'retired']).optional(),
        }),
      },
    },
    async (request) => vehiclesModule.listVehicles(core.db, request.actor, request.query),
  );
  app.get(
    '/vehicles/:id',
    { schema: { tags: vtags, summary: 'Fahrzeugdetails mit Zuweisungen', params: idParam } },
    async (request) => vehiclesModule.getVehicle(core.db, request.actor, request.params.id),
  );
  app.post(
    '/vehicles',
    {
      schema: { tags: vtags, summary: 'Fahrzeug anlegen', body: vehiclesModule.vehicleInput.extend({ reason }) },
      config: { idempotent: true },
    },
    async (request) => {
      const { reason: r, ...input } = request.body;
      return vehiclesModule.createVehicle(core, request.actor, input, r);
    },
  );
  app.patch(
    '/vehicles/:id',
    {
      schema: {
        tags: vtags,
        summary: 'Fahrzeug bearbeiten',
        params: idParam,
        body: vehiclesModule.vehicleInput.partial().extend({ reason }),
      },
    },
    async (request) => {
      const { reason: r, ...patch } = request.body;
      return vehiclesModule.updateVehicle(core, request.actor, request.params.id, patch, r);
    },
  );
  app.post(
    '/vehicles/:id/delete',
    { schema: { tags: vtags, summary: 'Fahrzeug löschen', params: idParam, body: z.object({ reason }) } },
    async (request) => vehiclesModule.deleteVehicle(core, request.actor, request.params.id, request.body.reason),
  );
  app.post(
    '/vehicles/:id/assign',
    {
      schema: {
        tags: vtags,
        summary: 'Fahrzeug zuweisen',
        params: idParam,
        body: z.object({
          robloxUserId: robloxUserId.optional(),
          robloxUsername: z.string().max(40).optional(),
          reason,
        }),
      },
      config: { idempotent: true },
    },
    async (request) =>
      vehiclesModule.assignVehicle(core, request.actor, {
        vehicleId: request.params.id,
        robloxUserId: await resolveRobloxId(request.body),
        reason: request.body.reason,
      }),
  );
  app.post(
    '/vehicles/assignments/:id/unassign',
    { schema: { tags: vtags, summary: 'Zuweisung entfernen', params: idParam, body: z.object({ reason }) } },
    async (request) =>
      vehiclesModule.unassignVehicle(core, request.actor, {
        assignmentId: request.params.id,
        reason: request.body.reason,
      }),
  );
}
