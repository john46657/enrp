import { sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, pgEnum, pgTable, primaryKey, smallint, text, uniqueIndex, uuid, check } from 'drizzle-orm/pg-core';
import { ANNOUNCEMENT_STATUS, CODE_STATUS, GIVEAWAY_STATUS, MAINTENANCE_STATUS, POLL_STATUS, SUGGESTION_STATUS } from '@enrp/shared';
import { createdAt, id, robloxId, ts, updatedAt } from './_helpers';

export const suggestionStatus = pgEnum('suggestion_status', SUGGESTION_STATUS);

export const suggestions = pgTable(
  'suggestions',
  {
    id: id(),
    number: integer('number').generatedAlwaysAsIdentity().notNull().unique(),
    authorDiscordId: text('author_discord_id').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    status: suggestionStatus('status').notNull().default('open'),
    statusReason: text('status_reason'),
    statusChangedBy: text('status_changed_by'),
    discordChannelId: text('discord_channel_id'),
    discordMessageId: text('discord_message_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('suggestions_status_idx').on(t.status, t.createdAt)],
);

export const suggestionVotes = pgTable(
  'suggestion_votes',
  {
    suggestionId: uuid('suggestion_id')
      .notNull()
      .references(() => suggestions.id, { onDelete: 'cascade' }),
    discordUserId: text('discord_user_id').notNull(),
    value: smallint('value').notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.suggestionId, t.discordUserId] }), check('suggestion_votes_value_chk', sql`${t.value} in (-1, 1)`)],
);

export const pollStatus = pgEnum('poll_status', POLL_STATUS);

export const polls = pgTable('polls', {
  id: id(),
  question: text('question').notNull(),
  /** [{ "id": "a", "label": "Ja" }, …] */
  options: jsonb('options').$type<Array<{ id: string; label: string }>>().notNull(),
  multipleChoice: boolean('multiple_choice').notNull().default(false),
  status: pollStatus('status').notNull().default('open'),
  closesAt: ts('closes_at'),
  discordChannelId: text('discord_channel_id'),
  discordMessageId: text('discord_message_id'),
  createdBy: text('created_by').notNull(),
  closedAt: ts('closed_at'),
  createdAt: createdAt(),
});

export const pollVotes = pgTable(
  'poll_votes',
  {
    pollId: uuid('poll_id')
      .notNull()
      .references(() => polls.id, { onDelete: 'cascade' }),
    discordUserId: text('discord_user_id').notNull(),
    optionIds: text('option_ids').array().notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.pollId, t.discordUserId] })],
);

export const giveawayStatus = pgEnum('giveaway_status', GIVEAWAY_STATUS);

export const giveaways = pgTable('giveaways', {
  id: id(),
  prize: text('prize').notNull(),
  description: text('description').notNull().default(''),
  winnerCount: integer('winner_count').notNull().default(1),
  /** Nur verifizierte Mitglieder dürfen teilnehmen. */
  requireVerified: boolean('require_verified').notNull().default(true),
  endsAt: ts('ends_at').notNull(),
  status: giveawayStatus('status').notNull().default('open'),
  discordChannelId: text('discord_channel_id'),
  discordMessageId: text('discord_message_id'),
  createdBy: text('created_by').notNull(),
  drawnAt: ts('drawn_at'),
  drawnBy: text('drawn_by'),
  winners: text('winners').array(),
  createdAt: createdAt(),
});

