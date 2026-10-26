import { and, asc, desc, eq, factions, inArray, isNull, robloxUsers, sql, vehicleAssignments, vehicleCategories, vehicles, type DbExecutor } from '@enrp/database';
import { errors } from '@enrp/shared';
import { z } from 'zod';
import { type Actor, actorId, requirePermission } from '../actor';
import { writeAudit } from '../audit';
import { type CoreContext } from '../context';
import { assertNotKilled } from '../flags';
import { factionScope } from './factions';

export const vehicleInput = z.object({
  identifier: z.string().trim().min(1).max(80).regex(/^[\w .\-/]+$/, 'Nur Buchstaben, Zahlen, Leerzeichen und . - _ /'),
  name: z.string().trim().min(1).max(120),
  categoryId: z.uuid().nullable().optional(),
  factionId: z.uuid().nullable().optional(),
  status: z.enum(['active', 'maintenance', 'disabled', 'retired']).optional(),
  allowedConfigs: z.record(z.string().max(40), z.array(z.string().max(80)).max(50)).optional(),
  notes: z.string().max(2000).optional(),
});
export type VehicleInput = z.infer<typeof vehicleInput>;

export async function listVehicleCategories(db: DbExecutor) {
  return db.select().from(vehicleCategories).orderBy(asc(vehicleCategories.sortOrder));
}

export async function createVehicleCategory(ctx: CoreContext, actor: Actor, input: { key: string; name: string; sortOrder?: number }, reason: string) {
  requirePermission(actor, 'vehicles:create');
  if (!/^[a-z][a-z0-9_]{1,40}$/.test(input.key)) throw errors.badRequest('Ungültiger Schlüssel.');
  return ctx.db.transaction(async (tx) => {
    const [row] = await tx.insert(vehicleCategories).values(input).onConflictDoNothing().returning();
    if (!row) throw errors.conflict('Kategorie existiert bereits.');
    await writeAudit(tx, actor, { action: 'vehicle_category.create', resourceType: 'vehicle_category', resourceId: row.id, reason, after: row }, ctx.now());
    return row;
  });
}

export async function listVehicles(
  db: DbExecutor,
  actor: Actor,
  filter: { q?: string; categoryId?: string; factionId?: string; status?: string; page: number; pageSize: number },
) {
  const scope = factionScope(actor, 'vehicles:view');
  if (Array.isArray(scope) && !scope.length) throw errors.forbidden('Dir fehlt die Berechtigung „vehicles:view“.');
  const where = and(
    filter.q ? sql`(${vehicles.name} ilike ${`%${filter.q.replace(/[\\%_]/g, '')}%`} or ${vehicles.identifier} ilike ${`%${filter.q.replace(/[\\%_]/g, '')}%`})` : undefined,
    filter.categoryId ? eq(vehicles.categoryId, filter.categoryId) : undefined,
    filter.factionId ? eq(vehicles.factionId, filter.factionId) : undefined,
    filter.status ? eq(vehicles.status, filter.status as never) : undefined,
    Array.isArray(scope) ? inArray(vehicles.factionId, scope) : undefined,
  );
  const items = await db
    .select({
      vehicle: vehicles,
      categoryName: vehicleCategories.name,
      factionName: factions.name,
      factionKey: factions.key,
      assignments: sql<number>`(select count(*)::int from vehicle_assignments a where a.vehicle_id = ${vehicles.id} and a.unassigned_at is null)`,
    })
    .from(vehicles)
    .leftJoin(vehicleCategories, eq(vehicleCategories.id, vehicles.categoryId))
    .leftJoin(factions, eq(factions.id, vehicles.factionId))
    .where(where)
    .orderBy(asc(vehicles.name))
    .limit(filter.pageSize)
    .offset((filter.page - 1) * filter.pageSize);
  const [total] = await db.select({ count: sql<number>`count(*)::int` }).from(vehicles).where(where);
  return { items, total: total?.count ?? 0, page: filter.page, pageSize: filter.pageSize };
}

export async function getVehicle(db: DbExecutor, actor: Actor, idOrIdentifier: string) {
  const isUuid = /^[0-9a-f-]{36}$/i.test(idOrIdentifier);
  const [vehicle] = await db.select().from(vehicles).where(isUuid ? eq(vehicles.id, idOrIdentifier) : eq(vehicles.identifier, idOrIdentifier));
  if (!vehicle) throw errors.notFound('Fahrzeug');
  requirePermission(actor, 'vehicles:view', { factionId: vehicle.factionId });
  const assignments = await db
    .select({ assignment: vehicleAssignments, username: robloxUsers.username })
    .from(vehicleAssignments)
    .innerJoin(robloxUsers, eq(robloxUsers.id, vehicleAssignments.robloxUserId))
    .where(eq(vehicleAssignments.vehicleId, vehicle.id))
    .orderBy(desc(vehicleAssignments.assignedAt))
    .limit(100);
  return { vehicle, assignments };
}

export async function createVehicle(ctx: CoreContext, actor: Actor, input: VehicleInput, reason: string) {
  const data = vehicleInput.parse(input);
  requirePermission(actor, 'vehicles:create', { factionId: data.factionId ?? null });
  return ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .insert(vehicles)
      .values({ ...data, allowedConfigs: data.allowedConfigs ?? {}, notes: data.notes ?? '' })
      .onConflictDoNothing()
      .returning();
    if (!row) throw errors.conflict('Ein Fahrzeug mit dieser Kennung existiert bereits.');
    await writeAudit(tx, actor, { action: 'vehicle.create', resourceType: 'vehicle', resourceId: row.id, reason, after: row }, ctx.now());
    return row;
  });
}

