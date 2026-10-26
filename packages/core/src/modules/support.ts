import {
  and,
  caseReferences,
  caseReports,
  desc,
  eq,
  inArray,
  recordEvents,
  reports,
  sql,
  tickets,
  type DbExecutor,
} from '@enrp/database';
import { errors, type RecordType } from '@enrp/shared';
import { type Actor, actorId, hasPermission, requirePermission, requireUser } from '../actor';
import { writeAudit } from '../audit';
import { type CoreContext } from '../context';
import { assertFeature, assertNotKilled } from '../flags';
import { getSetting } from '../settings';

// ---------------------------------------------------------------------------
// Zeitleisten (gemeinsam für Tickets, Reports, Fälle, Vorfälle, Einsprüche)
// ---------------------------------------------------------------------------

export async function addRecordEvent(
  db: DbExecutor,
  input: {
    recordType: RecordType;
    recordId: string;
    type: string;
    actorId?: string | null;
    body?: string | null;
    internal?: boolean;
    data?: unknown;
    at?: Date;
  },
) {
  const [row] = await db
    .insert(recordEvents)
    .values({
      recordType: input.recordType,
      recordId: input.recordId,
      type: input.type,
      actorId: input.actorId ?? null,
      body: input.body ?? null,
      internal: input.internal ?? false,
      data: (input.data ?? null) as never,
      createdAt: input.at ?? new Date(),
    })
    .returning();
  return row!;
}

export async function listRecordEvents(
  db: DbExecutor,
  recordType: RecordType,
  recordId: string,
  includeInternal: boolean,
) {
  return db
    .select()
    .from(recordEvents)
    .where(
      and(
        eq(recordEvents.recordType, recordType),
        eq(recordEvents.recordId, recordId),
        includeInternal ? undefined : eq(recordEvents.internal, false),
      ),
    )
    .orderBy(recordEvents.createdAt);
}

async function notify(
  ctx: CoreContext,
  channelKey: 'ticketChannelId' | 'reportChannelId',
  title: string,
  description: string,
) {
  const settings = await getSetting(ctx.db, 'notifications');
  const channelId = settings[channelKey];
  if (!channelId) return;
  await ctx.queue.enqueue('discord', 'message.send', { channelId, embed: { title, description, color: '#2563eb' } });
}

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------

export async function getTicket(db: DbExecutor, idOrNumber: string) {
  const isNumber = /^\d+$/.test(idOrNumber);
  const [row] = await db
    .select()
    .from(tickets)
    .where(
      isNumber
        ? eq(tickets.number, Number(idOrNumber))
        : sql`${tickets.id}::text = ${idOrNumber} or ${tickets.discordChannelId} = ${idOrNumber}`,
    );
  return row ?? null;
}

async function requireTicket(db: DbExecutor, idOrNumber: string) {
  const ticket = await getTicket(db, idOrNumber);
  if (!ticket) throw errors.notFound('Ticket');
  return ticket;
}

