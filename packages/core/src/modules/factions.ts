import { scopeFor } from '@enrp/permissions';
import {
  and,
  asc,
  desc,
  eq,
  factionMemberships,
  factions,
  inArray,
  profileEvents,
  robloxUsers,
  sql,
  type DbExecutor,
} from '@enrp/database';
import { errors } from '@enrp/shared';
import { type Actor, actorId, hasPermission, requirePermission } from '../actor';
import { writeAudit } from '../audit';
import { type CoreContext, type TxContext } from '../context';
import { assertNotKilled } from '../flags';
import { endActiveDuty } from './duty';
import { getActiveLinkByRoblox } from './verification';

export async function listFactions(db: DbExecutor) {
  const rows = await db.select().from(factions).orderBy(asc(factions.sortOrder));
  const counts = await db
    .select({ factionId: factionMemberships.factionId, count: sql<number>`count(*)::int` })
    .from(factionMemberships)
    .where(eq(factionMemberships.status, 'active'))
    .groupBy(factionMemberships.factionId);
  return rows.map((f) => ({ ...f, memberCount: counts.find((c) => c.factionId === f.id)?.count ?? 0 }));
}

export async function getFaction(db: DbExecutor, idOrKey: string) {
  const isUuid = /^[0-9a-f-]{36}$/i.test(idOrKey);
  const [row] = await db.select().from(factions).where(isUuid ? eq(factions.id, idOrKey) : eq(factions.key, idOrKey));
  if (!row) throw errors.notFound('Fraktion');
  return row;
}

export async function getActiveMembership(db: DbExecutor, robloxUserId: number) {
  const [row] = await db
    .select({ membership: factionMemberships, faction: factions })
    .from(factionMemberships)
    .innerJoin(factions, eq(factions.id, factionMemberships.factionId))
    .where(and(eq(factionMemberships.robloxUserId, robloxUserId), eq(factionMemberships.status, 'active')));
  return row ?? null;
}

export async function listMembers(db: DbExecutor, factionId: string, opts: { page: number; pageSize: number; q?: string }) {
  const where = and(
    eq(factionMemberships.factionId, factionId),
    eq(factionMemberships.status, 'active'),
    opts.q ? sql`${robloxUsers.username} ilike ${`%${opts.q.replace(/[\\%_]/g, '')}%`}` : undefined,
  );
  const items = await db
    .select({
      membershipId: factionMemberships.id,
      robloxUserId: robloxUsers.id,
      username: robloxUsers.username,
      displayName: robloxUsers.displayName,
      joinedAt: factionMemberships.joinedAt,
      addedBy: factionMemberships.addedBy,
    })
    .from(factionMemberships)
    .innerJoin(robloxUsers, eq(robloxUsers.id, factionMemberships.robloxUserId))
    .where(where)
    .orderBy(asc(robloxUsers.username))
    .limit(opts.pageSize)
    .offset((opts.page - 1) * opts.pageSize);
  const [total] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(factionMemberships)
    .innerJoin(robloxUsers, eq(robloxUsers.id, factionMemberships.robloxUserId))
    .where(where);
  return { items, total: total?.count ?? 0, page: opts.page, pageSize: opts.pageSize };
}

export async function membershipHistory(db: DbExecutor, filter: { factionId?: string; robloxUserId?: number; limit?: number }) {
  return db
    .select({ membership: factionMemberships, faction: { id: factions.id, key: factions.key, name: factions.name }, username: robloxUsers.username })
    .from(factionMemberships)
    .innerJoin(factions, eq(factions.id, factionMemberships.factionId))
    .innerJoin(robloxUsers, eq(robloxUsers.id, factionMemberships.robloxUserId))
    .where(
      and(
        filter.factionId ? eq(factionMemberships.factionId, filter.factionId) : undefined,
        filter.robloxUserId ? eq(factionMemberships.robloxUserId, filter.robloxUserId) : undefined,
      ),
    )
    .orderBy(desc(factionMemberships.joinedAt))
    .limit(filter.limit ?? 100);
}