export async function updateVehicle(ctx: CoreContext, actor: Actor, id: string, patch: Partial<VehicleInput>, reason: string) {
  const data = vehicleInput.partial().parse(patch);
  const [existing] = await ctx.db.select().from(vehicles).where(eq(vehicles.id, id));
  if (!existing) throw errors.notFound('Fahrzeug');
  requirePermission(actor, 'vehicles:edit', { factionId: existing.factionId });
  if (data.factionId !== undefined && data.factionId !== existing.factionId) {
    requirePermission(actor, 'vehicles:edit', { factionId: data.factionId });
  }
  return ctx.db.transaction(async (tx) => {
    const [row] = await tx.update(vehicles).set(data).where(eq(vehicles.id, id)).returning();
    await writeAudit(tx, actor, { action: 'vehicle.update', resourceType: 'vehicle', resourceId: id, reason, before: existing, after: row }, ctx.now());
    return row!;
  });
}

export async function deleteVehicle(ctx: CoreContext, actor: Actor, id: string, reason: string) {
  const [existing] = await ctx.db.select().from(vehicles).where(eq(vehicles.id, id));
  if (!existing) throw errors.notFound('Fahrzeug');
  requirePermission(actor, 'vehicles:delete', { factionId: existing.factionId });
  return ctx.db.transaction(async (tx) => {
    await tx.delete(vehicles).where(eq(vehicles.id, id));
    await writeAudit(tx, actor, { action: 'vehicle.delete', resourceType: 'vehicle', resourceId: id, reason, before: existing }, ctx.now());
    return { deleted: true };
  });
}

export async function assignVehicle(ctx: CoreContext, actor: Actor, input: { vehicleId: string; robloxUserId: number; reason: string }) {
  await assertNotKilled(ctx.db);
  const [vehicle] = await ctx.db.select().from(vehicles).where(eq(vehicles.id, input.vehicleId));
  if (!vehicle) throw errors.notFound('Fahrzeug');
  requirePermission(actor, 'vehicles:edit', { factionId: vehicle.factionId });
  if (vehicle.status !== 'active') throw errors.invalidState('Nur aktive Fahrzeuge können zugewiesen werden.');
  const [player] = await ctx.db.select().from(robloxUsers).where(eq(robloxUsers.id, input.robloxUserId));
  if (!player) throw errors.notFound('Roblox-Spieler');
  return ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .insert(vehicleAssignments)
      .values({ vehicleId: vehicle.id, robloxUserId: input.robloxUserId, assignedBy: actorId(actor), reason: input.reason, assignedAt: ctx.now() })
      .onConflictDoNothing()
      .returning();
    if (!row) throw errors.conflict('Das Fahrzeug ist dieser Person bereits zugewiesen.');
    await writeAudit(tx, actor, { action: 'vehicle.assign', resourceType: 'vehicle', resourceId: vehicle.id, reason: input.reason, after: { robloxUserId: input.robloxUserId } }, ctx.now());
    return row;
  });
}

export async function unassignVehicle(ctx: CoreContext, actor: Actor, input: { assignmentId: string; reason: string }) {
  return ctx.db.transaction(async (tx) => {
    const [assignment] = await tx
      .select({ a: vehicleAssignments, factionId: vehicles.factionId })
      .from(vehicleAssignments)
      .innerJoin(vehicles, eq(vehicles.id, vehicleAssignments.vehicleId))
      .where(and(eq(vehicleAssignments.id, input.assignmentId), isNull(vehicleAssignments.unassignedAt)));
    if (!assignment) throw errors.notFound('Aktive Zuweisung');
    requirePermission(actor, 'vehicles:edit', { factionId: assignment.factionId });
    const [row] = await tx
      .update(vehicleAssignments)
      .set({ unassignedAt: ctx.now(), unassignedBy: actorId(actor), unassignReason: input.reason })
      .where(eq(vehicleAssignments.id, input.assignmentId))
      .returning();
    await writeAudit(
      tx,
      actor,
      { action: 'vehicle.unassign', resourceType: 'vehicle', resourceId: assignment.a.vehicleId, reason: input.reason, before: { robloxUserId: assignment.a.robloxUserId } },
      ctx.now(),
    );
    return row!;
  });
}

/** Für das Spiel: welche Fahrzeuge darf ein Spieler nutzen (Fraktionsfahrzeuge + persönliche Zuweisungen)? */
export async function vehiclesForPlayer(db: DbExecutor, robloxUserId: number, factionId: string | null) {
  const assigned = await db
    .select({ identifier: vehicles.identifier, allowedConfigs: vehicles.allowedConfigs })
    .from(vehicleAssignments)
    .innerJoin(vehicles, eq(vehicles.id, vehicleAssignments.vehicleId))
    .where(and(eq(vehicleAssignments.robloxUserId, robloxUserId), isNull(vehicleAssignments.unassignedAt), eq(vehicles.status, 'active')));
  const factionVehicles = factionId
    ? await db
        .select({ identifier: vehicles.identifier, allowedConfigs: vehicles.allowedConfigs })
        .from(vehicles)
        .where(and(eq(vehicles.factionId, factionId), eq(vehicles.status, 'active')))
    : [];
  const map = new Map([...factionVehicles, ...assigned].map((v) => [v.identifier, v]));
  return [...map.values()];
}
