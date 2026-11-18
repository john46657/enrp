import { type FastifyInstance } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { community, requirePermission } from '@enrp/core';
import { periodStart } from '@enrp/shared';
import { requireAuthenticated } from '../plugins/auth';
import { idParam, isoDate, paginationQuery, reason, snowflake, statsPeriod } from './schemas';

const text = (max: number) => z.string().trim().min(1).max(max);

export async function communityRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const { core } = app.deps;
  const tags = ['Community'];

  // Vorschläge
  app.post(
    '/suggestions',
    {
      schema: { tags, summary: 'Vorschlag einreichen', body: z.object({ title: text(120), body: text(2000) }) },
      config: { idempotent: true },
    },
    async (request) => community.createSuggestion(core, request.actor, request.body),
  );
  app.get(
    '/suggestions',
    {
      schema: {
        tags,
        summary: 'Vorschläge',
        querystring: paginationQuery.extend({
          status: z.enum(['open', 'under_review', 'accepted', 'rejected', 'implemented']).optional(),
        }),
      },
    },
    async (request) => community.listSuggestions(core.db, request.query),
  );
  app.post(
    '/suggestions/:id/vote',
    {
      schema: {
        tags,
        summary: 'Abstimmen (1, -1, 0 = zurückziehen)',
        params: idParam,
        body: z.object({ value: z.union([z.literal(1), z.literal(-1), z.literal(0)]) }),
      },
    },
    async (request) => community.voteSuggestion(core, request.actor, request.params.id, request.body.value),
  );
  app.post(
    '/suggestions/:id/status',
    {
      schema: {
        tags,
        summary: 'Status setzen',
        params: idParam,
        body: z.object({ status: z.enum(['open', 'under_review', 'accepted', 'rejected', 'implemented']), reason }),
      },
    },
    async (request) =>
      community.setSuggestionStatus(core, request.actor, request.params.id, request.body.status, request.body.reason),
  );
  app.post(
    '/suggestions/:id/message',
    {
      schema: {
        tags,
        summary: 'Discord-Nachricht verknüpfen (Bot)',
        params: idParam,
        body: z.object({ channelId: snowflake, messageId: snowflake }),
      },
    },
    async (request) => {
      if (request.authMethod !== 'bot') requirePermission(request.actor, 'community:edit');
      await community.attachSuggestionMessage(
        core.db,
        request.params.id,
        request.body.channelId,
        request.body.messageId,
      );
      return { ok: true };
    },
  );
  app.get(
    '/suggestions/:id',
    { schema: { tags, summary: 'Vorschlag mit Stimmen', params: idParam } },
    async (request) => {
      const suggestion = await community.getSuggestion(core.db, request.params.id);
      return { suggestion, ...(await community.suggestionTally(core.db, suggestion.id)) };
    },
  );

  // Umfragen
  app.post(
    '/polls',
    {
      schema: {
        tags,
        summary: 'Umfrage erstellen',
        body: z.object({
          question: text(200),
          options: z.array(z.string().max(80)).min(2).max(10),
          multipleChoice: z.boolean().optional(),
          durationHours: z.number().min(0.1).max(720).optional(),
          channelId: snowflake.optional(),
        }),
      },
    },
    async (request) => community.createPoll(core, request.actor, request.body),
  );
  app.get(
    '/polls',
    {
      schema: {
        tags,
        summary: 'Umfragen',
        querystring: paginationQuery.extend({ status: z.enum(['open', 'closed']).optional() }),
      },
    },
    async (request) => community.listPolls(core.db, request.query),
  );
  app.get('/polls/:id', { schema: { tags, summary: 'Umfrageergebnis', params: idParam } }, async (request) =>
    community.pollResults(core.db, request.params.id),
  );
  app.post(
    '/polls/:id/vote',
    {
      schema: {
        tags,
        summary: 'Abstimmen',
        params: idParam,
        body: z.object({ optionIds: z.array(z.string().max(2)).min(1).max(10) }),
      },
    },
    async (request) => community.votePoll(core, request.actor, request.params.id, request.body.optionIds),
  );
  app.post(
    '/polls/:id/close',
    { schema: { tags, summary: 'Umfrage beenden', params: idParam } },
    async (request) => (await community.closePoll(core, request.actor, request.params.id)) ?? { status: 'closed' },
  );
  app.post(
    '/polls/:id/message',
    {
      schema: {
        tags,
        summary: 'Discord-Nachricht verknüpfen (Bot)',
        params: idParam,
        body: z.object({ channelId: snowflake, messageId: snowflake }),
      },
    },
    async (request) => {
      if (request.authMethod !== 'bot') requirePermission(request.actor, 'community:edit');
      await community.attachPollMessage(core.db, request.params.id, request.body.channelId, request.body.messageId);
      return { ok: true };
    },
  );

  // Giveaways
  app.post(
    '/giveaways',
    {
      schema: {
        tags,
        summary: 'Giveaway erstellen',
        body: z.object({
          prize: text(150),
          description: z.string().max(1000).optional(),
          winnerCount: z.number().int().min(1).max(20),
          durationHours: z.number().min(0.1).max(720),
          requireVerified: z.boolean().optional(),
          channelId: snowflake.optional(),
        }),
      },
    },
    async (request) => community.createGiveaway(core, request.actor, request.body),
  );
  app.get(
    '/giveaways',
    {
      schema: {
        tags,
        summary: 'Giveaways',
        querystring: paginationQuery.extend({ status: z.enum(['open', 'drawn', 'cancelled']).optional() }),
      },
    },
    async (request) => community.listGiveaways(core.db, request.query),
  );
  app.post('/giveaways/:id/enter', { schema: { tags, summary: 'Teilnehmen', params: idParam } }, async (request) =>
    community.enterGiveaway(core, request.actor, request.params.id),
  );
  app.post(
    '/giveaways/:id/draw',
    { schema: { tags, summary: 'Gewinner ziehen', params: idParam }, config: { idempotent: true } },
    async (request) => community.drawGiveaway(core, request.actor, request.params.id),
  );
  app.post(
    '/giveaways/:id/cancel',
    { schema: { tags, summary: 'Abbrechen', params: idParam, body: z.object({ reason }) } },
    async (request) => community.cancelGiveaway(core, request.actor, request.params.id, request.body.reason),
  );
  app.post(
    '/giveaways/:id/message',
    {
      schema: {
        tags,
        summary: 'Discord-Nachricht verknüpfen (Bot)',
        params: idParam,
        body: z.object({ channelId: snowflake, messageId: snowflake }),
      },
    },
    async (request) => {
      if (request.authMethod !== 'bot') requirePermission(request.actor, 'community:edit');
      await community.attachGiveawayMessage(core.db, request.params.id, request.body.channelId, request.body.messageId);
      return { ok: true };
    },
  );

  // Ankündigungen, Changelog, Wartung
  const atags = ['Ankündigungen'];
  app.post(
    '/announcements',
    {
      schema: {
        tags: atags,
        summary: 'Ankündigung / Changelog-Eintrag anlegen',
        body: z.object({
          kind: z.enum(['general', 'changelog', 'maintenance']).optional(),
          title: text(200),
          body: text(4000),
          version: z.string().max(40).optional(),
          channelId: snowflake.optional(),
          inGame: z.boolean().optional(),
          publishAt: isoDate.optional(),
        }),
      },
      config: { idempotent: true },
    },
    async (request) => community.createAnnouncement(core, request.actor, request.body),
  );
  app.get(
    '/announcements',
    {
      schema: {
        tags: atags,
        summary: 'Ankündigungen',
        querystring: paginationQuery.extend({
          kind: z.enum(['general', 'changelog', 'maintenance']).optional(),
          status: z.enum(['draft', 'scheduled', 'published']).optional(),
        }),
      },
    },
    async (request) => {
      requirePermission(request.actor, 'announcements:view');
      return community.listAnnouncements(core.db, request.query);
    },
  );
  app.get(
    '/changelog',
    { schema: { tags: atags, summary: 'Veröffentlichter Changelog (öffentlich)', querystring: paginationQuery } },
    async (request) =>
      community.listAnnouncements(core.db, { ...request.query, kind: 'changelog', status: 'published' }),
  );
  app.post(
    '/announcements/:id/publish',
    { schema: { tags: atags, summary: 'Veröffentlichen', params: idParam }, config: { idempotent: true } },
    async (request) => community.publishAnnouncement(core, request.actor, request.params.id),
  );
  app.get(
    '/maintenance',
    { schema: { tags: atags, summary: 'Wartungsstatus (öffentlich) und geplante Fenster' } },
    async () => ({
      current: await community.currentMaintenance(core.db, core.now()),
      windows: await community.listMaintenance(core.db, 20),
    }),
  );
  app.post(
    '/maintenance',
    {
      schema: {
        tags: atags,
        summary: 'Wartung planen',
        body: z.object({ title: text(150), message: text(1000), startsAt: isoDate, endsAt: isoDate }),
      },
    },
    async (request) => community.scheduleMaintenance(core, request.actor, request.body),
  );
  app.post(
    '/maintenance/:id/status',
    {
      schema: {
        tags: atags,
        summary: 'Wartungsstatus ändern',
        params: idParam,
        body: z.object({ status: z.enum(['active', 'completed', 'cancelled']) }),
      },
    },
    async (request) => community.updateMaintenanceStatus(core, request.actor, request.params.id, request.body.status),
  );

  // Regelwerk
  const rtags = ['Regelwerk'];
  app.get('/rules', { schema: { tags: rtags, summary: 'Aktuelles Regelwerk (öffentlich)' } }, async () => ({
    rules: await community.currentRules(core.db),
  }));
  app.get('/rules/versions', { schema: { tags: rtags, summary: 'Alle Versionen' } }, async (request) => {
    requirePermission(request.actor, 'rules:view');
    const sets = await community.listRuleSets(core.db);
    return {
      items: await Promise.all(
        sets.map(async (s) => ({ ...s, acceptances: await community.ruleAcceptanceCount(core.db, s.id) })),
      ),
    };
  });
  app.post(
    '/rules',
    {
      schema: { tags: rtags, summary: 'Entwurf anlegen', body: z.object({ title: text(150), content: text(50_000) }) },
    },
    async (request) => community.createRuleDraft(core, request.actor, request.body),
  );
  app.post(
    '/rules/:id/publish',
    { schema: { tags: rtags, summary: 'Version veröffentlichen', params: idParam } },
    async (request) => community.publishRules(core, request.actor, request.params.id),
  );
  app.post('/rules/accept', { schema: { tags: rtags, summary: 'Regelwerk bestätigen' } }, async (request) =>
    community.acceptRules(core, request.actor),
  );
  app.get('/rules/acceptance', { schema: { tags: rtags, summary: 'Eigener Bestätigungsstatus' } }, async (request) => {
    requireAuthenticated(request);
    return community.ruleAcceptanceStatus(core.db, (request.actor as { discordUserId: string }).discordUserId);
  });

  // Codes
  const ctags = ['Codes & Rewards'];
  app.get(
    '/codes',
    { schema: { tags: ctags, summary: 'Codes (ohne Klartext)', querystring: paginationQuery } },
    async (request) => {
      requirePermission(request.actor, 'codes:view');
      return community.listRewardCodes(core.db, request.query);
    },
  );
  app.post(
    '/codes',
    {
      schema: {
        tags: ctags,
        summary: 'Code anlegen (Klartext wird nur einmal angezeigt)',
        body: z.object({
          code: z.string().max(40).optional(),
          description: z.string().max(300).optional(),
          rewardType: z.string().max(40),
          rewardPayload: z
            .record(z.string().max(40), z.union([z.string().max(200), z.number(), z.boolean()]))
            .optional(),
          maxRedemptions: z.number().int().min(1).max(1_000_000).nullable().optional(),
          perUserLimit: z.number().int().min(1).max(100).optional(),
          startsAt: isoDate.optional(),
          expiresAt: isoDate.optional(),
        }),
      },
      config: { idempotent: true },
    },
    async (request) => community.createRewardCode(core, request.actor, request.body),
  );
  app.post(
    '/codes/:id/status',
    {
      schema: {
        tags: ctags,
        summary: 'Code aktivieren/deaktivieren',
        params: idParam,
        body: z.object({ status: z.enum(['active', 'disabled']), reason }),
      },
    },
    async (request) =>
      community.setRewardCodeStatus(core, request.actor, request.params.id, request.body.status, request.body.reason),
  );

  app.get(
    '/community/stats',
    {
      schema: { tags, summary: 'Statistiken zu Community-Aktivitäten', querystring: z.object({ period: statsPeriod }) },
    },
    async (request) => {
      requirePermission(request.actor, 'community:view');
      return community.communityStats(core.db, periodStart(request.query.period, core.now()) ?? new Date(0));
    },
  );
}