async function syncFactionRole(ctx: TxContext, robloxUserId: number, roleId: string | null, action: 'role.add' | 'role.remove') {
  if (!roleId || !ctx.config.guildId) return;
  const link = await getActiveLinkByRoblox(ctx.db, robloxUserId);
  if (!link) return;
  await ctx.queue.enqueue('discord', action, { guildId: ctx.config.guildId, userId: link.discordUserId, roleId, reason: 'Fraktionsverwaltung' });
}

/** Fraktionsrechte werden immer bezogen auf die betroffene Fraktion geprüft. */
function requireFactionEdit(actor: Actor, factionId: string) {
  requirePermission(actor, 'factions:edit', { factionId });
}

/**
 * Nimmt eine Person in eine Fraktion auf oder versetzt sie. Bei Versetzung braucht der Akteur
 * Rechte für die alte und die neue Fraktion. Eine laufende Dienstsession wird beendet.
 */
export async function assignFaction(
  ctx: CoreContext,
  actor: Actor,
  input: { robloxUserId: number; factionKey: string; reason: string },
) {
  await assertNotKilled(ctx.db);
  const target = await getFaction(ctx.db, input.factionKey);
  if (!target.isActive) throw errors.invalidState('Diese Fraktion ist deaktiviert.');
  requireFactionEdit(actor, target.id);
  const now = ctx.now();
  return ctx.db.transaction(async (tx) => {
    const [player] = await tx.select().from(robloxUsers).where(eq(robloxUsers.id, input.robloxUserId));
    if (!player) throw errors.notFound('Roblox-Spieler (noch nie im Spiel oder verifiziert)');
    // Sperrt die Person gegen parallele Änderungen.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`membership:${input.robloxUserId}`}))`);
    const current = await getActiveMembership(tx, input.robloxUserId);
    if (current?.faction.id === target.id) throw errors.conflict(`${player.username} ist bereits Mitglied der Fraktion ${target.name}.`);
    if (current) {
      requireFactionEdit(actor, current.faction.id);
      await tx
        .update(factionMemberships)
        .set({ status: 'ended', endedAt: now, endedBy: actorId(actor), endReason: `Versetzung: ${input.reason}` })
        .where(eq(factionMemberships.id, current.membership.id));
      // Laufenden Dienst der alten Fraktion beenden.
      await endActiveDuty({ ...ctx, db: tx }, input.robloxUserId, 'faction_changed');
      await syncFactionRole({ ...ctx, db: tx }, input.robloxUserId, current.faction.discordRoleId, 'role.remove');
    }
    const [membership] = await tx
      .insert(factionMemberships)
      .values({ factionId: target.id, robloxUserId: input.robloxUserId, addedBy: actorId(actor), addReason: input.reason, joinedAt: now })
      .returning();
    await tx.insert(profileEvents).values({
      robloxUserId: input.robloxUserId,
      type: current ? 'faction.transferred' : 'faction.joined',
      summary: current ? `Versetzt: ${current.faction.name} → ${target.name}` : `Aufgenommen in ${target.name}`,
      data: input.reason,
      actorId: actorId(actor),
      createdAt: now,
    });
    await writeAudit(
      tx,
      actor,
      {
        action: current ? 'faction.transfer' : 'faction.add',
        resourceType: 'faction_membership',
        resourceId: membership!.id,
        reason: input.reason,
        before: current ? { factionKey: current.faction.key } : null,
        after: { factionKey: target.key, robloxUserId: input.robloxUserId },
      },
      now,
    );
    await syncFactionRole({ ...ctx, db: tx }, input.robloxUserId, target.discordRoleId, 'role.add');
    return { membership: membership!, previousFaction: current?.faction.key ?? null };
  });
}

