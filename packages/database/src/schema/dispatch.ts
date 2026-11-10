import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgEnum, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { BOLO_KIND, BOLO_STATUS, DISPATCH_SOURCE, DISPATCH_STATUS, MOD_CALL_STATUS, UNIT_STATUS } from '@enrp/shared';
import { createdAt, id, robloxId, ts, updatedAt } from './_helpers';
import { gameServers } from './game';

export const dispatchStatus = pgEnum('dispatch_status', DISPATCH_STATUS);
export const dispatchSource = pgEnum('dispatch_source', DISPATCH_SOURCE);
export const unitStatus = pgEnum('unit_status', UNIT_STATUS);
export const modCallStatus = pgEnum('mod_call_status', MOD_CALL_STATUS);

/**
 * Einsätze der Leitstelle. Quelle „ingame“ = echter Notruf aus dem Spiel (Ereignis emergency_call),
 * „discord“/„dashboard“ = eigener Einsatz der Leitstelle. Verlauf und Notizen liegen in record_events.
 */
export const dispatchIncidents = pgTable(
  'dispatch_incidents',
  {
    id: id(),
    number: integer('number').generatedAlwaysAsIdentity().notNull().unique(),
    source: dispatchSource('source').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    location: text('location').notNull().default(''),
    /** 1 = hoch, 2 = mittel, 3 = niedrig. */
    priority: integer('priority').notNull().default(2),
    /** Zuständiger Bereich, z. B. Polizei, Rettungsdienst, Feuerwehr. */
    department: text('department').notNull(),
    status: dispatchStatus('status').notNull().default('open'),
    serverId: uuid('server_id').references(() => gameServers.id, { onDelete: 'set null' }),
    /** Anrufer bei Ingame-Notrufen. */
    callerRobloxId: robloxId('caller_roblox_id'),
    callerName: text('caller_name'),
    /** Laufende Nummer des Notrufs auf dem Spielserver. */
    callNumber: integer('call_number'),
    position: jsonb('position'),
    /** Ereignis-ID des Notrufs – derselbe Notruf wird nie doppelt angelegt. */
    sourceEventId: text('source_event_id'),
    discordChannelId: text('discord_channel_id'),
    discordMessageId: text('discord_message_id'),
    createdBy: text('created_by').notNull(),
    firstAssignedAt: ts('first_assigned_at'),
    closedAt: ts('closed_at'),
    closedBy: text('closed_by'),
    report: text('report'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('dispatch_incidents_status_idx').on(t.status, t.priority, t.createdAt),
    uniqueIndex('dispatch_incidents_source_event_uq')
      .on(t.sourceEventId)
      .where(sql`${t.sourceEventId} is not null`),
  ],
);

/** Einheiten (Personen) an Einsätzen. Aktive Zuweisung = released_at ist leer. */
export const dispatchAssignments = pgTable(
  'dispatch_assignments',
  {
    id: id(),
    incidentId: uuid('incident_id')
      .notNull()
      .references(() => dispatchIncidents.id, { onDelete: 'cascade' }),
    unitId: text('unit_id').notNull(),
    assignedBy: text('assigned_by').notNull(),
    assignedAt: ts('assigned_at').notNull().defaultNow(),
    releasedAt: ts('released_at'),
  },
  (t) => [
    uniqueIndex('dispatch_assignments_active_uq')
      .on(t.incidentId, t.unitId)
      .where(sql`${t.releasedAt} is null`),
    index('dispatch_assignments_unit_idx').on(t.unitId),
  ],
);

/** Status und Rufname je Einheit (Discord-ID der Person). */
export const dispatchUnits = pgTable('dispatch_units', {
  unitId: text('unit_id').primaryKey(),
  callsign: text('callsign'),
  status: unitStatus('status').notNull().default('off_duty'),
  incidentId: uuid('incident_id').references(() => dispatchIncidents.id, { onDelete: 'set null' }),
  updatedAt: updatedAt(),
});

/** Mod-Calls aus dem Spiel (/modcall). */
export const modCalls = pgTable(
  'mod_calls',
  {
    id: id(),
    number: integer('number').generatedAlwaysAsIdentity().notNull().unique(),
    serverId: uuid('server_id').references(() => gameServers.id, { onDelete: 'set null' }),
    robloxUserId: robloxId('roblox_user_id').notNull(),
    username: text('username'),
    text: text('text').notNull().default(''),
    status: modCallStatus('status').notNull().default('open'),
    claimedBy: text('claimed_by'),
    claimedAt: ts('claimed_at'),
    closedBy: text('closed_by'),
    closedAt: ts('closed_at'),
    note: text('note'),
    sourceEventId: text('source_event_id'),
    discordChannelId: text('discord_channel_id'),
    discordMessageId: text('discord_message_id'),
    createdAt: createdAt(),
  },
  (t) => [
    index('mod_calls_status_idx').on(t.status, t.createdAt),
    uniqueIndex('mod_calls_source_event_uq')
      .on(t.sourceEventId)
      .where(sql`${t.sourceEventId} is not null`),
  ],
);

export const boloKind = pgEnum('bolo_kind', BOLO_KIND);
export const boloStatus = pgEnum('bolo_status', BOLO_STATUS);

/**
 * Fahndungen (BOLO) nach Personen (Roblox-ID) oder Fahrzeugen (Kennzeichen). Jeder Heartbeat wird mit den aktiven
 * Fahndungen abgeglichen; ein Treffer wird höchstens einmal je Abklingzeit gemeldet (last_hit_at).
 */
export const bolos = pgTable(
  'bolos',
  {
    id: id(),
    number: integer('number').generatedAlwaysAsIdentity().notNull().unique(),
    kind: boloKind('kind').notNull(),
    status: boloStatus('status').notNull().default('active'),
    /** Person: Roblox-ID (Pflicht bei kind = person). */
    robloxUserId: robloxId('roblox_user_id'),
    personName: text('person_name'),
    /** Fahrzeug: Kennzeichen wie eingegeben und normalisiert (Großbuchstaben, ohne Trennzeichen). */
    plate: text('plate'),
    plateNormalized: text('plate_normalized'),
    vehicleDescription: text('vehicle_description'),
    reason: text('reason').notNull(),
    /** 1 = hoch, 2 = mittel, 3 = niedrig. */
    priority: integer('priority').notNull().default(2),
    createdBy: text('created_by').notNull(),
    expiresAt: ts('expires_at'),
    hitCount: integer('hit_count').notNull().default(0),
    lastHitAt: ts('last_hit_at'),
    lastHitServerId: uuid('last_hit_server_id').references(() => gameServers.id, { onDelete: 'set null' }),
    lastHit: jsonb('last_hit'),
    resolvedAt: ts('resolved_at'),
    resolvedBy: text('resolved_by'),
    resolveNote: text('resolve_note'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('bolos_status_idx').on(t.status, t.createdAt),
    index('bolos_plate_idx')
      .on(t.plateNormalized)
      .where(sql`${t.status} = 'active'`),
    index('bolos_person_idx')
      .on(t.robloxUserId)
      .where(sql`${t.status} = 'active'`),
    check(
      'bolos_target_chk',
      sql`(${t.kind} = 'person' and ${t.robloxUserId} is not null) or (${t.kind} = 'vehicle' and ${t.plateNormalized} is not null and ${t.plateNormalized} <> '')`,
    ),
  ],
);
