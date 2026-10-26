import { type FastifyInstance } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { moderation, requirePermission, support } from '@enrp/core';
import { MODERATION_STATUS, MODERATION_TYPES, REPORT_STATUS, TICKET_PRIORITY, TICKET_STATUS } from '@enrp/shared';
import { requireAuthenticated } from '../plugins/auth';
import { csvList, idParam, isoDate, paginationQuery, reason, robloxUserId, snowflake } from './schemas';

const text = (max: number) => z.string().trim().min(1).max(max);

export async function supportRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const { core } = app.deps;

  // ---------------------------------------------------------------- Tickets
  const ttags = ['Tickets'];
  app.post(
    '/tickets',
    {
      schema: {
        tags: ttags,
        summary: 'Ticket erstellen',
        body: z.object({ subject: text(150), category: z.string().max(40).optional(), body: z.string().max(4000).optional(), priority: z.enum(TICKET_PRIORITY).optional(), discordChannelId: snowflake.optional(), creatorDiscordId: snowflake.optional() }),
      },
      config: { idempotent: true, rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request) => support.createTicket(core, request.actor, request.body),
  );
  app.get(
    '/tickets',
    {
      schema: {
        tags: ttags,
        summary: 'Tickets (eigene oder alle mit tickets:view)',
        querystring: paginationQuery.extend({ status: csvList, assignee: snowflake.optional(), creator: snowflake.optional(), category: z.string().max(40).optional(), from: isoDate.optional(), to: isoDate.optional() }),
      },
    },
    async (request) => support.listTickets(core.db, request.actor, request.query),
  );
  app.get('/tickets/:id', { schema: { tags: ttags, summary: 'Ticket mit Verlauf', params: idParam } }, async (request) => support.getTicketDetail(core.db, request.actor, request.params.id));
  app.post(
    '/tickets/:id/actions',
    {
      schema: {
        tags: ttags,
        summary: 'Übernehmen, zuweisen, Status, Priorität, schließen, wieder öffnen',
        params: idParam,
        body: z.discriminatedUnion('action', [
          z.object({ action: z.literal('claim') }),
          z.object({ action: z.literal('unclaim') }),
          z.object({ action: z.literal('assign'), assigneeDiscordId: snowflake.nullable(), team: z.string().max(40).nullable().optional() }),
          z.object({ action: z.literal('status'), status: z.enum(TICKET_STATUS).exclude(['closed']) }),
          z.object({ action: z.literal('priority'), priority: z.enum(TICKET_PRIORITY) }),
          z.object({ action: z.literal('close'), reason }),
          z.object({ action: z.literal('reopen'), reason }),
        ]),
      },
      config: { idempotent: true },
    },
    async (request) => support.updateTicket(core, request.actor, request.params.id, request.body),
  );
  app.post(
    '/tickets/:id/messages',
    { schema: { tags: ttags, summary: 'Nachricht oder interne Notiz', params: idParam, body: z.object({ body: text(4000), internal: z.boolean().default(false) }) }, config: { idempotent: true } },
    async (request) => support.addTicketMessage(core, request.actor, request.params.id, request.body),
  );

  // ---------------------------------------------------------------- Reports
  const rtags = ['Reports'];
  app.post(
    '/reports',
    {
      schema: { tags: rtags, summary: 'Spieler melden', body: z.object({ reportedRobloxId: robloxUserId.optional(), reportedDiscordId: snowflake.optional(), ruleReference: z.string().max(100).optional(), description: text(4000) }) },
      config: { idempotent: true, rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request) => support.createReport(core, request.actor, request.body),
  );
  app.get(
    '/reports',
    { schema: { tags: rtags, summary: 'Reports', querystring: paginationQuery.extend({ status: csvList, assignee: snowflake.optional(), reportedRobloxId: robloxUserId.optional(), reportedDiscordId: snowflake.optional() }) } },
    async (request) => support.listReports(core.db, request.actor, request.query),
  );
  app.get('/reports/:id', { schema: { tags: rtags, summary: 'Report mit Verlauf', params: idParam } }, async (request) => support.getReportDetail(core.db, request.actor, request.params.id));
  app.patch(
    '/reports/:id',
    {
      schema: { tags: rtags, summary: 'Report bearbeiten / abschließen', params: idParam, body: z.object({ status: z.enum(REPORT_STATUS).optional(), assigneeDiscordId: snowflake.nullable().optional(), resolution: z.string().max(2000).optional(), note: z.string().max(2000).optional() }) },
      config: { idempotent: true },
    },
    async (request) => support.updateReport(core, request.actor, request.params.id, request.body),
  );

  // ---------------------------------------------------------------- Fallberichte
  const ctags = ['Fallberichte'];
  const reference = z.object({ kind: z.enum(['url', 'report', 'ticket', 'moderation_action', 'discord_message']), value: z.string().max(500), label: z.string().max(100).optional() });
  app.post(
    '/cases',
    { schema: { tags: ctags, summary: 'Fallbericht anlegen', body: z.object({ title: text(150), summary: text(8000), subjectRobloxId: robloxUserId.optional(), subjectDiscordId: snowflake.optional(), references: z.array(reference).max(20).optional() }) }, config: { idempotent: true } },
    async (request) => support.createCase(core, request.actor, request.body),
  );
  app.get('/cases', { schema: { tags: ctags, summary: 'Fallberichte', querystring: paginationQuery.extend({ status: z.enum(['open', 'closed']).optional() }) } }, async (request) => support.listCases(core.db, request.actor, request.query));
  app.get('/cases/:id', { schema: { tags: ctags, summary: 'Fallbericht', params: idParam } }, async (request) => support.getCaseDetail(core.db, request.actor, request.params.id));
  app.patch(
    '/cases/:id',
    { schema: { tags: ctags, summary: 'Notiz, Referenz, schließen, wieder öffnen', params: idParam, body: z.object({ note: z.string().max(4000).optional(), addReference: reference.optional(), close: z.object({ reason }).optional(), reopen: z.boolean().optional() }) } },
    async (request) => support.updateCase(core, request.actor, request.params.id, request.body),
  );

  // ---------------------------------------------------------------- Moderation
  const mtags = ['Moderation'];
  app.post(
    '/moderation/actions',
    {
      schema: {
        tags: mtags,
        summary: 'Verwarnung, Timeout, Kick, Bann oder Notiz',
        body: z.object({
          type: z.enum(MODERATION_TYPES).exclude(['unban']),
          platform: z.enum(['discord', 'roblox']).default('discord'),
          targetDiscordId: snowflake.optional(),
          targetRobloxId: robloxUserId.optional(),
          reason,
          durationSeconds: z.number().int().min(60).max(365 * 86400).optional(),
          relatedReportId: z.uuid().optional(),
        }),
      },
      config: { idempotent: true },
    },
    async (request) => moderation.createModerationAction(core, request.actor, request.body),
  );
  app.get(
    '/moderation/actions',
    {
      schema: {
        tags: mtags,
        summary: 'Moderationshistorie mit Filtern',
        querystring: paginationQuery.extend({
          targetDiscordId: snowflake.optional(),
          targetRobloxId: robloxUserId.optional(),
          moderatorId: z.string().max(64).optional(),
          type: csvList.pipe(z.array(z.enum(MODERATION_TYPES)).optional()),
          status: csvList.pipe(z.array(z.enum(MODERATION_STATUS)).optional()),
          from: isoDate.optional(),
          to: isoDate.optional(),
        }),
      },
    },
    async (request) => moderation.listModerationActions(core.db, request.actor, request.query),
  );
  app.get('/moderation/actions/mine', { schema: { tags: mtags, summary: 'Eigene Moderationsvorgänge (für Einsprüche)' } }, async (request) => {
    requireAuthenticated(request);
    return { items: await moderation.ownModerationActions(core.db, (request.actor as { discordUserId: string }).discordUserId) };
  });
  app.get('/moderation/actions/:id', { schema: { tags: mtags, summary: 'Moderationsaktion', params: idParam } }, async (request) => {
    const action = await moderation.getModerationAction(core.db, request.params.id);
    const self = request.actor.kind === 'user' && action.targetDiscordId === request.actor.discordUserId;
    if (!self) requirePermission(request.actor, 'moderation:view');
    return action;
  });
  app.post('/moderation/actions/:id/revoke', { schema: { tags: mtags, summary: 'Aktion aufheben', params: idParam, body: z.object({ reason }) }, config: { idempotent: true } }, async (request) =>
    moderation.revokeModerationAction(core, request.actor, request.params.id, request.body.reason),
  );
  app.post(
    '/moderation/unban',
    { schema: { tags: mtags, summary: 'Bann aufheben', body: z.object({ platform: z.enum(['discord', 'roblox']).default('discord'), targetDiscordId: snowflake.optional(), targetRobloxId: robloxUserId.optional(), reason }) }, config: { idempotent: true } },
    async (request) => moderation.unbanTarget(core, request.actor, request.body),
  );
  app.post('/moderation/appeals', { schema: { tags: mtags, summary: 'Einspruch einlegen', body: z.object({ actionId: z.string().max(64), statement: text(4000) }) }, config: { idempotent: true } }, async (request) =>
    moderation.createAppeal(core, request.actor, request.body),
  );
  app.get('/moderation/appeals', { schema: { tags: mtags, summary: 'Einsprüche', querystring: paginationQuery.extend({ status: z.enum(['open', 'accepted', 'rejected']).optional() }) } }, async (request) =>
    moderation.listAppeals(core.db, request.actor, request.query),
  );
  app.post(
    '/moderation/appeals/:id/decide',
    { schema: { tags: mtags, summary: 'Einspruch entscheiden', params: idParam, body: z.object({ decision: z.enum(['accept', 'reject']), reason }) }, config: { idempotent: true } },
    async (request) => moderation.decideAppeal(core, request.actor, request.params.id, request.body.decision, request.body.reason),
  );
}