export async function createTicket(
  ctx: CoreContext,
  actor: Actor,
  input: {
    subject: string;
    category?: string;
    body?: string;
    priority?: 'low' | 'normal' | 'high' | 'urgent';
    discordChannelId?: string;
    creatorDiscordId?: string;
  },
) {
  await assertNotKilled(ctx.db);
  await assertFeature(ctx.db, 'tickets');
  const user = requireUser(actor);
  // Tickets im Namen anderer anlegen (z. B. Spiegelung aus dem Discord-Ticketpanel) erfordert tickets:create.
  const creator = input.creatorDiscordId ?? user.discordUserId;
  if (creator !== user.discordUserId) requirePermission(actor, 'tickets:create');
  const [open] = await ctx.db
    .select({ count: sql<number>`count(*)::int` })
    .from(tickets)
    .where(and(eq(tickets.creatorDiscordId, creator), sql`${tickets.status} <> 'closed'`));
  if (creator === user.discordUserId && (open?.count ?? 0) >= 3 && !hasPermission(actor, 'tickets:edit')) {
    throw errors.conflict('Du hast bereits 3 offene Tickets. Bitte warte, bis eines bearbeitet wurde.');
  }
  const now = ctx.now();
  const ticket = await ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .insert(tickets)
      .values({
        subject: input.subject,
        category: input.category ?? 'general',
        priority: input.priority ?? 'normal',
        creatorDiscordId: creator,
        discordChannelId: input.discordChannelId ?? null,
      })
      .returning();
    await addRecordEvent(tx, {
      recordType: 'ticket',
      recordId: row!.id,
      type: 'created',
      actorId: user.discordUserId,
      body: input.body ?? null,
      at: now,
    });
    await writeAudit(
      tx,
      actor,
      {
        action: 'ticket.create',
        resourceType: 'ticket',
        resourceId: row!.id,
        after: { subject: row!.subject, category: row!.category },
      },
      now,
    );
    return row!;
  });
  ctx.realtime.publish('tickets', 'ticket.created', { id: ticket.id, number: ticket.number, subject: ticket.subject });
  await notify(
    ctx,
    'ticketChannelId',
    `🎫 Neues Ticket #${ticket.number}`,
    `${ticket.subject}\nVon <@${creator}> · Kategorie ${ticket.category}`,
  );
  return ticket;
}

export async function listTickets(
  db: DbExecutor,
  actor: Actor,
  filter: {
    status?: string[];
    assignee?: string;
    creator?: string;
    q?: string;
    category?: string;
    page: number;
    pageSize: number;
    from?: Date;
    to?: Date;
  },
) {
  const user = requireUser(actor);
  const canViewAll = hasPermission(actor, 'tickets:view');
  const where = and(
    canViewAll ? undefined : eq(tickets.creatorDiscordId, user.discordUserId),
    filter.status?.length ? inArray(tickets.status, filter.status as never[]) : undefined,
    filter.assignee ? eq(tickets.assigneeDiscordId, filter.assignee) : undefined,
    filter.creator ? eq(tickets.creatorDiscordId, filter.creator) : undefined,
    filter.category ? eq(tickets.category, filter.category) : undefined,
    filter.q
      ? sql`(${tickets.subject} ilike ${`%${filter.q.replace(/[\\%_]/g, '')}%`} or ${tickets.number}::text = ${filter.q})`
      : undefined,
    filter.from ? sql`${tickets.createdAt} >= ${filter.from}` : undefined,
    filter.to ? sql`${tickets.createdAt} <= ${filter.to}` : undefined,
  );
  const items = await db
    .select()
    .from(tickets)
    .where(where)
    .orderBy(desc(tickets.createdAt))
    .limit(filter.pageSize)
    .offset((filter.page - 1) * filter.pageSize);
  const [total] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tickets)
    .where(where);
  return { items, total: total?.count ?? 0, page: filter.page, pageSize: filter.pageSize };
}

export async function getTicketDetail(db: DbExecutor, actor: Actor, idOrNumber: string) {
  const user = requireUser(actor);
  const ticket = await requireTicket(db, idOrNumber);
  if (ticket.creatorDiscordId !== user.discordUserId) requirePermission(actor, 'tickets:view');
  const internal = hasPermission(actor, 'ticket_internal:view');
  const events = await listRecordEvents(db, 'ticket', ticket.id, internal);
  return { ticket, events, canViewInternal: internal };
}

type TicketUpdate =
  | { action: 'claim' }
  | { action: 'unclaim' }
  | { action: 'assign'; assigneeDiscordId: string | null; team?: string | null }
  | { action: 'status'; status: 'open' | 'waiting' | 'claimed' }
  | { action: 'priority'; priority: 'low' | 'normal' | 'high' | 'urgent' }
  | { action: 'close'; reason: string }
  | { action: 'reopen'; reason: string };

