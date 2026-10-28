import { and, desc, eq, incidents, inArray, sql, type DbExecutor } from '@enrp/database';
import { errors } from '@enrp/shared';
import { type Actor, actorId, requirePermission } from '../actor';
import { writeAudit } from '../audit';
import { type CoreContext } from '../context';
import { getSetting } from '../settings';
import { isUniqueViolation } from '../util';
import { addRecordEvent, listRecordEvents } from './support';

type Severity = 'sev1' | 'sev2' | 'sev3' | 'sev4';
type Status = 'open' | 'investigating' | 'monitoring' | 'resolved';

export async function createIncident(
  ctx: CoreContext,
  actor: Actor,
  input: {
    title: string;
    description?: string;
    severity?: Severity;
    source?: string;
    dedupeKey?: string | null;
    assigneeId?: string | null;
  },
) {
  if (actor.kind !== 'system') requirePermission(actor, 'incidents:create');
  const now = ctx.now();
  try {
    const incident = await ctx.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(incidents)
        .values({
          title: input.title,
          description: input.description ?? '',
          severity: input.severity ?? 'sev3',
          source: input.source ?? (actor.kind === 'system' ? 'automation' : 'manual'),
          dedupeKey: input.dedupeKey ?? null,
          assigneeId: input.assigneeId ?? null,
          createdBy: actorId(actor),
        })
        .returning();
      await addRecordEvent(tx, {
        recordType: 'incident',
        recordId: row!.id,
        type: 'created',
        actorId: actorId(actor),
        body: input.description ?? null,
        at: now,
      });
      await writeAudit(
        tx,
        actor,
        {
          action: 'incident.create',
          resourceType: 'incident',
          resourceId: row!.id,
          after: { title: row!.title, severity: row!.severity },
        },
        now,
      );
      return row!;
    });
    ctx.realtime.publish('incidents', 'incident.created', {
      id: incident.id,
      number: incident.number,
      title: incident.title,
      severity: incident.severity,
    });
    const settings = await getSetting(ctx.db, 'notifications');
    if (settings.alertChannelId) {
      await ctx.queue.enqueue('discord', 'message.send', {
        channelId: settings.alertChannelId,
        embed: {
          title: `🚨 Vorfall #${incident.number} (${incident.severity.toUpperCase()})`,
          description: `${incident.title}\n${incident.description}`.slice(0, 3500),
          color: '#dc2626',
        },
      });
    }
    // Automatisch erzeugte Vorfälle lösen keine weitere Automatisierung aus (Schutz gegen Schleifen).
    if (incident.source !== 'automation') {
      const { fireTrigger } = await import('./automations');
      await fireTrigger(ctx, 'incident_created', {
        summary: `Vorfall #${incident.number}: ${incident.title}`,
        dedupeKey: `incident:${incident.id}`,
        depth: 1,
      });
    }
    return { incident, deduplicated: false };
  } catch (err) {
    if (input.dedupeKey && isUniqueViolation(err)) {
      const [existing] = await ctx.db
        .select()
        .from(incidents)
        .where(and(eq(incidents.dedupeKey, input.dedupeKey), sql`${incidents.status} <> 'resolved'`));
      if (existing) return { incident: existing, deduplicated: true };
    }
    throw err;
  }
}

export async function getIncident(db: DbExecutor, idOrNumber: string) {
  const isNumber = /^\d+$/.test(idOrNumber);
  const [row] = await db
    .select()
    .from(incidents)
    .where(isNumber ? eq(incidents.number, Number(idOrNumber)) : eq(incidents.id, idOrNumber));
  if (!row) throw errors.notFound('Vorfall');
  return row;
}

export async function getIncidentDetail(db: DbExecutor, actor: Actor, idOrNumber: string) {
  requirePermission(actor, 'incidents:view');
  const incident = await getIncident(db, idOrNumber);
  return { incident, events: await listRecordEvents(db, 'incident', incident.id, true) };
}

export async function updateIncident(
  ctx: CoreContext,
  actor: Actor,
  idOrNumber: string,
  update: { status?: Exclude<Status, 'resolved'>; severity?: Severity; assigneeId?: string | null; comment?: string },
) {
  requirePermission(actor, 'incidents:edit');
  const incident = await getIncident(ctx.db, idOrNumber);
  if (incident.status === 'resolved') throw errors.invalidState('Der Vorfall ist bereits abgeschlossen.');
  const now = ctx.now();
  const row = await ctx.db.transaction(async (tx) => {
    const [updated] = await tx
      .update(incidents)
      .set({
        status: update.status ?? incident.status,
        severity: update.severity ?? incident.severity,
        assigneeId: update.assigneeId === undefined ? incident.assigneeId : update.assigneeId,
      })
      .where(eq(incidents.id, incident.id))
      .returning();
    await addRecordEvent(tx, {
      recordType: 'incident',
      recordId: incident.id,
      type:
        update.comment && !update.status && !update.severity && update.assigneeId === undefined ? 'comment' : 'updated',
      actorId: actorId(actor),
      body: update.comment ?? null,
      data: update,
      at: now,
    });
    await writeAudit(
      tx,
      actor,
      {
        action: 'incident.update',
        resourceType: 'incident',
        resourceId: incident.id,
        before: { status: incident.status, severity: incident.severity, assigneeId: incident.assigneeId },
        after: { status: updated!.status, severity: updated!.severity, assigneeId: updated!.assigneeId },
      },
      now,
    );
    return updated!;
  });
  ctx.realtime.publish('incidents', 'incident.updated', { id: row.id, status: row.status });
  return row;
}

export async function resolveIncident(ctx: CoreContext, actor: Actor, idOrNumber: string, resolution: string) {
  if (actor.kind !== 'system') requirePermission(actor, 'incidents:edit');
  const incident = await getIncident(ctx.db, idOrNumber);
  if (incident.status === 'resolved') throw errors.invalidState('Der Vorfall ist bereits abgeschlossen.');
  const now = ctx.now();
  const row = await ctx.db.transaction(async (tx) => {
    const [updated] = await tx
      .update(incidents)
      .set({ status: 'resolved', resolution, resolvedAt: now, resolvedBy: actorId(actor) })
      .where(eq(incidents.id, incident.id))
      .returning();
    await addRecordEvent(tx, {
      recordType: 'incident',
      recordId: incident.id,
      type: 'resolved',
      actorId: actorId(actor),
      body: resolution,
      at: now,
    });
    await writeAudit(
      tx,
      actor,
      { action: 'incident.resolve', resourceType: 'incident', resourceId: incident.id, reason: resolution },
      now,
    );
    return updated!;
  });
  ctx.realtime.publish('incidents', 'incident.resolved', { id: row.id });
  return row;
}

export async function listIncidents(
  db: DbExecutor,
  actor: Actor,
  filter: { status?: string[]; severity?: string; page: number; pageSize: number },
) {
  requirePermission(actor, 'incidents:view');
  const where = and(
    filter.status?.length ? inArray(incidents.status, filter.status as never[]) : undefined,
    filter.severity ? eq(incidents.severity, filter.severity as never) : undefined,
  );
  const items = await db
    .select()
    .from(incidents)
    .where(where)
    .orderBy(desc(incidents.createdAt))
    .limit(filter.pageSize)
    .offset((filter.page - 1) * filter.pageSize);
  const [total] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(incidents)
    .where(where);
  return { items, total: total?.count ?? 0, page: filter.page, pageSize: filter.pageSize };
}

export async function openIncidentCount(db: DbExecutor) {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(incidents)
    .where(sql`${incidents.status} <> 'resolved'`);
  return row?.count ?? 0;
}
