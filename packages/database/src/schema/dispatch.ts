import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgEnum, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { DISPATCH_SOURCE, DISPATCH_STATUS, MOD_CALL_STATUS, UNIT_STATUS } from '@enrp/shared';
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
