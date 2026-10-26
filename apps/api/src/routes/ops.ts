import { type FastifyInstance } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  approvalActionTypes,
  automations,
  backups,
  cancelApproval,
  decideApproval,
  diffJson,
  duty,
  getApproval,
  incidents,
  listApprovals,
  monitoring,
  privacy,
  releases,
  requirePermission,
  retention,
  searchAudit,
  verifyAuditChain,
  writeAudit,
  createApproval,
  safeEqual,
} from '@enrp/core';
import { adminSessions, and, auditEvents, desc, eq, gt, isNull, securityEvents, sql } from '@enrp/database';
import { AUTOMATION_ACTIONS, AUTOMATION_TRIGGERS, AppError, errors, INCIDENT_SEVERITY } from '@enrp/shared';
import { activeAlerts, dependencyStatus, healthReport, overview } from '../lib/health';
import { requireAuthenticated } from '../plugins/auth';
import { csvList, idParam, isoDate, paginationQuery, reason, robloxUserId, snowflake } from './schemas';

const text = (max: number) => z.string().trim().min(1).max(max);

export async function opsRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const deps = app.deps;
  const { core } = deps;

  // ---------------------------------------------------------------- Monitoring
  const mtags = ['Monitoring'];
  app.get('/overview', { schema: { tags: mtags, summary: 'Dashboard-Übersicht (nur echte Werte)' } }, async (request) => {
    requirePermission(request.actor, 'monitoring:view');
    return overview(deps);
  });
  app.get('/monitoring/health', { schema: { tags: mtags, summary: '/ops health' } }, async (request) => {
    requirePermission(request.actor, 'monitoring:view');
    return healthReport(deps);
  });
  app.get('/monitoring/metrics', { schema: { tags: mtags, summary: '/ops metrics' } }, async (request) => {
    requirePermission(request.actor, 'monitoring:view');
    return { api: deps.metrics.snapshot(), onDuty: await duty.onDutyCounts(core.db) };
  });
  app.get('/monitoring/dependencies', { schema: { tags: mtags, summary: '/ops dependencies' } }, async (request) => {
    requirePermission(request.actor, 'monitoring:view');
    return { items: await dependencyStatus(deps) };
  });
  app.get('/monitoring/queues', { schema: { tags: mtags, summary: '/ops queue' } }, async (request) => {
    requirePermission(request.actor, 'jobs:view');
    if (!deps.bullQueue) return { configured: false, queues: null, failed: [], recentRuns: await monitoring.listJobRuns(core.db, { limit: 50 }) };
    return { configured: true, queues: await deps.bullQueue.counts(), failed: await deps.bullQueue.failedJobs(20), recentRuns: await monitoring.listJobRuns(core.db, { limit: 50 }) };
  });
  app.post('/monitoring/queues/:queue/jobs/:jobId/retry', { schema: { tags: mtags, summary: 'Fehlgeschlagenen Job erneut ausführen', params: z.object({ queue: z.enum(['discord', 'maintenance', 'backups', 'automations']), jobId: z.string().max(100) }) } }, async (request) => {
    requirePermission(request.actor, 'jobs:edit');
    if (!deps.bullQueue) throw errors.notConfigured('Warteschlange (REDIS_URL)');
    const ok = await deps.bullQueue.retry(request.params.queue, request.params.jobId);
    if (!ok) throw errors.notFound('Job');
    await writeAudit(core.db, request.actor, { action: 'job.retry', resourceType: 'job', resourceId: `${request.params.queue}:${request.params.jobId}` }, core.now());
    return { ok: true };
  });
  app.get('/monitoring/alerts', { schema: { tags: mtags, summary: '/ops alerts' } }, async (request) => {
    requirePermission(request.actor, 'monitoring:view');
    return { items: await activeAlerts(deps) };
  });
  app.get('/monitoring/jobs', { schema: { tags: mtags, summary: 'Jobhistorie', querystring: z.object({ queue: z.string().max(40).optional(), status: z.string().max(20).optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }) } }, async (request) => {
    requirePermission(request.actor, 'jobs:view');
    return { items: await monitoring.listJobRuns(core.db, request.query), stats: await monitoring.jobStats(core.db, new Date(core.now().getTime() - 86400_000)) };
  });
  // Lebenszeichen von Bot und Worker.
  app.post(
    '/monitoring/heartbeat',
    { schema: { tags: mtags, summary: 'Lebenszeichen eines Dienstes (Bot)', body: z.object({ service: z.enum(['bot', 'worker']), instanceId: z.string().max(100), version: z.string().max(40).optional(), info: z.record(z.string(), z.unknown()).optional() }) } },
    async (request) => {
      if (request.authMethod !== 'bot') throw new AppError('FORBIDDEN', 'Nur für Dienste.');
      await monitoring.recordServiceHeartbeat(core.db, request.body, core.now());
      return { ok: true };
    },
  );

  // ---------------------------------------------------------------- Vorfälle
  const itags = ['Vorfälle'];
  app.post(
    '/incidents',
    { schema: { tags: itags, summary: 'Vorfall erstellen', body: z.object({ title: text(200), description: z.string().max(4000).optional(), severity: z.enum(INCIDENT_SEVERITY).optional(), assigneeId: snowflake.optional() }) }, config: { idempotent: true } },
    async (request) => (await incidents.createIncident(core, request.actor, request.body)).incident,
  );
  app.get('/incidents', { schema: { tags: itags, summary: 'Vorfälle', querystring: paginationQuery.extend({ status: csvList, severity: z.enum(INCIDENT_SEVERITY).optional() }) } }, async (request) =>
    incidents.listIncidents(core.db, request.actor, request.query),
  );
  app.get('/incidents/:id', { schema: { tags: itags, summary: 'Vorfall mit Verlauf', params: idParam } }, async (request) => incidents.getIncidentDetail(core.db, request.actor, request.params.id));
  app.patch(
    '/incidents/:id',
    {
      schema: {
        tags: itags,
        summary: 'Status, Priorität, Zuweisung, Kommentar',
        params: idParam,
        body: z.object({ status: z.enum(['open', 'investigating', 'monitoring']).optional(), severity: z.enum(INCIDENT_SEVERITY).optional(), assigneeId: snowflake.nullable().optional(), comment: z.string().max(4000).optional() }),
      },
    },
    async (request) => incidents.updateIncident(core, request.actor, request.params.id, request.body),
  );
  app.post('/incidents/:id/resolve', { schema: { tags: itags, summary: 'Vorfall abschließen', params: idParam, body: z.object({ resolution: text(4000) }) } }, async (request) =>
    incidents.resolveIncident(core, request.actor, request.params.id, request.body.resolution),
  );

  // ---------------------------------------------------------------- Freigaben
  const atags = ['Freigabezentrum'];
  app.get('/approvals', { schema: { tags: atags, summary: 'Freigabeanfragen', querystring: z.object({ status: z.enum(['pending', 'approved', 'rejected', 'expired', 'executed', 'cancelled']).optional() }) } }, async (request) => {
    requirePermission(request.actor, 'approvals:view');
    return { items: await listApprovals(core.db, request.query.status), actionTypes: approvalActionTypes() };
  });
  app.get('/approvals/:id', { schema: { tags: atags, summary: 'Freigabeanfrage', params: idParam } }, async (request) => {
    requirePermission(request.actor, 'approvals:view');
    const row = await getApproval(core.db, request.params.id);
    if (!row) throw errors.notFound('Freigabeanfrage');
    return row;
  });
  app.post(
    '/approvals',
    { schema: { tags: atags, summary: '/approval create – generische Freigabe beantragen', body: z.object({ actionType: z.string().max(60), summary: text(300), payload: z.record(z.string(), z.unknown()), reason }) } },
    async (request) => {
      requirePermission(request.actor, 'approvals:create');
      return createApproval(core, request.actor, request.body);
    },
  );
  app.post('/approvals/:id/decide', { schema: { tags: atags, summary: 'Genehmigen oder ablehnen', params: idParam, body: z.object({ decision: z.enum(['approve', 'reject']), reason }) }, config: { idempotent: true } }, async (request) =>
    decideApproval(core, request.actor, request.params.id, request.body.decision, request.body.reason),
  );
  app.post('/approvals/:id/cancel', { schema: { tags: atags, summary: 'Eigene Anfrage zurückziehen', params: idParam, body: z.object({ reason }) } }, async (request) =>
    cancelApproval(core, request.actor, request.params.id, request.body.reason),
  );

  // ---------------------------------------------------------------- Releases & Umgebungen
  const rtags = ['Releases & Umgebungen'];
  app.get('/environments', { schema: { tags: rtags, summary: '/env status' } }, async (request) => {
    requirePermission(request.actor, 'releases:view');
    return { items: await releases.listEnvironments(core.db) };
  });
  app.get('/environments/compare', { schema: { tags: rtags, summary: '/env compare', querystring: z.object({ a: z.string().max(20), b: z.string().max(20) }) } }, async (request) => {
    requirePermission(request.actor, 'releases:view');
    return releases.compareEnvironments(core.db, request.query.a, request.query.b);
  });
  app.get('/releases', { schema: { tags: rtags, summary: '/deploy history', querystring: z.object({ environment: z.string().max(20).optional(), limit: z.coerce.number().int().min(1).max(100).default(25) }) } }, async (request) => {
    requirePermission(request.actor, 'releases:view');
    return { items: await releases.listReleases(core.db, request.query) };
  });
  app.post(
    '/releases',
    {
      schema: {
        tags: rtags,
        summary: '/deploy prepare, /deploy rollback, /env promote',
        body: z.object({ version: z.string().max(40), environment: z.string().max(20), commitSha: z.string().max(40).optional(), notes: z.string().max(4000).optional(), kind: z.enum(['deploy', 'rollback', 'promote']).optional() }),
      },
      config: { idempotent: true },
    },
    async (request) => releases.prepareRelease(core, request.actor, request.body),
  );
  app.post('/releases/:id/approve', { schema: { tags: rtags, summary: '/deploy approve (Vier-Augen-Prinzip)', params: idParam, body: z.object({ reason }) }, config: { idempotent: true } }, async (request) =>
    releases.approveRelease(core, request.actor, request.params.id, request.body.reason),
  );
  app.post('/releases/:id/cancel', { schema: { tags: rtags, summary: 'Vorbereitetes Release abbrechen', params: idParam, body: z.object({ reason }) } }, async (request) =>
    releases.cancelRelease(core, request.actor, request.params.id, request.body.reason),
  );
  // Rückmeldung der CI/CD-Pipeline, abgesichert über ein gemeinsames Geheimnis.
  app.post(
    '/releases/:id/result',
    { schema: { tags: rtags, summary: 'Pipeline-Rückmeldung (Header X-Release-Secret)', params: idParam, body: z.object({ status: z.enum(['deploying', 'deployed', 'failed']), pipelineRunUrl: z.url().max(500).optional(), failureReason: z.string().max(1000).optional() }) } },
    async (request) => {
      const secret = deps.env.RELEASE_WEBHOOK_SECRET;
      const given = request.headers['x-release-secret'];
      if (!secret || typeof given !== 'string' || !safeEqual(given, secret)) throw new AppError('UNAUTHENTICATED', 'Ungültiges Release-Geheimnis.');
      return releases.markReleaseResult(core, request.params.id, request.body);
    },
  );

  // ---------------------------------------------------------------- Backups
  const btags = ['Backups'];
  app.get('/backups', { schema: { tags: btags, summary: 'Backup-Status und -Historie' } }, async (request) => {
    requirePermission(request.actor, 'backups:view');
    return { health: await backups.backupHealth(core.db, core.now()), items: await backups.listBackups(core.db, 50), restores: await backups.listRestoreRequests(core.db, 20) };
  });
  app.post('/backups/run', { schema: { tags: btags, summary: 'Backup jetzt ausführen' } }, async (request) => backups.requestBackup(core, request.actor));
  app.post(
    '/backups/:id/restore',
    { schema: { tags: btags, summary: 'Wiederherstellung beantragen (Vorschau + Freigabe)', params: idParam, body: z.object({ targetEnvironment: z.enum(['development', 'staging', 'production', 'restore_test']), reason }) } },
    async (request) => backups.requestRestore(core, request.actor, { backupId: request.params.id, ...request.body }),
  );

  // ---------------------------------------------------------------- Automatisierungen
  const autags = ['Automatisierungen'];
  app.get('/automations', { schema: { tags: autags, summary: '/automation list' } }, async (request) => {
    requirePermission(request.actor, 'automations:view');
    return { items: await automations.listAutomations(core.db), triggers: AUTOMATION_TRIGGERS, actions: AUTOMATION_ACTIONS };
  });
  app.post('/automations', { schema: { tags: autags, summary: '/automation create', body: automations.automationInput.extend({ reason }) } }, async (request) => {
    const { reason: r, ...input } = request.body;
    return automations.createAutomation(core, request.actor, input, r);
  });
  app.post('/automations/:id/enabled', { schema: { tags: autags, summary: '/automation pause|resume', params: idParam, body: z.object({ enabled: z.boolean(), reason }) } }, async (request) =>
    automations.setAutomationEnabled(core, request.actor, request.params.id, request.body.enabled, request.body.reason),
  );
  app.post('/automations/:id/delete', { schema: { tags: autags, summary: 'Löschen', params: idParam, body: z.object({ reason }) } }, async (request) =>
    automations.deleteAutomation(core, request.actor, request.params.id, request.body.reason),
  );
  app.post('/automations/:id/test', { schema: { tags: autags, summary: '/automation test (Probelauf ohne Wirkung)', params: idParam, body: z.object({ count: z.number().int().min(0).max(100).optional(), service: z.string().max(40).optional() }) } }, async (request) =>
    automations.testAutomation(core, request.actor, request.params.id, { ...request.body, summary: 'Probelauf' }),
  );
  app.get('/automations/history', { schema: { tags: autags, summary: '/automation history', querystring: z.object({ ruleId: z.uuid().optional() }) } }, async (request) => {
    requirePermission(request.actor, 'automations:view');
    return { items: await automations.automationHistory(core.db, request.query.ruleId) };
  });

  // ---------------------------------------------------------------- Datenschutz
  const dtags = ['Datenschutz'];
  const subject = z.object({ discordUserId: snowflake.optional(), robloxUserId: robloxUserId.optional() });
  app.post('/privacy/inspect', { schema: { tags: dtags, summary: '/data inspect', body: subject } }, async (request) => privacy.inspectSubject(core.db, request.actor, request.body));
  app.post('/privacy/export', { schema: { tags: dtags, summary: '/data export', body: subject.extend({ reason }) }, config: { idempotent: true } }, async (request) => privacy.exportSubject(core, request.actor, request.body));
  app.get('/privacy/exports/:id', { schema: { tags: dtags, summary: 'Datenauskunft herunterladen', params: idParam } }, async (request, reply) => {
    const data = await privacy.getPrivacyExport(core, request.actor, request.params.id);
    reply.header('content-disposition', `attachment; filename="datenauskunft-${request.params.id}.json"`);
    return data;
  });
  app.post('/privacy/deletion', { schema: { tags: dtags, summary: '/data deletion-request (Vier-Augen-Freigabe)', body: subject.extend({ reason }) }, config: { idempotent: true } }, async (request) =>
    privacy.requestDeletion(core, request.actor, request.body),
  );
  app.get('/privacy/requests', { schema: { tags: dtags, summary: 'Datenschutzanfragen' } }, async (request) => ({ items: await privacy.listPrivacyRequests(core.db, request.actor) }));
  app.get('/privacy/retention', { schema: { tags: dtags, summary: '/data retention & /data cleanup-preview' } }, async (request) => {
    requirePermission(request.actor, 'privacy:view');
    return { items: await retention.retentionPreview(core.db, core.now()) };
  });

  // ---------------------------------------------------------------- Audit
  const autTags = ['Audit'];
  const auditFilter = z.object({ actorId: z.string().max(64).optional(), action: z.string().max(60).optional(), resourceType: z.string().max(40).optional(), resourceId: z.string().max(64).optional(), from: isoDate.optional(), to: isoDate.optional() });
  app.get('/audit', { schema: { tags: autTags, summary: '/audit search', querystring: auditFilter.extend({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(50) }) } }, async (request) => {
    requirePermission(request.actor, 'audit:view');
    return searchAudit(core.db, request.query);
  });
  app.get('/audit/verify', { schema: { tags: autTags, summary: '/audit verify – Hash-Kette prüfen' } }, async (request) => {
    requirePermission(request.actor, 'audit:view');
    const result = await verifyAuditChain(core.db);
    await writeAudit(core.db, request.actor, { action: 'audit.verify', resourceType: 'audit', metadata: { ok: result.ok, checked: result.checked } }, core.now());
    return result;
  });
  app.get('/audit/retention', { schema: { tags: autTags, summary: '/audit retention' } }, async (request) => {
    requirePermission(request.actor, 'audit:view');
    const items = await retention.retentionPreview(core.db, core.now());
    const [oldest] = await core.db.select({ at: auditEvents.occurredAt }).from(auditEvents).orderBy(auditEvents.id).limit(1);
    return { rule: items.find((i) => i.key === 'audit_events'), oldestEntry: oldest?.at ?? null };
  });
  app.get('/audit/:id', { schema: { tags: autTags, summary: '/audit diff', params: z.object({ id: z.coerce.number().int().positive() }) } }, async (request) => {
    requirePermission(request.actor, 'audit:view');
    const [row] = await core.db.select().from(auditEvents).where(eq(auditEvents.id, request.params.id));
    if (!row) throw errors.notFound('Audit-Eintrag');
    return { event: row, diff: diffJson(row.before, row.after) };
  });
  app.post('/audit/export', { schema: { tags: autTags, summary: '/audit export (max. 31 Tage, 10 000 Einträge)', body: auditFilter.extend({ from: isoDate, to: isoDate, reason }) } }, async (request) => {
    requirePermission(request.actor, 'audit:export');
    const { reason: r, ...filter } = request.body;
    if (filter.to.getTime() - filter.from.getTime() > 31 * 86400_000 || filter.to < filter.from) throw errors.badRequest('Zeitraum muss zwischen 0 und 31 Tagen liegen.');
    const result = await searchAudit(core.db, { ...filter, page: 1, pageSize: 10_000 });
    await writeAudit(core.db, request.actor, { action: 'audit.export', resourceType: 'audit', reason: r, metadata: { ...filter, rows: result.items.length } }, core.now());
    return { exportedAt: core.now(), filter, total: result.total, truncated: result.total > result.items.length, items: result.items };
  });

  // ---------------------------------------------------------------- Sicherheit
  const stags = ['Sicherheit'];
  app.get('/security/events', { schema: { tags: stags, summary: 'Sicherheitsereignisse', querystring: z.object({ type: z.string().max(60).optional(), limit: z.coerce.number().int().min(1).max(500).default(100) }) } }, async (request) => {
    requirePermission(request.actor, 'security:view');
    return {
      items: await core.db.select().from(securityEvents).where(request.query.type ? eq(securityEvents.type, request.query.type) : undefined).orderBy(desc(securityEvents.occurredAt)).limit(request.query.limit),
      summary: (await core.db.execute<{ type: string; c: number }>(sql`select type, count(*)::int as c from security_events where occurred_at > now() - interval '24 hours' group by type order by c desc`)).rows,
    };
  });
  app.get('/security/sessions', { schema: { tags: stags, summary: 'Aktive Admin-Sitzungen' } }, async (request) => {
    requirePermission(request.actor, 'security:view');
    return {
      items: await core.db
        .select({ id: adminSessions.id, discordUserId: adminSessions.discordUserId, createdAt: adminSessions.createdAt, lastSeenAt: adminSessions.lastSeenAt, expiresAt: adminSessions.expiresAt, userAgent: adminSessions.userAgent })
        .from(adminSessions)
        .where(and(isNull(adminSessions.revokedAt), gt(adminSessions.expiresAt, core.now())))
        .orderBy(desc(adminSessions.lastSeenAt)),
    };
  });
  app.post('/security/sessions/:id/revoke', { schema: { tags: stags, summary: 'Sitzung beenden', params: idParam, body: z.object({ reason }) } }, async (request) => {
    requireAuthenticated(request);
    const actor = request.actor as { discordUserId: string };
    const [session] = await core.db.select().from(adminSessions).where(eq(adminSessions.id, request.params.id));
    if (!session) throw errors.notFound('Sitzung');
    if (session.discordUserId !== actor.discordUserId) requirePermission(request.actor, 'security:edit');
    await core.db.update(adminSessions).set({ revokedAt: core.now(), revokedBy: actor.discordUserId }).where(eq(adminSessions.id, session.id));
    await writeAudit(core.db, request.actor, { action: 'session.revoke', resourceType: 'session', resourceId: session.id, reason: request.body.reason }, core.now());
    return { ok: true };
  });
}
