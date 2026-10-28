/**
 * TypeScript-Beschreibung der Tabellen für typgeprüfte Abfragen mit Drizzle ORM.
 *
 * Das Schema selbst entsteht ausschließlich durch die SQL-Dateien in apps/api/migrations.
 * Wer hier etwas ändert, muss eine passende neue Migration schreiben; der Test "Schema-Abgleich"
 * schlägt sonst fehl. CHECK-Constraints und Trigger stehen nur in den Migrationen.
 */
import {
  bigint,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const roles = pgTable('roles', {
  key: text('key').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  rank: smallint('rank').notNull().unique(),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
});

export const permissions = pgTable('permissions', {
  key: text('key').primaryKey(),
  category: text('category').notNull(),
  description: text('description').notNull(),
});

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleKey: text('role_key')
      .notNull()
      .references(() => roles.key, { onDelete: 'cascade' }),
    permissionKey: text('permission_key')
      .notNull()
      .references(() => permissions.key, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.roleKey, table.permissionKey] })],
);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  discordUserId: text('discord_user_id').notNull().unique(),
  displayName: text('display_name').notNull(),
  roleKey: text('role_key')
    .notNull()
    .references(() => roles.key),
  status: text('status', { enum: ['active', 'disabled'] })
    .notNull()
    .default('active'),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  lastLoginAt: timestamptz('last_login_at'),
  createdBy: uuid('created_by'),
});

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tokenHash: text('token_hash').notNull().unique(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  lastSeenAt: timestamptz('last_seen_at').notNull().defaultNow(),
  expiresAt: timestamptz('expires_at').notNull(),
});

export const auditLog = pgTable('audit_log', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  occurredAt: timestamptz('occurred_at').notNull().defaultNow(),
  actorType: text('actor_type', { enum: ['user', 'system', 'cli'] }).notNull(),
  actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'restrict' }),
  actorLabel: text('actor_label').notNull(),
  action: text('action').notNull(),
  outcome: text('outcome', { enum: ['success', 'denied', 'failure'] }).notNull(),
  targetType: text('target_type'),
  targetId: text('target_id'),
  details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
  requestId: text('request_id'),
});

/** Vom Migrationsprogramm selbst verwaltet (nicht in den Migrationsdateien). */
export const schemaMigrations = pgTable('schema_migrations', {
  version: integer('version').primaryKey(),
  name: text('name').notNull(),
  checksum: text('checksum').notNull(),
  appliedAt: timestamptz('applied_at').notNull().defaultNow(),
});