export async function updateTicket(ctx: CoreContext, actor: Actor, idOrNumber: string, update: TicketUpdate) {
  await assertNotKilled(ctx.db);
  const user = requireUser(actor);
  const ticket = await requireTicket(ctx.db, idOrNumber);
  const isCreator = ticket.creatorDiscordId === user.discordUserId;
  // Ersteller dürfen ihr eigenes Ticket schließen, alles andere braucht tickets:edit.
  if (!(update.action === 'close' && isCreator)) requirePermission(actor, 'tickets:edit');
  if (ticket.status === 'closed' && update.action !== 'reopen')
    throw errors.invalidState('Das Ticket ist bereits geschlossen.');
  if (update.action === 'reopen' && ticket.status !== 'closed')
    throw errors.invalidState('Das Ticket ist nicht geschlossen.');

  const now = ctx.now();
  const patch: Partial<typeof tickets.$inferInsert> = {};
  let body: string | null = null;
  switch (update.action) {
    case 'claim':
      if (ticket.assigneeDiscordId && ticket.assigneeDiscordId !== user.discordUserId) {
        throw errors.conflict(`Das Ticket wird bereits von <@${ticket.assigneeDiscordId}> bearbeitet.`);
      }
      Object.assign(patch, { assigneeDiscordId: user.discordUserId, status: 'claimed' });
      break;
    case 'unclaim':
      Object.assign(patch, { assigneeDiscordId: null, status: 'open' });
      break;
    case 'assign':
      Object.assign(patch, {
        assigneeDiscordId: update.assigneeDiscordId,
        team: update.team ?? ticket.team,
        status: update.assigneeDiscordId ? 'claimed' : 'open',
      });
      break;
    case 'status':
      patch.status = update.status;
      break;
    case 'priority':
      patch.priority = update.priority;
      break;
    case 'close':
      Object.assign(patch, {
        status: 'closed',
        closedAt: now,
        closedBy: user.discordUserId,
        closeReason: update.reason,
      });
      body = update.reason;
      break;
    case 'reopen':
      Object.assign(patch, { status: 'open', closedAt: null, closedBy: null, closeReason: null });
      body = update.reason;
      break;
  }
  const updated = await ctx.db.transaction(async (tx) => {
    const [row] = await tx.update(tickets).set(patch).where(eq(tickets.id, ticket.id)).returning();
    await addRecordEvent(tx, {
      recordType: 'ticket',
      recordId: ticket.id,
      type: update.action,
      actorId: user.discordUserId,
      body,
      data: patch,
      at: now,
    });
    await writeAudit(
      tx,
      actor,
      {
        action: `ticket.${update.action}`,
        resourceType: 'ticket',
        resourceId: ticket.id,
        reason: body,
        before: { status: ticket.status, assignee: ticket.assigneeDiscordId, priority: ticket.priority },
        after: { status: row!.status, assignee: row!.assigneeDiscordId, priority: row!.priority },
      },
      now,
    );
    return row!;
  });
  ctx.realtime.publish('tickets', 'ticket.updated', { id: updated.id, number: updated.number, status: updated.status });
  return updated;
}

