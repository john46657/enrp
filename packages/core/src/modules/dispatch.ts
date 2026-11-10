import { z } from 'zod';
import {
  and,
  desc,
  dispatchAssignments,
  dispatchIncidents,
  dispatchUnits,
  discordUsers,
  eq,
  gameServers,
  ilike,
  inArray,
  isNull,
  modCalls,
  or,
  sql,
  accountLinks,
  type DbExecutor,
} from '@enrp/database';
import { DISPATCH_OPEN_STATUS, DISPATCH_STATUS, UNIT_STATUS, errors, type DispatchStatus } from '@enrp/shared';
import { type Actor, type UserActor, actorId, requirePermission, requireUser } from '../actor';
import { writeAudit } from '../audit';
import { type CoreContext, type TxContext } from '../context';
import { getSetting } from '../settings';
import { likePattern } from '../util';
import { queuePlayerMessage } from './game';
import { findOnlinePlayer } from './live';
import { addRecordEvent, listRecordEvents } from './support';

/**
 * Leitstelle (CAD/Dispatch): Einsätze aus echten Ingame-Notrufen und eigene Einsätze, Einheiten mit Status,
 * Zuweisungen, Notizen, Abschluss mit Bericht und Mod-Calls aus dem Spiel. Jede Änderung durch Personen steht im
 * Audit-Log; der Verlauf jedes Einsatzes liegt in record_events (Typ „dispatch“).
 */

export const STATUS_LABEL: Record<DispatchStatus, string> = {
  open: 'Offen',
  assigned: 'Zugewiesen',
  en_route: 'Anfahrt',
  on_scene: 'Vor Ort',
  closed: 'Abgeschlossen',
};
export const UNIT_STATUS_LABEL: Record<(typeof UNIT_STATUS)[number], string> = {
  available: 'Status 2 · Einsatzbereit',
  en_route: 'Status 3 · Anfahrt',
  on_scene: 'Status 4 · Am Einsatzort',
  busy: 'Status 5 · Beschäftigt',
  off_duty: 'Status 6 · Außer Dienst',
};
const OPEN = new Set<string>(DISPATCH_OPEN_STATUS);

type Incident = typeof dispatchIncidents.$inferSelect;

// ---------------------------------------------------------------------------
// Einsätze
// ---------------------------------------------------------------------------

export const createIncidentSchema = z.object({
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().max(2000).optional(),
  location: z.string().trim().min(1).max(120),
  priority: z.number().int().min(1).max(3).optional(),
  department: z.string().trim().min(1).max(40).optional(),
});

async function departments(db: DbExecutor) {
  return (await getSetting(db, 'dispatch')).departments;
}

export async function getIncident(db: DbExecutor, idOrNumber: string) {
  const isNumber = /^\d+$/.test(idOrNumber);
  const isUuid = /^[0-9a-f-]{36}$/i.test(idOrNumber);
  if (!isNumber && !isUuid) throw errors.notFound('Einsatz');
  const [row] = await db
    .select()
    .from(dispatchIncidents)
    .where(isNumber ? eq(dispatchIncidents.number, Number(idOrNumber)) : eq(dispatchIncidents.id, idOrNumber));
  if (!row) throw errors.notFound('Einsatz');
  return row;
}

function publish(ctx: CoreContext, type: string, incident: Incident) {
  ctx.realtime.publish('dispatch', type, {
    id: incident.id,
    number: incident.number,
    status: incident.status,
    source: incident.source,
    title: incident.title,
  });
}

/** Discord-Nachricht des Einsatzes anlegen bzw. aktualisieren (Worker). */
async function syncDiscord(ctx: CoreContext, incident: Incident) {
  if (incident.discordMessageId) {
    await ctx.queue.enqueue('discord', 'dispatch.refresh', { incidentId: incident.id });
    return;
  }
  const settings = await getSetting(ctx.db, 'dispatch');
  if (settings.channelId) await ctx.queue.enqueue('discord', 'dispatch.post', { incidentId: incident.id });
}