export const giveawayEntries = pgTable(
  'giveaway_entries',
  {
    giveawayId: uuid('giveaway_id')
      .notNull()
      .references(() => giveaways.id, { onDelete: 'cascade' }),
    discordUserId: text('discord_user_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.giveawayId, t.discordUserId] })],
);

export const announcementStatus = pgEnum('announcement_status', ANNOUNCEMENT_STATUS);
export const announcementKind = pgEnum('announcement_kind', ['general', 'changelog', 'maintenance']);

export const announcements = pgTable(
  'announcements',
  {
    id: id(),
    kind: announcementKind('kind').notNull().default('general'),
    title: text('title').notNull(),
    body: text('body').notNull(),
    /** Version bei Changelog-Einträgen. */
    version: text('version'),
    discordChannelId: text('discord_channel_id'),
    inGame: boolean('in_game').notNull().default(false),
    status: announcementStatus('status').notNull().default('draft'),
    publishAt: ts('publish_at'),
    publishedAt: ts('published_at'),
    publishedBy: text('published_by'),
    createdBy: text('created_by').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('announcements_status_idx').on(t.status, t.publishAt), index('announcements_ingame_idx').on(t.inGame, t.publishedAt)],
);

export const maintenanceStatus = pgEnum('maintenance_status', MAINTENANCE_STATUS);

export const maintenanceWindows = pgTable('maintenance_windows', {
  id: id(),
  title: text('title').notNull(),
  message: text('message').notNull(),
  startsAt: ts('starts_at').notNull(),
  endsAt: ts('ends_at').notNull(),
  status: maintenanceStatus('status').notNull().default('scheduled'),
  createdBy: text('created_by').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const ruleSetStatus = pgEnum('rule_set_status', ['draft', 'published', 'archived']);

/** Versioniertes Regelwerk. Nur eine Version ist veröffentlicht. */
export const ruleSets = pgTable(
  'rule_sets',
  {
    id: id(),
    version: integer('version').notNull().unique(),
    title: text('title').notNull(),
    content: text('content').notNull(),
    status: ruleSetStatus('status').notNull().default('draft'),
    publishedAt: ts('published_at'),
    publishedBy: text('published_by'),
    createdBy: text('created_by').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('rule_sets_one_published_uq').on(t.status).where(sql`${t.status} = 'published'`)],
);

export const ruleAcceptances = pgTable(
  'rule_acceptances',
  {
    ruleSetId: uuid('rule_set_id')
      .notNull()
      .references(() => ruleSets.id, { onDelete: 'cascade' }),
    discordUserId: text('discord_user_id').notNull(),
    acceptedAt: ts('accepted_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.ruleSetId, t.discordUserId] })],
);

export const codeStatus = pgEnum('code_status', CODE_STATUS);

/**
 * Einlösbare Codes. Gespeichert wird ein HMAC des Codes (für Lookups) und ein kurzer Hinweis zur Anzeige.
 * Die Belohnung beschreibt nur, was das Spiel vergeben soll – die Vergabe erfolgt serverseitig im Spiel.
 */
export const rewardCodes = pgTable(
  'reward_codes',
  {
    id: id(),
    codeHash: text('code_hash').notNull().unique(),
    hint: text('hint').notNull(),
    description: text('description').notNull().default(''),
    rewardType: text('reward_type').notNull(),
    rewardPayload: jsonb('reward_payload').notNull().default({}),
    maxRedemptions: integer('max_redemptions'),
    perUserLimit: integer('per_user_limit').notNull().default(1),
    redemptionCount: integer('redemption_count').notNull().default(0),
    startsAt: ts('starts_at'),
    expiresAt: ts('expires_at'),
    status: codeStatus('status').notNull().default('active'),
    createdBy: text('created_by').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('reward_codes_limit_chk', sql`${t.maxRedemptions} is null or ${t.redemptionCount} <= ${t.maxRedemptions}`),
    check('reward_codes_per_user_chk', sql`${t.perUserLimit} >= 1`),
  ],
);

export const codeRedemptions = pgTable(
  'code_redemptions',
  {
    id: id(),
    codeId: uuid('code_id')
      .notNull()
      .references(() => rewardCodes.id, { onDelete: 'cascade' }),
    robloxUserId: robloxId('roblox_user_id').notNull(),
    serverId: uuid('server_id'),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    redeemedAt: ts('redeemed_at').notNull().defaultNow(),
    /** Bestätigung des Spielservers, dass die Belohnung vergeben wurde. */
    deliveredAt: ts('delivered_at'),
  },
  (t) => [index('code_redemptions_user_idx').on(t.codeId, t.robloxUserId)],
);