/** Nachrichten oder interne Notizen. Interne Notizen erfordern ticket_internal:create. */
export async function addTicketMessage(
  ctx: CoreContext,
  actor: Actor,
  idOrNumber: string,
  input: { body: string; internal: boolean },
) {
  const user = requireUser(actor);
  const ticket = await requireTicket(ctx.db, idOrNumber);
  if (input.internal) requirePermission(actor, 'ticket_internal:create');
  else if (ticket.creatorDiscordId !== user.discordUserId) requirePermission(actor, 'tickets:edit');
  if (ticket.status === 'closed') throw errors.invalidState('Das Ticket ist geschlossen.');
  return addRecordEvent(ctx.db, {
    recordType: 'ticket',
    recordId: ticket.id,
    type: input.internal ? 'note' : 'message',
    actorId: user.discordUserId,
    body: input.body,
    internal: input.internal,
    at: ctx.now(),
  });
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export async function createReport(
  ctx: CoreContext,
  actor: Actor,
  input: {
    reportedRobloxId?: number | null;
    reportedDiscordId?: string | null;
    ruleReference?: string | null;
    description: string;
  },
) {
  await assertNotKilled(ctx.db);
  await assertFeature(ctx.db, 'reports');
  const user = requireUser(actor);
  if (!input.reportedRobloxId && !input.reportedDiscordId) throw errors.badRequest('Bitte gib an, wen du meldest.');
  if (input.reportedDiscordId === user.discordUserId) throw errors.badRequest('Du kannst dich nicht selbst melden.');
  const [recent] = await ctx.db
    .select({ count: sql<number>`count(*)::int` })
    .from(reports)
    .where(
      and(eq(reports.reporterDiscordId, user.discordUserId), sql`${reports.createdAt} > now() - interval '1 hour'`),
    );
  if ((recent?.count ?? 0) >= 5) throw errors.conflict('Du hast in der letzten Stunde bereits 5 Reports erstellt.');
  const now = ctx.now();
  const report = await ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .insert(reports)
      .values({
        reporterDiscordId: user.discordUserId,
        reportedRobloxId: input.reportedRobloxId ?? null,
        reportedDiscordId: input.reportedDiscordId ?? null,
        ruleReference: input.ruleReference ?? null,
        description: input.description,
      })
      .returning();
    await addRecordEvent(tx, {
      recordType: 'report',
      recordId: row!.id,
      type: 'created',
      actorId: user.discordUserId,
      at: now,
    });
    await writeAudit(tx, actor, { action: 'report.create', resourceType: 'report', resourceId: row!.id }, now);
    return row!;
  });
  ctx.realtime.publish('reports', 'report.created', { id: report.id, number: report.number });
  await notify(
    ctx,
    'reportChannelId',
    `🚩 Neuer Report #${report.number}`,
    `${input.ruleReference ? `Regel: ${input.ruleReference}\n` : ''}Gemeldet von <@${user.discordUserId}>`,
  );
  return report;
}

export async function listReports(
  db: DbExecutor,
  actor: Actor,
  filter: {
    status?: string[];
    assignee?: string;
    reportedRobloxId?: number;
    reportedDiscordId?: string;
    page: number;
    pageSize: number;
    q?: string;
  },
) {
  requirePermission(actor, 'reports:view');
  const where = and(
    filter.status?.length ? inArray(reports.status, filter.status as never[]) : undefined,
    filter.assignee ? eq(reports.assigneeDiscordId, filter.assignee) : undefined,
    filter.reportedRobloxId ? eq(reports.reportedRobloxId, filter.reportedRobloxId) : undefined,
    filter.reportedDiscordId ? eq(reports.reportedDiscordId, filter.reportedDiscordId) : undefined,
    filter.q
      ? sql`(${reports.description} ilike ${`%${filter.q.replace(/[\\%_]/g, '')}%`} or ${reports.number}::text = ${filter.q})`
      : undefined,
  );
  const items = await db
    .select()
    .from(reports)
    .where(where)
    .orderBy(desc(reports.createdAt))
    .limit(filter.pageSize)
    .offset((filter.page - 1) * filter.pageSize);
  const [total] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(reports)
    .where(where);
  return { items, total: total?.count ?? 0, page: filter.page, pageSize: filter.pageSize };
}

export async function getReportDetail(db: DbExecutor, actor: Actor, idOrNumber: string) {
  const user = requireUser(actor);
  const isNumber = /^\d+$/.test(idOrNumber);
  const [report] = await db
    .select()
    .from(reports)
    .where(isNumber ? eq(reports.number, Number(idOrNumber)) : eq(reports.id, idOrNumber));
  if (!report) throw errors.notFound('Report');
  if (report.reporterDiscordId !== user.discordUserId) requirePermission(actor, 'reports:view');
  const events = await listRecordEvents(db, 'report', report.id, hasPermission(actor, 'reports:view'));
  return { report, events };
}

