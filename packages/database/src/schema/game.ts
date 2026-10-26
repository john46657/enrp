import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, pgEnum, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { DUTY_STATUS, MEMBERSHIP_STATUS, VEHICLE_STATUS } from '@enrp/shared';
import { createdAt, id, robloxId, ts, updatedAt } from './_helpers';
import { robloxUsers } from './identity';

export const factions = pgTable('factions', {
  id: id(),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  color: text('color').notNull().default('#64748b'),
  /** Optionale Discord-Rolle, die Mitglieder mit verknüpftem Konto erhalten. */
  discordRoleId: text('discord_role_id'),
  /** Fraktion nimmt am Dienstsystem teil (Polizei, Feuerwehr, Rettungsdienst). */
  hasDuty: boolean('has_duty').notNull().default(false),
  isDefault: boolean('is_default').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const membershipStatus = pgEnum('membership_status', MEMBERSHIP_STATUS);

/** Fraktionszugehörigkeiten. Jede Person hat höchstens eine aktive Mitgliedschaft; beendete bleiben als Historie. */
export const factionMemberships = pgTable(
  'faction_memberships',
  {
    id: id(),
    factionId: uuid('faction_id')
      .notNull()
      .references(() => factions.id, { onDelete: 'restrict' }),
    robloxUserId: robloxId('roblox_user_id')
      .notNull()
      .references(() => robloxUsers.id, { onDelete: 'cascade' }),
    status: membershipStatus('status').notNull().default('active'),
    joinedAt: ts('joined_at').notNull().defaultNow(),
    addedBy: text('added_by').notNull(),
    addReason: text('add_reason'),
    endedAt: ts('ended_at'),
    endedBy: text('ended_by'),
    endReason: text('end_reason'),
  },
  (t) => [
    uniqueIndex('faction_memberships_active_uq').on(t.robloxUserId).where(sql`${t.status} = 'active'`),
    index('faction_memberships_faction_idx').on(t.factionId, t.status),
  ],
);

export const gameServerStatus = pgEnum('game_server_status', ['online', 'offline']);

/** Laufende bzw. beendete Roblox-Server-Instanzen (eine Zeile pro JobId). */
export const gameServers = pgTable(
  'game_servers',
  {
    id: id(),
    jobId: text('job_id').notNull().unique(),
    placeId: text('place_id').notNull(),
    placeVersion: integer('place_version'),
    apiKeyId: uuid('api_key_id'),
    status: gameServerStatus('status').notNull().default('online'),
    playerCount: integer('player_count').notNull().default(0),
    maxPlayers: integer('max_players'),
    startedAt: ts('started_at').notNull().defaultNow(),
    lastHeartbeatAt: ts('last_heartbeat_at').notNull().defaultNow(),
    endedAt: ts('ended_at'),
  },
  (t) => [index('game_servers_status_idx').on(t.status, t.lastHeartbeatAt)],
);

export const dutyStatus = pgEnum('duty_status', DUTY_STATUS);

/**
 * Dienstsessions. Beginn und Ende werden mit der Serverzeit des Backends gesetzt –
 * vom Spiel gemeldete Zeitstempel werden nur zur Plausibilitätsprüfung verwendet.
 */
export const dutySessions = pgTable(
  'duty_sessions',
  {
    id: id(),
    robloxUserId: robloxId('roblox_user_id')
      .notNull()
      .references(() => robloxUsers.id, { onDelete: 'cascade' }),
    factionId: uuid('faction_id')
      .notNull()
      .references(() => factions.id, { onDelete: 'restrict' }),
    serverId: uuid('server_id').references(() => gameServers.id, { onDelete: 'set null' }),
    status: dutyStatus('status').notNull().default('active'),
    startedAt: ts('started_at').notNull(),
    endedAt: ts('ended_at'),
    durationSeconds: integer('duration_seconds'),
    endReason: text('end_reason'),
    /** Auffälligkeiten (z. B. Zeitabweichung, Doppelstart, Server-Timeout). */
    flags: text('flags').array().notNull().default(sql`'{}'::text[]`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('duty_sessions_active_uq').on(t.robloxUserId).where(sql`${t.status} = 'active'`),
    index('duty_sessions_user_idx').on(t.robloxUserId, t.startedAt),
    index('duty_sessions_faction_idx').on(t.factionId, t.startedAt),
    check('duty_sessions_end_chk', sql`${t.endedAt} is null or ${t.endedAt} >= ${t.startedAt}`),
  ],
);

/** Berechtigte Korrekturen von Dienstsessions mit Begründung (zusätzlich im Audit-Log). */
export const dutyCorrections = pgTable('duty_corrections', {
  id: id(),
  sessionId: uuid('session_id')
    .notNull()
    .references(() => dutySessions.id, { onDelete: 'cascade' }),
  actorId: text('actor_id').notNull(),
  reason: text('reason').notNull(),
  before: jsonb('before').notNull(),
  after: jsonb('after').notNull(),
  createdAt: createdAt(),
});

export const vehicleCategories = pgTable('vehicle_categories', {
  id: id(),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: createdAt(),
});

export const vehicleStatus = pgEnum('vehicle_status', VEHICLE_STATUS);

/** Fahrzeugkatalog – vollständig konfigurierbar, keine vorgegebenen Spielressourcen. */
export const vehicles = pgTable(
  'vehicles',
  {
    id: id(),
    /** Kennung, unter der das Fahrzeug im Roblox-Spiel bekannt ist (z. B. Modellname). */
    identifier: text('identifier').notNull().unique(),
    name: text('name').notNull(),
    categoryId: uuid('category_id').references(() => vehicleCategories.id, { onDelete: 'set null' }),
    factionId: uuid('faction_id').references(() => factions.id, { onDelete: 'set null' }),
    status: vehicleStatus('status').notNull().default('active'),
    /** Zulässige Konfigurationen, z. B. { "liveries": ["Standard"], "equipment": ["..."] }. */
    allowedConfigs: jsonb('allowed_configs').notNull().default({}),
    notes: text('notes').notNull().default(''),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('vehicles_faction_idx').on(t.factionId), index('vehicles_category_idx').on(t.categoryId)],
);

/** Zuweisungen von Fahrzeugen an Spieler. */
export const vehicleAssignments = pgTable(
  'vehicle_assignments',
  {
    id: id(),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'cascade' }),
    robloxUserId: robloxId('roblox_user_id')
      .notNull()
      .references(() => robloxUsers.id, { onDelete: 'cascade' }),
    assignedBy: text('assigned_by').notNull(),
    assignedAt: ts('assigned_at').notNull().defaultNow(),
    reason: text('reason'),
    unassignedAt: ts('unassigned_at'),
    unassignedBy: text('unassigned_by'),
    unassignReason: text('unassign_reason'),
  },
  (t) => [
    uniqueIndex('vehicle_assignments_active_uq').on(t.vehicleId, t.robloxUserId).where(sql`${t.unassignedAt} is null`),
    index('vehicle_assignments_user_idx').on(t.robloxUserId),
  ],
);

/** Rohdaten eingehender Spielereignisse – dient Idempotenz, Nachvollziehbarkeit und Fehlersuche. */
export const gameEvents = pgTable(
  'game_events',
  {
    id: id(),
    serverId: uuid('server_id'),
    apiKeyId: uuid('api_key_id'),
    type: text('type').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    payload: jsonb('payload').notNull(),
    result: jsonb('result'),
    status: text('status').notNull().default('processed'),
    error: text('error'),
    receivedAt: ts('received_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('game_events_idem_uq').on(t.apiKeyId, t.idempotencyKey), index('game_events_received_idx').on(t.receivedAt)],
);
