import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, ts, updatedAt } from './_helpers';

/** Konfigurierbare Plattform-Rollen (RBAC). */
export const appRoles = pgTable('app_roles', {
  id: id(),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  priority: integer('priority').notNull().default(0),
  isSystem: boolean('is_system').notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * Berechtigungen einer Rolle. "permission" ist ein Schlüssel aus @enrp/permissions oder ein Muster
 * ("ressource:*", "*"). "faction_ids" schränkt fraktionsbezogene Rechte ein.
 */
export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => appRoles.id, { onDelete: 'cascade' }),
    permission: text('permission').notNull(),
    factionIds: uuid('faction_ids').array(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permission] })],
);

/** Ordnet Plattform-Rollen Discord-Rollen oder einzelnen Discord-Nutzern zu. */
export const roleBindings = pgTable(
  'role_bindings',
  {
    id: id(),
    roleId: uuid('role_id')
      .notNull()
      .references(() => appRoles.id, { onDelete: 'cascade' }),
    discordRoleId: text('discord_role_id'),
    discordUserId: text('discord_user_id'),
    createdBy: text('created_by'),
    createdAt: createdAt(),
  },
  (t) => [
    check('role_bindings_target_chk', sql`(${t.discordRoleId} is null) <> (${t.discordUserId} is null)`),
    uniqueIndex('role_bindings_role_discord_role_uq').on(t.roleId, t.discordRoleId),
    uniqueIndex('role_bindings_role_discord_user_uq').on(t.roleId, t.discordUserId),
    index('role_bindings_discord_role_idx').on(t.discordRoleId),
    index('role_bindings_discord_user_idx').on(t.discordUserId),
  ],
);

export const overrideEffect = pgEnum('override_effect', ['allow', 'deny']);

/** Befehlsbezogene Overrides pro Discord-Rolle (/permissions grant|revoke). */
export const commandOverrides = pgTable(
  'command_overrides',
  {
    id: id(),
    command: text('command').notNull(),
    discordRoleId: text('discord_role_id').notNull(),
    effect: overrideEffect('effect').notNull(),
    createdBy: text('created_by').notNull(),
    reason: text('reason'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('command_overrides_uq').on(t.command, t.discordRoleId)],
);

/** Dashboard-Sitzungen. Gespeichert wird nur der Hash des Sitzungstokens. */
export const adminSessions = pgTable(
  'admin_sessions',
  {
    id: id(),
    tokenHash: text('token_hash').notNull().unique(),
    csrfToken: text('csrf_token').notNull(),
    discordUserId: text('discord_user_id').notNull(),
    ipHash: text('ip_hash'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
    revokedBy: text('revoked_by'),
  },
  (t) => [index('admin_sessions_user_idx').on(t.discordUserId), index('admin_sessions_expires_idx').on(t.expiresAt)],
);

export const apiKeyKind = pgEnum('api_key_kind', ['roblox_server']);

/** API-Schlüssel für Roblox-Spielserver. Nur der Hash wird gespeichert, der Klartext wird einmalig angezeigt. */
export const apiKeys = pgTable('api_keys', {
  id: id(),
  name: text('name').notNull(),
  kind: apiKeyKind('kind').notNull(),
  prefix: text('prefix').notNull(),
  keyHash: text('key_hash').notNull().unique(),
  /** Optional: Roblox-Place-IDs, von denen dieser Schlüssel verwendet werden darf. */
  allowedPlaceIds: text('allowed_place_ids').array(),
  createdBy: text('created_by').notNull(),
  createdAt: createdAt(),
  lastUsedAt: ts('last_used_at'),
  revokedAt: ts('revoked_at'),
  revokedBy: text('revoked_by'),
});

/** Zusatzdaten zu Berechtigungsprüfungen im Dashboard: zwischengespeicherte Discord-Rollen. */
export const memberRoleCache = pgTable('member_role_cache', {
  discordUserId: text('discord_user_id').primaryKey(),
  roleIds: text('role_ids').array().notNull(),
  inGuild: boolean('in_guild').notNull(),
  fetchedAt: ts('fetched_at').notNull().defaultNow(),
  data: jsonb('data'),
});