export async function updateReport(
  ctx: CoreContext,
  actor: Actor,
  idOrNumber: string,
  update: {
    status?: 'open' | 'in_review' | 'resolved' | 'rejected';
    assigneeDiscordId?: string | null;
    resolution?: string;
    note?: string;
  },
) {
  requirePermission(actor, 'reports:edit');
  const { report } = await getReportDetail(ctx.db, actor, idOrNumber);
  const final = update.status === 'resolved' || update.status === 'rejected';
  if (final && !update.resolution) throw errors.badRequest('Zum Abschließen ist eine Begründung erforderlich.');
  if (
    (report.status === 'resolved' || report.status === 'rejected') &&
    update.status &&
    !['open', 'in_review'].includes(update.status)
  ) {
    throw errors.invalidState('Der Report ist bereits abgeschlossen.');
  }
  const now = ctx.now();
  return ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .update(reports)
      .set({
        status: update.status ?? report.status,
        assigneeDiscordId: update.assigneeDiscordId === undefined ? report.assigneeDiscordId : update.assigneeDiscordId,
        resolution: update.resolution ?? report.resolution,
        resolvedBy: final ? actorId(actor) : report.resolvedBy,
        resolvedAt: final ? now : report.resolvedAt,
      })
      .where(eq(reports.id, report.id))
      .returning();
    await addRecordEvent(tx, {
      recordType: 'report',
      recordId: report.id,
      type: update.status ? `status.${update.status}` : 'updated',
      actorId: actorId(actor),
      body: update.resolution ?? update.note ?? null,
      internal: Boolean(update.note && !update.resolution),
      at: now,
    });
    await writeAudit(
      tx,
      actor,
      {
        action: 'report.update',
        resourceType: 'report',
        resourceId: report.id,
        reason: update.resolution,
        before: { status: report.status },
        after: { status: row!.status },
      },
      now,
    );
    return row!;
  });
}

// ---------------------------------------------------------------------------
// Fallberichte
// ---------------------------------------------------------------------------

/** Nur HTTPS-Links und Discord-Nachrichtenlinks werden als Referenzen akzeptiert. */
export function validateReference(kind: string, value: string): void {
  if (kind === 'url' || kind === 'discord_message') {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw errors.badRequest('Ungültige URL.');
    }
    if (url.protocol !== 'https:') throw errors.badRequest('Nur HTTPS-Links sind erlaubt.');
    if (kind === 'discord_message' && !/^(ptb\.|canary\.)?discord\.com$/.test(url.hostname))
      throw errors.badRequest('Kein Discord-Nachrichtenlink.');
  } else if (!/^[0-9a-f-]{36}$|^\d+$/i.test(value)) {
    throw errors.badRequest('Ungültige Referenz-ID.');
  }
}

export async function createCase(
  ctx: CoreContext,
  actor: Actor,
  input: {
    title: string;
    summary: string;
    subjectRobloxId?: number | null;
    subjectDiscordId?: string | null;
    references?: Array<{ kind: string; value: string; label?: string }>;
  },
) {
  requirePermission(actor, 'cases:create');
  for (const ref of input.references ?? []) validateReference(ref.kind, ref.value);
  const now = ctx.now();
  return ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .insert(caseReports)
      .values({
        title: input.title,
        summary: input.summary,
        subjectRobloxId: input.subjectRobloxId ?? null,
        subjectDiscordId: input.subjectDiscordId ?? null,
        createdBy: actorId(actor),
      })
      .returning();
    if (input.references?.length) {
      await tx
        .insert(caseReferences)
        .values(
          input.references.map((r) => ({
            caseId: row!.id,
            kind: r.kind as never,
            value: r.value,
            label: r.label ?? null,
            addedBy: actorId(actor),
          })),
        );
    }
    await addRecordEvent(tx, {
      recordType: 'case',
      recordId: row!.id,
      type: 'created',
      actorId: actorId(actor),
      at: now,
    });
    await writeAudit(
      tx,
      actor,
      { action: 'case.create', resourceType: 'case', resourceId: row!.id, after: { title: row!.title } },
      now,
    );
    return row!;
  });
}

