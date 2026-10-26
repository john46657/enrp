import { sql } from 'drizzle-orm';
import { bigint, index, integer, pgEnum, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { ACCOUNT_LINK_STATUS } from '@enrp/shared';
import { createdAt, id, robloxId, ts, updatedAt } from './_helpers';

/** Discord-Konten. Es werden nur die für Anzeige und Zuordnung nötigen Daten gespeichert. */
export const discordUsers = pgTable('discord_users', {
  id: text('id').primaryKey(),
  username: text('username').notNull(),
  globalName: text('global_name'),
  avatarHash: text('avatar_hash'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  lastSeenAt: ts('last_seen_at'),
});

/** Roblox-Konten. Die stabile Roblox-User-ID ist der Primärschlüssel, Namen können sich ändern. */
export const robloxUsers = pgTable(
  'roblox_users',
  {
    id: robloxId('id').primaryKey(),
    username: text('username').notNull(),
    displayName: text('display_name'),
    accountCreatedAt: ts('account_created_at'),
    totalPlaytimeSeconds: bigint('total_playtime_seconds', { mode: 'number' }).notNull().default(0),
    firstSeenAt: ts('first_seen_at'),
    lastSeenAt: ts('last_seen_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('roblox_users_username_idx').on(sql`lower(${t.username})`)],
);

export const accountLinkStatus = pgEnum('account_link_status', ACCOUNT_LINK_STATUS);

/**
 * Kontoverknüpfungen Discord ↔ Roblox. Pro Konto ist höchstens eine aktive Verknüpfung erlaubt;
 * aufgehobene Verknüpfungen bleiben als Historie erhalten.
 */
export const accountLinks = pgTable(
  'account_links',
  {
    id: id(),
    discordUserId: text('discord_user_id')
      .notNull()
      .references(() => discordUsers.id, { onDelete: 'cascade' }),
    robloxUserId: robloxId('roblox_user_id')
      .notNull()
      .references(() => robloxUsers.id, { onDelete: 'cascade' }),
    status: accountLinkStatus('status').notNull().default('active'),
    verifiedAt: ts('verified_at').notNull().defaultNow(),
    revokedAt: ts('revoked_at'),
    revokedBy: text('revoked_by'),
    revokeReason: text('revoke_reason'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('account_links_active_discord_uq').on(t.discordUserId).where(sql`${t.status} = 'active'`),
    uniqueIndex('account_links_active_roblox_uq').on(t.robloxUserId).where(sql`${t.status} = 'active'`),
    index('account_links_roblox_idx').on(t.robloxUserId),
  ],
);

export const verificationOutcome = pgEnum('verification_outcome', ['success', 'failed', 'expired']);

/** Protokoll aller Verifizierungsversuche (ohne Tokens). */
export const verifications = pgTable(
  'verifications',
  {
    id: id(),
    discordUserId: text('discord_user_id').notNull(),
    robloxUserId: robloxId('roblox_user_id'),
    outcome: verificationOutcome('outcome').notNull(),
    failureReason: text('failure_reason'),
    createdAt: createdAt(),
  },
  (t) => [index('verifications_discord_idx').on(t.discordUserId, t.createdAt)],
);

export const oauthPurpose = pgEnum('oauth_purpose', ['dashboard_login', 'verify_start', 'verify_discord', 'roblox_verify']);

/**
 * Kurzlebige OAuth-Zustände (state, PKCE-Verifier, Nonce). Der state wird nur gehasht gespeichert,
 * Einträge sind einmalig verwendbar (consumed_at) und laufen nach wenigen Minuten ab.
 */
export const oauthStates = pgTable(
  'oauth_states',
  {
    stateHash: text('state_hash').primaryKey(),
    purpose: oauthPurpose('purpose').notNull(),
    discordUserId: text('discord_user_id'),
    codeVerifier: text('code_verifier').notNull(),
    nonce: text('nonce'),
    redirectPath: text('redirect_path'),
    /** Bindet den Flow an den Browser, der ihn gestartet hat (Hash eines Cookie-Werts). */
    browserBindingHash: text('browser_binding_hash'),
    createdAt: createdAt(),
    expiresAt: ts('expires_at').notNull(),
    consumedAt: ts('consumed_at'),
  },
  (t) => [index('oauth_states_expires_idx').on(t.expiresAt)],
);

/** Für Nutzer sichtbare Änderungshistorie eines Profils. */
export const profileEvents = pgTable(
  'profile_events',
  {
    id: id(),
    discordUserId: text('discord_user_id'),
    robloxUserId: robloxId('roblox_user_id'),
    type: text('type').notNull(),
    summary: text('summary').notNull(),
    data: text('data'),
    actorId: text('actor_id'),
    createdAt: createdAt(),
  },
  (t) => [index('profile_events_discord_idx').on(t.discordUserId, t.createdAt), index('profile_events_roblox_idx').on(t.robloxUserId, t.createdAt)],
);

/** Spielsitzungen aus Join/Leave-Ereignissen des Roblox-Servers. */
export const playSessions = pgTable(
  'play_sessions',
  {
    id: id(),
    robloxUserId: robloxId('roblox_user_id')
      .notNull()
      .references(() => robloxUsers.id, { onDelete: 'cascade' }),
    serverId: uuid('server_id'),
    joinedAt: ts('joined_at').notNull(),
    leftAt: ts('left_at'),
    durationSeconds: integer('duration_seconds'),
  },
  (t) => [
    index('play_sessions_user_idx').on(t.robloxUserId, t.joinedAt),
    uniqueIndex('play_sessions_open_uq').on(t.robloxUserId).where(sql`${t.leftAt} is null`),
  ],
);