/** Eigener Einsatz der Leitstelle (Discord oder Dashboard). */
export async function createIncident(ctx: CoreContext, actor: Actor, input: z.infer<typeof createIncidentSchema>) {
  requirePermission(actor, 'dispatch:create');
  const user = requireUser(actor);
  const allowed = await departments(ctx.db);
  const department = input.department ?? allowed[0]!;
  if (!allowed.includes(department)) throw errors.badRequest(`Unbekannter Bereich „${department}“.`);
  const now = ctx.now();
  const incident = await ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .insert(dispatchIncidents)
      .values({
        source: user.via === 'bot' ? 'discord' : 'dashboard',
        title: input.title,
        description: input.description ?? '',
        location: input.location,
        priority: input.priority ?? 2,
        department,
        createdBy: actorId(actor),
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    await addRecordEvent(tx, {
      recordType: 'dispatch',
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
        action: 'dispatch.create',
        resourceType: 'dispatch_incident',
        resourceId: row!.id,
        after: { number: row!.number, title: row!.title, priority: row!.priority, department },
      },
      now,
    );
    return row!;
  });
  publish(ctx, 'dispatch.created', incident);
  await syncDiscord(ctx, incident);
  return incident;
}

type CallData = {
  userId: number;
  username?: string;
  department?: string;
  text: string;
  location?: string;
  position?: { x: number; z: number };
  callNumber?: number;
};