export async function listCases(
  db: DbExecutor,
  actor: Actor,
  filter: { status?: string; q?: string; page: number; pageSize: number },
) {
  requirePermission(actor, 'cases:view');
  const where = and(
    filter.status ? eq(caseReports.status, filter.status as never) : undefined,
    filter.q
      ? sql`(${caseReports.title} ilike ${`%${filter.q.replace(/[\\%_]/g, '')}%`} or ${caseReports.number}::text = ${filter.q})`
      : undefined,
  );
  const items = await db
    .select()
    .from(caseReports)
    .where(where)
    .orderBy(desc(caseReports.createdAt))
    .limit(filter.pageSize)
    .offset((filter.page - 1) * filter.pageSize);
  const [total] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(caseReports)
    .where(where);
  return { items, total: total?.count ?? 0, page: filter.page, pageSize: filter.pageSize };
}

export async function getCaseDetail(db: DbExecutor, actor: Actor, idOrNumber: string) {
  requirePermission(actor, 'cases:view');
  const isNumber = /^\d+$/.test(idOrNumber);
  const [row] = await db
    .select()
    .from(caseReports)
    .where(isNumber ? eq(caseReports.number, Number(idOrNumber)) : eq(caseReports.id, idOrNumber));
  if (!row) throw errors.notFound('Fallbericht');
  const references = await db.select().from(caseReferences).where(eq(caseReferences.caseId, row.id));
  const events = await listRecordEvents(db, 'case', row.id, true);
  return { case: row, references, events };
}

export async function updateCase(
  ctx: CoreContext,
  actor: Actor,
  idOrNumber: string,
  input: {
    note?: string;
    addReference?: { kind: string; value: string; label?: string };
    close?: { reason: string };
    reopen?: boolean;
  },
) {
  requirePermission(actor, 'cases:edit');
  const { case: row } = await getCaseDetail(ctx.db, actor, idOrNumber);
  const now = ctx.now();
  return ctx.db.transaction(async (tx) => {
    if (input.addReference) {
      validateReference(input.addReference.kind, input.addReference.value);
      await tx.insert(caseReferences).values({
        caseId: row.id,
        kind: input.addReference.kind as never,
        value: input.addReference.value,
        label: input.addReference.label ?? null,
        addedBy: actorId(actor),
      });
      await addRecordEvent(tx, {
        recordType: 'case',
        recordId: row.id,
        type: 'reference_added',
        actorId: actorId(actor),
        data: input.addReference,
        at: now,
      });
    }
    if (input.note)
      await addRecordEvent(tx, {
        recordType: 'case',
        recordId: row.id,
        type: 'note',
        actorId: actorId(actor),
        body: input.note,
        internal: true,
        at: now,
      });
    if (input.close) {
      if (row.status === 'closed') throw errors.invalidState('Der Fall ist bereits geschlossen.');
      await tx
        .update(caseReports)
        .set({ status: 'closed', closedAt: now, closedBy: actorId(actor), closeReason: input.close.reason })
        .where(eq(caseReports.id, row.id));
      await addRecordEvent(tx, {
        recordType: 'case',
        recordId: row.id,
        type: 'closed',
        actorId: actorId(actor),
        body: input.close.reason,
        at: now,
      });
      await writeAudit(
        tx,
        actor,
        { action: 'case.close', resourceType: 'case', resourceId: row.id, reason: input.close.reason },
        now,
      );
    }
    if (input.reopen) {
      await tx
        .update(caseReports)
        .set({ status: 'open', closedAt: null, closedBy: null, closeReason: null })
        .where(eq(caseReports.id, row.id));
      await addRecordEvent(tx, {
        recordType: 'case',
        recordId: row.id,
        type: 'reopened',
        actorId: actorId(actor),
        at: now,
      });
      await writeAudit(tx, actor, { action: 'case.reopen', resourceType: 'case', resourceId: row.id }, now);
    }
    const [updated] = await tx.select().from(caseReports).where(eq(caseReports.id, row.id));
    return updated!;
  });
}