export async function removeFromFaction(ctx: CoreContext, actor: Actor, input: { robloxUserId: number; reason: string }) {
  await assertNotKilled(ctx.db);
  const now = ctx.now();
  return ctx.db.transaction(async (tx) => {
    const current = await getActiveMembership(tx, input.robloxUserId);
    if (!current) throw errors.notFound('Aktive Fraktionsmitgliedschaft');
    requireFactionEdit(actor, current.faction.id);
    await tx
      .update(factionMemberships)
      .set({ status: 'ended', endedAt: now, endedBy: actorId(actor), endReason: input.reason })
      .where(eq(factionMemberships.id, current.membership.id));
    await endActiveDuty({ ...ctx, db: tx }, input.robloxUserId, 'faction_removed');
    await tx.insert(profileEvents).values({
      robloxUserId: input.robloxUserId,
      type: 'faction.removed',
      summary: `Aus ${current.faction.name} entfernt`,
      data: input.reason,
      actorId: actorId(actor),
      createdAt: now,
    });
    await writeAudit(
      tx,
      actor,
      { action: 'faction.remove', resourceType: 'faction_membership', resourceId: current.membership.id, reason: input.reason, before: { factionKey: current.faction.key } },
      now,
    );
    await syncFactionRole({ ...ctx, db: tx }, input.robloxUserId, current.faction.discordRoleId, 'role.remove');
    return { factionKey: current.faction.key };
  });
}

export async function updateFaction(
  ctx: CoreContext,
  actor: Actor,
  idOrKey: string,
  patch: { name?: string; description?: string; color?: string; discordRoleId?: string | null; isActive?: boolean },
  reason: string,
) {
  const faction = await getFaction(ctx.db, idOrKey);
  requirePermission(actor, 'factions:configure', { factionId: faction.id });
  return ctx.db.transaction(async (tx) => {
    const [row] = await tx.update(factions).set(patch).where(eq(factions.id, faction.id)).returning();
    await writeAudit(tx, actor, { action: 'faction.update', resourceType: 'faction', resourceId: faction.id, reason, before: faction, after: row }, ctx.now());
    return row!;
  });
}

export async function factionStats(db: DbExecutor, since: Date | null) {
  const rows = await db.execute<{ faction_id: string; members: number; duty_seconds: number; sessions: number; on_duty: number }>(sql`
    select f.id as faction_id,
      (select count(*)::int from faction_memberships m where m.faction_id = f.id and m.status = 'active') as members,
      coalesce((select sum(extract(epoch from (coalesce(d.ended_at, now()) - greatest(d.started_at, coalesce(${since}::timestamptz, d.started_at)))))::bigint
        from duty_sessions d where d.faction_id = f.id and d.status <> 'invalidated'
        and coalesce(d.ended_at, now()) > coalesce(${since}::timestamptz, '-infinity'::timestamptz)), 0)::bigint as duty_seconds,
      (select count(*)::int from duty_sessions d where d.faction_id = f.id and d.status <> 'invalidated'
        and d.started_at >= coalesce(${since}::timestamptz, '-infinity'::timestamptz)) as sessions,
      (select count(*)::int from duty_sessions d where d.faction_id = f.id and d.status = 'active') as on_duty
    from factions f order by f.sort_order`);
  return rows.rows.map((r) => ({ factionId: r.faction_id, members: r.members, dutySeconds: Number(r.duty_seconds), sessions: r.sessions, onDuty: r.on_duty }));
}

/** Für Listen: auf welche Fraktionen darf der Akteur zugreifen? */
export function factionScope(actor: Actor, permission: string): 'all' | string[] {
  if (actor.kind === 'system') return 'all';
  if (actor.kind !== 'user') return [];
  if (hasPermission(actor, permission)) return 'all';
  const scope = scopeFor(actor.subject, permission);
  return scope.kind === 'all' ? 'all' : scope.kind === 'factions' ? scope.factionIds : [];
}

export async function factionIdsByKeys(db: DbExecutor, keys: string[]) {
  if (!keys.length) return [];
  return db.select({ id: factions.id, key: factions.key }).from(factions).where(inArray(factions.key, keys));
}