/** Ingame-Notruf → Einsatz (idempotent über die Ereignis-ID). Läuft in der Transaktion des Spielereignisses. */
export async function createIncidentFromCall(ctx: TxContext, serverId: string, eventId: string, data: CallData) {
  const allowed = await departments(ctx.db);
  const department =
    allowed.find((d) => d.toLowerCase() === (data.department ?? '').toLowerCase()) ?? data.department ?? allowed[0]!;
  const now = ctx.now();
  const [row] = await ctx.db
    .insert(dispatchIncidents)
    .values({
      source: 'ingame',
      title: `Notruf: ${data.text.slice(0, 80)}`,
      description: data.text,
      location: [
        data.location,
        data.position ? `X ${Math.round(data.position.x)} · Z ${Math.round(data.position.z)}` : null,
      ]
        .filter(Boolean)
        .join(' · '),
      priority: 2,
      department,
      serverId,
      callerRobloxId: data.userId,
      callerName: data.username ?? null,
      callNumber: data.callNumber ?? null,
      position: data.position ?? null,
      sourceEventId: eventId,
      createdBy: 'system:ingame',
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning();
  if (!row) return { status: 'ok', duplicate: true };
  await addRecordEvent(ctx.db, {
    recordType: 'dispatch',
    recordId: row.id,
    type: 'created',
    actorId: null,
    body: `Notruf aus dem Spiel${data.callNumber ? ` (#${data.callNumber})` : ''} von ${data.username ?? data.userId}`,
    at: now,
  });
  return { status: 'ok', dispatchIncidentId: row.id, number: row.number };
}

/** Nach dem Speichern eines Spielereignisses: Discord-Nachricht und Live-Update. */
export async function afterGameEvent(ctx: CoreContext, type: string, result: unknown) {
  const r = (result ?? {}) as { dispatchIncidentId?: string; modCallId?: string };
  if (type === 'emergency_call' && r.dispatchIncidentId) {
    const incident = await getIncident(ctx.db, r.dispatchIncidentId);
    publish(ctx, 'dispatch.created', incident);
    await syncDiscord(ctx, incident);
  }
  if (type === 'mod_call' && r.modCallId) {
    const call = await getModCall(ctx.db, r.modCallId);
    ctx.realtime.publish('mod_calls', 'mod_call.created', { id: call.id, number: call.number });
    const settings = await getSetting(ctx.db, 'dispatch');
    if (settings.modCallChannelId) await ctx.queue.enqueue('discord', 'modcall.post', { modCallId: call.id });
  }
}

async function unitName(db: DbExecutor, unitId: string) {
  const [unit] = await db.select().from(dispatchUnits).where(eq(dispatchUnits.unitId, unitId));
  if (unit?.callsign) return unit.callsign;
  const [user] = await db.select().from(discordUsers).where(eq(discordUsers.id, unitId));
  return user?.globalName ?? user?.username ?? 'Eine Einheit';
}

/** Änderungen durch Personen: Transaktion mit Verlauf und Audit, danach Live-Update und Discord. */
async function mutate(
  ctx: CoreContext,
  actor: Actor,
  idOrNumber: string,
  action: string,
  change: (
    tx: DbExecutor,
    incident: Incident,
    now: Date,
  ) => Promise<{ event: string; body?: string | null; after?: unknown }>,
) {
  requirePermission(actor, 'dispatch:edit');
  const now = ctx.now();
  const current = await getIncident(ctx.db, idOrNumber);
  const updated = await ctx.db.transaction(async (tx) => {
    // Zeile sperren, damit gleichzeitige Klicks nacheinander laufen
    const [locked] = await tx
      .select()
      .from(dispatchIncidents)
      .where(eq(dispatchIncidents.id, current.id))
      .for('update');
    const result = await change(tx, locked!, now);
    await addRecordEvent(tx, {
      recordType: 'dispatch',
      recordId: current.id,
      type: result.event,
      actorId: actorId(actor),
      body: result.body ?? null,
      at: now,
    });
    await writeAudit(
      tx,
      actor,
      { action, resourceType: 'dispatch_incident', resourceId: current.id, after: result.after ?? null },
      now,
    );
    const [row] = await tx.select().from(dispatchIncidents).where(eq(dispatchIncidents.id, current.id));
    return row!;
  });
  publish(ctx, 'dispatch.updated', updated);
  await syncDiscord(ctx, updated);
  return updated;
}

function requireOpen(incident: Incident) {
  if (!OPEN.has(incident.status)) throw errors.badRequest('Der Einsatz ist bereits abgeschlossen.');
}

/** Einheit (Person, Discord-ID) einem Einsatz zuweisen. Ohne unitId: die handelnde Person selbst. */
export async function assignUnit(ctx: CoreContext, actor: Actor, idOrNumber: string, unitId?: string) {
  const self = requireUser(actor).discordUserId;
  const target = unitId ?? self;
  if (!/^\d{15,22}$/.test(target)) throw errors.badRequest('Ungültige Einheit (Discord-ID).');
  let notifyCaller: { serverId: string; robloxUserId: number } | null = null;
  const incident = await mutate(ctx, actor, idOrNumber, 'dispatch.assign', async (tx, incident, now) => {
    requireOpen(incident);
    await tx
      .insert(dispatchAssignments)
      .values({ incidentId: incident.id, unitId: target, assignedBy: actorId(actor), assignedAt: now })
      .onConflictDoNothing();
    await tx
      .insert(dispatchUnits)
      .values({ unitId: target, status: 'en_route', incidentId: incident.id, updatedAt: now })
      .onConflictDoUpdate({
        target: dispatchUnits.unitId,
        set: { status: 'en_route', incidentId: incident.id, updatedAt: now },
      });
    const first = !incident.firstAssignedAt;
    await tx
      .update(dispatchIncidents)
      .set({
        status: incident.status === 'open' ? 'assigned' : incident.status,
        firstAssignedAt: incident.firstAssignedAt ?? now,
        updatedAt: now,
      })
      .where(eq(dispatchIncidents.id, incident.id));
    if (first && incident.source === 'ingame' && incident.serverId && incident.callerRobloxId)
      notifyCaller = { serverId: incident.serverId, robloxUserId: incident.callerRobloxId };
    return { event: 'assigned', body: `Einheit <@${target}> zugewiesen`, after: { unitId: target } };
  });
  // Anrufer im Spiel informieren (nur beim ersten Zuweisen, Server muss noch laufen)
  const caller = notifyCaller as { serverId: string; robloxUserId: number } | null;
  if (caller && (await getSetting(ctx.db, 'dispatch')).notifyCaller) {
    const [server] = await ctx.db.select().from(gameServers).where(eq(gameServers.id, caller.serverId));
    if (server?.status === 'online') {
      const name = await unitName(ctx.db, target);
      await queuePlayerMessage(
        ctx.db,
        {
          serverId: server.id,
          robloxUserId: caller.robloxUserId,
          message: `🚓 Dein Notruf wurde angenommen. ${name} ist unterwegs.`,
          reason: `Einsatz #${incident.number}: Anrufer benachrichtigen`,
          createdBy: 'system:dispatch',
        },
        ctx.now(),
      );
    }
  }
  return incident;
}

export const statusSchema = z.enum(DISPATCH_OPEN_STATUS);

export async function setStatus(
  ctx: CoreContext,
  actor: Actor,
  idOrNumber: string,
  status: (typeof DISPATCH_OPEN_STATUS)[number],
) {
  return mutate(ctx, actor, idOrNumber, 'dispatch.status', async (tx, incident, now) => {
    requireOpen(incident);
    await tx.update(dispatchIncidents).set({ status, updatedAt: now }).where(eq(dispatchIncidents.id, incident.id));
    // Einheiten des Einsatzes übernehmen Anfahrt/Vor Ort
    if (status === 'en_route' || status === 'on_scene') {
      const active = await tx
        .select({ unitId: dispatchAssignments.unitId })
        .from(dispatchAssignments)
        .where(and(eq(dispatchAssignments.incidentId, incident.id), isNull(dispatchAssignments.releasedAt)));
      if (active.length)
        await tx
          .update(dispatchUnits)
          .set({ status, updatedAt: now })
          .where(
            and(
              inArray(
                dispatchUnits.unitId,
                active.map((a) => a.unitId),
              ),
              eq(dispatchUnits.incidentId, incident.id),
            ),
          );
    }
    return { event: 'status', body: `Status: ${STATUS_LABEL[status]}`, after: { status } };
  });
}

export async function addNote(ctx: CoreContext, actor: Actor, idOrNumber: string, text: string) {
  const body = text.trim().slice(0, 1000);
  if (!body) throw errors.badRequest('Die Notiz ist leer.');
  return mutate(ctx, actor, idOrNumber, 'dispatch.note', async (tx, incident, now) => {
    await tx.update(dispatchIncidents).set({ updatedAt: now }).where(eq(dispatchIncidents.id, incident.id));
    return { event: 'note', body };
  });
}

export async function closeIncident(ctx: CoreContext, actor: Actor, idOrNumber: string, report?: string) {
  return mutate(ctx, actor, idOrNumber, 'dispatch.close', async (tx, incident, now) => {
    requireOpen(incident);
    const text = report?.trim().slice(0, 3000) || null;
    await tx
      .update(dispatchIncidents)
      .set({ status: 'closed', closedAt: now, closedBy: actorId(actor), report: text, updatedAt: now })
      .where(eq(dispatchIncidents.id, incident.id));
    await tx
      .update(dispatchAssignments)
      .set({ releasedAt: now })
      .where(and(eq(dispatchAssignments.incidentId, incident.id), isNull(dispatchAssignments.releasedAt)));
    await tx
      .update(dispatchUnits)
      .set({ status: 'available', incidentId: null, updatedAt: now })
      .where(eq(dispatchUnits.incidentId, incident.id));
    return {
      event: 'closed',
      body: text ? `Einsatzbericht: ${text}` : 'Einsatz abgeschlossen',
      after: { report: text },
    };
  });
}

/** Einsatz mit Einheiten, Verlauf und (bei Ingame-Notrufen) aktuellem Status des Anrufers. */
export async function getIncidentDetail(ctx: CoreContext, actor: Actor, idOrNumber: string) {
  requirePermission(actor, 'dispatch:view');
  const incident = await getIncident(ctx.db, idOrNumber);
  const assignments = await ctx.db
    .select({
      unitId: dispatchAssignments.unitId,
      assignedAt: dispatchAssignments.assignedAt,
      releasedAt: dispatchAssignments.releasedAt,
      callsign: dispatchUnits.callsign,
      unitStatus: dispatchUnits.status,
      username: discordUsers.username,
      globalName: discordUsers.globalName,
    })
    .from(dispatchAssignments)
    .leftJoin(dispatchUnits, eq(dispatchUnits.unitId, dispatchAssignments.unitId))
    .leftJoin(discordUsers, eq(discordUsers.id, dispatchAssignments.unitId))
    .where(eq(dispatchAssignments.incidentId, incident.id))
    .orderBy(dispatchAssignments.assignedAt);
  const caller = incident.callerRobloxId ? await findOnlinePlayer(ctx.db, ctx.now(), incident.callerRobloxId) : null;
  return {
    incident,
    assignments,
    caller: incident.callerRobloxId
      ? {
          robloxUserId: incident.callerRobloxId,
          name: incident.callerName,
          online: Boolean(caller),
          team: caller?.player.team ?? null,
        }
      : null,
    events: await listRecordEvents(ctx.db, 'dispatch', incident.id, true),
  };
}

export async function listIncidents(
  db: DbExecutor,
  actor: Actor,
  filter: { status?: string[]; source?: string; department?: string; q?: string; page: number; pageSize: number },
) {
  requirePermission(actor, 'dispatch:view');
  const statuses = filter.status?.filter((s) => (DISPATCH_STATUS as readonly string[]).includes(s));
  const q = filter.q?.trim();
  const where = and(
    statuses?.length ? inArray(dispatchIncidents.status, statuses as DispatchStatus[]) : undefined,
    filter.source ? eq(dispatchIncidents.source, filter.source as never) : undefined,
    filter.department ? eq(dispatchIncidents.department, filter.department) : undefined,
    q
      ? or(
          ilike(dispatchIncidents.title, likePattern(q)),
          ilike(dispatchIncidents.description, likePattern(q)),
          ilike(dispatchIncidents.location, likePattern(q)),
          ilike(dispatchIncidents.report, likePattern(q)),
          ilike(dispatchIncidents.callerName, likePattern(q)),
          /^\d+$/.test(q) ? eq(dispatchIncidents.number, Number(q)) : undefined,
        )
      : undefined,
  );
  const items = await db
    .select({
      incident: dispatchIncidents,
      units: sql<number>`(select count(*)::int from ${dispatchAssignments} a where a.incident_id = ${dispatchIncidents.id} and a.released_at is null)`,
    })
    .from(dispatchIncidents)
    .where(where)
    .orderBy(
      sql`case when ${dispatchIncidents.status} = 'closed' then 1 else 0 end`,
      dispatchIncidents.priority,
      desc(dispatchIncidents.createdAt),
    )
    .limit(filter.pageSize)
    .offset((filter.page - 1) * filter.pageSize);
  const [total] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(dispatchIncidents)
    .where(where);
  return {
    items: items.map((r) => ({ ...r.incident, activeUnits: r.units })),
    total: total?.count ?? 0,
    page: filter.page,
    pageSize: filter.pageSize,
  };
}

export async function stats(db: DbExecutor, actor: Actor, now: Date, days = 7) {
  requirePermission(actor, 'dispatch:view');
  const since = new Date(now.getTime() - days * 86_400_000);
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      open: sql<number>`count(*) filter (where ${dispatchIncidents.status} <> 'closed')::int`,
      closed: sql<number>`count(*) filter (where ${dispatchIncidents.status} = 'closed')::int`,
      ingame: sql<number>`count(*) filter (where ${dispatchIncidents.source} = 'ingame')::int`,
      avgAssignSeconds: sql<
        number | null
      >`round(avg(extract(epoch from (${dispatchIncidents.firstAssignedAt} - ${dispatchIncidents.createdAt}))))::int`,
      avgDurationSeconds: sql<
        number | null
      >`round(avg(extract(epoch from (${dispatchIncidents.closedAt} - ${dispatchIncidents.createdAt}))))::int`,
    })
    .from(dispatchIncidents)
    .where(sql`${dispatchIncidents.createdAt} >= ${since}`);
  const byDepartment = await db
    .select({ department: dispatchIncidents.department, count: sql<number>`count(*)::int` })
    .from(dispatchIncidents)
    .where(sql`${dispatchIncidents.createdAt} >= ${since}`)
    .groupBy(dispatchIncidents.department);
  return { days, ...row!, byDepartment };
}

// ---------------------------------------------------------------------------
// Einheiten
// ---------------------------------------------------------------------------

export const unitStatusSchema = z.object({
  status: z.enum(UNIT_STATUS),
  callsign: z.string().trim().max(20).optional(),
});

/** Eigener Einheitenstatus und Rufname. */
export async function setOwnUnitStatus(ctx: CoreContext, actor: Actor, input: z.infer<typeof unitStatusSchema>) {
  requirePermission(actor, 'dispatch:edit');
  const unitId = (requireUser(actor) as UserActor).discordUserId;
  const now = ctx.now();
  const clearIncident = input.status === 'available' || input.status === 'off_duty';
  const values = {
    status: input.status,
    ...(input.callsign !== undefined ? { callsign: input.callsign || null } : {}),
    ...(clearIncident ? { incidentId: null } : {}),
    updatedAt: now,
  };
  const [row] = await ctx.db
    .insert(dispatchUnits)
    .values({ unitId, ...values })
    .onConflictDoUpdate({ target: dispatchUnits.unitId, set: values })
    .returning();
  ctx.realtime.publish('dispatch', 'dispatch.unit', { unitId, status: row!.status });
  return row!;
}

/** Alle Einheiten (außer „Außer Dienst“, wenn nicht gewünscht) mit Einsatz und Spielstatus. */
export async function listUnits(ctx: CoreContext, actor: Actor, includeOffDuty = false) {
  requirePermission(actor, 'dispatch:view');
  const rows = await ctx.db
    .select({
      unitId: dispatchUnits.unitId,
      callsign: dispatchUnits.callsign,
      status: dispatchUnits.status,
      updatedAt: dispatchUnits.updatedAt,
      incidentNumber: dispatchIncidents.number,
      username: discordUsers.username,
      globalName: discordUsers.globalName,
      robloxUserId: accountLinks.robloxUserId,
    })
    .from(dispatchUnits)
    .leftJoin(dispatchIncidents, eq(dispatchIncidents.id, dispatchUnits.incidentId))
    .leftJoin(discordUsers, eq(discordUsers.id, dispatchUnits.unitId))
    .leftJoin(
      accountLinks,
      and(eq(accountLinks.discordUserId, dispatchUnits.unitId), eq(accountLinks.status, 'active')),
    )
    .where(includeOffDuty ? undefined : sql`${dispatchUnits.status} <> 'off_duty'`)
    .orderBy(dispatchUnits.status, dispatchUnits.callsign);
  const now = ctx.now();
  const items = [];
  for (const r of rows) {
    const online = r.robloxUserId ? await findOnlinePlayer(ctx.db, now, r.robloxUserId) : null;
    items.push({ ...r, inGame: online ? { team: online.player.team ?? null, jobId: online.server.jobId } : null });
  }
  return { items };
}

// ---------------------------------------------------------------------------
// Mod-Calls
// ---------------------------------------------------------------------------

export async function getModCall(db: DbExecutor, idOrNumber: string) {
  const isNumber = /^\d+$/.test(idOrNumber);
  const isUuid = /^[0-9a-f-]{36}$/i.test(idOrNumber);
  if (!isNumber && !isUuid) throw errors.notFound('Mod-Call');
  const [row] = await db
    .select()
    .from(modCalls)
    .where(isNumber ? eq(modCalls.number, Number(idOrNumber)) : eq(modCalls.id, idOrNumber));
  if (!row) throw errors.notFound('Mod-Call');
  return row;
}

export async function createModCallFromEvent(
  ctx: TxContext,
  serverId: string,
  eventId: string,
  data: { userId: number; username?: string; text: string },
) {
  const [row] = await ctx.db
    .insert(modCalls)
    .values({
      serverId,
      robloxUserId: data.userId,
      username: data.username ?? null,
      text: data.text,
      sourceEventId: eventId,
      createdAt: ctx.now(),
    })
    .onConflictDoNothing()
    .returning();
  return row ? { status: 'ok', modCallId: row.id, number: row.number } : { status: 'ok', duplicate: true };
}

export async function listModCalls(
  db: DbExecutor,
  actor: Actor,
  filter: { status?: string[]; page: number; pageSize: number },
) {
  requirePermission(actor, 'mod_calls:view');
  const where = filter.status?.length ? inArray(modCalls.status, filter.status as never[]) : undefined;
  const items = await db
    .select()
    .from(modCalls)
    .where(where)
    .orderBy(
      sql`case when ${modCalls.status} = 'open' then 0 when ${modCalls.status} = 'claimed' then 1 else 2 end`,
      desc(modCalls.createdAt),
    )
    .limit(filter.pageSize)
    .offset((filter.page - 1) * filter.pageSize);
  const [total] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(modCalls)
    .where(where);
  return { items, total: total?.count ?? 0, page: filter.page, pageSize: filter.pageSize };
}

async function refreshModCall(ctx: CoreContext, call: typeof modCalls.$inferSelect) {
  ctx.realtime.publish('mod_calls', 'mod_call.updated', { id: call.id, number: call.number, status: call.status });
  if (call.discordMessageId) await ctx.queue.enqueue('discord', 'modcall.refresh', { modCallId: call.id });
}

/** Mod-Call übernehmen: Spieler bekommt im Spiel eine Rückmeldung. */
export async function claimModCall(ctx: CoreContext, actor: Actor, idOrNumber: string) {
  requirePermission(actor, 'mod_calls:edit');
  const now = ctx.now();
  const current = await getModCall(ctx.db, idOrNumber);
  const [row] = await ctx.db
    .update(modCalls)
    .set({ status: 'claimed', claimedBy: actorId(actor), claimedAt: now })
    .where(and(eq(modCalls.id, current.id), eq(modCalls.status, 'open')))
    .returning();
  if (!row)
    throw errors.badRequest(
      current.claimedBy
        ? `Bereits übernommen von <@${current.claimedBy}>.`
        : 'Dieser Mod-Call ist bereits geschlossen.',
    );
  await writeAudit(ctx.db, actor, { action: 'mod_call.claim', resourceType: 'mod_call', resourceId: row.id }, now);
  if (row.serverId) {
    const [server] = await ctx.db.select().from(gameServers).where(eq(gameServers.id, row.serverId));
    if (server?.status === 'online') {
      const name = await unitName(ctx.db, actorId(actor));
      await queuePlayerMessage(
        ctx.db,
        {
          serverId: server.id,
          robloxUserId: row.robloxUserId,
          message: `🙋 ${name} vom Team kümmert sich um deinen Mod-Call.`,
          reason: `Mod-Call #${row.number} übernommen`,
          createdBy: 'system:mod_calls',
        },
        now,
      );
    }
  }
  await refreshModCall(ctx, row);
  return row;
}

export async function closeModCall(ctx: CoreContext, actor: Actor, idOrNumber: string, note?: string) {
  requirePermission(actor, 'mod_calls:edit');
  const now = ctx.now();
  const current = await getModCall(ctx.db, idOrNumber);
  const [row] = await ctx.db
    .update(modCalls)
    .set({
      status: 'closed',
      closedBy: actorId(actor),
      closedAt: now,
      note: note?.trim().slice(0, 1000) || null,
      claimedBy: current.claimedBy ?? actorId(actor),
      claimedAt: current.claimedAt ?? now,
    })
    .where(and(eq(modCalls.id, current.id), sql`${modCalls.status} <> 'closed'`))
    .returning();
  if (!row) throw errors.badRequest('Dieser Mod-Call ist bereits geschlossen.');
  await writeAudit(
    ctx.db,
    actor,
    { action: 'mod_call.close', resourceType: 'mod_call', resourceId: row.id, reason: row.note ?? undefined },
    now,
  );
  await refreshModCall(ctx, row);
  return row;
}

/** Discord-Nachricht gespeichert (vom Worker nach dem Senden). */
export async function attachIncidentMessage(db: DbExecutor, incidentId: string, channelId: string, messageId: string) {
  await db
    .update(dispatchIncidents)
    .set({ discordChannelId: channelId, discordMessageId: messageId })
    .where(eq(dispatchIncidents.id, incidentId));
}

export async function attachModCallMessage(db: DbExecutor, modCallId: string, channelId: string, messageId: string) {
  await db
    .update(modCalls)
    .set({ discordChannelId: channelId, discordMessageId: messageId })
    .where(eq(modCalls.id, modCallId));
}

export const isOpenStatus = (status: string) => OPEN.has(status);