export async function supportCounts(db: DbExecutor) {
  const [t] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tickets)
    .where(sql`${tickets.status} <> 'closed'`);
  const [r] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(reports)
    .where(inArray(reports.status, ['open', 'in_review']));
  const [c] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(caseReports)
    .where(eq(caseReports.status, 'open'));
  return { openTickets: t?.count ?? 0, openReports: r?.count ?? 0, openCases: c?.count ?? 0 };
}

/**
 * Spiegelt Tickets aus dem Discord-Ticketpanel (Kanal je Ticket) in die Datenbank, damit sie im Dashboard
 * sichtbar sind. Nur der Bot (Service-Token) ruft dies auf; Berechtigungen prüft das Ticketpanel selbst.
 */
export async function syncDiscordTicket(
  ctx: CoreContext,
  input:
    | { event: 'open'; channelId: string; creatorId: string; subject: string; category: string }
    | { event: 'claim'; channelId: string; assigneeId: string | null }
    | { event: 'close'; channelId: string; closedBy: string | null; reason: string | null },
) {
  const now = ctx.now();
  const actor = { kind: 'system' as const, name: 'discord-ticketpanel' };
  return ctx.db.transaction(async (tx) => {
    if (input.event === 'open') {
      const [row] = await tx
        .insert(tickets)
        .values({
          subject: input.subject.slice(0, 150),
          category: input.category,
          creatorDiscordId: input.creatorId,
          discordChannelId: input.channelId,
        })
        .onConflictDoNothing()
        .returning();
      if (!row) return null;
      await addRecordEvent(tx, {
        recordType: 'ticket',
        recordId: row.id,
        type: 'created',
        actorId: input.creatorId,
        body: 'Über das Discord-Ticketpanel eröffnet',
        at: now,
      });
      await writeAudit(
        tx,
        actor,
        {
          action: 'ticket.create',
          resourceType: 'ticket',
          resourceId: row.id,
          metadata: { channelId: input.channelId },
        },
        now,
      );
      ctx.realtime.publish('tickets', 'ticket.created', { id: row.id, number: row.number, subject: row.subject });
      return row;
    }
    const [ticket] = await tx.select().from(tickets).where(eq(tickets.discordChannelId, input.channelId));
    if (!ticket || ticket.status === 'closed') return null;
    const patch =
      input.event === 'claim'
        ? { assigneeDiscordId: input.assigneeId, status: input.assigneeId ? ('claimed' as const) : ('open' as const) }
        : { status: 'closed' as const, closedAt: now, closedBy: input.closedBy ?? 'system', closeReason: input.reason };
    const [row] = await tx.update(tickets).set(patch).where(eq(tickets.id, ticket.id)).returning();
    const actorRef = input.event === 'claim' ? input.assigneeId : input.closedBy;
    await addRecordEvent(tx, {
      recordType: 'ticket',
      recordId: ticket.id,
      type: input.event === 'claim' ? (input.assigneeId ? 'claim' : 'unclaim') : 'close',
      actorId: actorRef,
      body: input.event === 'close' ? input.reason : null,
      at: now,
    });
    await writeAudit(
      tx,
      actor,
      {
        action: `ticket.${input.event}`,
        resourceType: 'ticket',
        resourceId: ticket.id,
        before: { status: ticket.status },
        after: { status: row!.status },
        metadata: { by: actorRef },
      },
      now,
    );
    ctx.realtime.publish('tickets', 'ticket.updated', { id: ticket.id, status: row!.status });
    return row!;
  });
}
