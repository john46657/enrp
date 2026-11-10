import { sql } from 'drizzle-orm';
import { check, index, integer, pgEnum, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { APPEAL_STATUS, MODERATION_PLATFORMS, MODERATION_STATUS, MODERATION_TYPES } from '@enrp/shared';
import { createdAt, id, robloxId, ts, updatedAt } from './_helpers';

export const moderationType = pgEnum('moderation_type', MODERATION_TYPES);
export const moderationPlatform = pgEnum('moderation_platform', MODERATION_PLATFORMS);
export const moderationStatus = pgEnum('moderation_status', MODERATION_STATUS);

export const moderationActions = pgTable(
  'moderation_actions',
  {
    id: id(),
    number: integer('number').generatedAlwaysAsIdentity().notNull().unique(),
    type: moderationType('type').notNull(),
    platform: moderationPlatform('platform').notNull().default('discord'),
    targetDiscordId: text('target_discord_id'),
    targetRobloxId: robloxId('target_roblox_id'),
    moderatorId: text('moderator_id').notNull(),
    reason: text('reason').notNull(),
    expiresAt: ts('expires_at'),
    status: moderationStatus('status').notNull(),
    executedAt: ts('executed_at'),
    executionError: text('execution_error'),
    revokedBy: text('revoked_by'),
    revokedAt: ts('revoked_at'),
    revokeReason: text('revoke_reason'),
    relatedReportId: uuid('related_report_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('moderation_actions_target_chk', sql`${t.targetDiscordId} is not null or ${t.targetRobloxId} is not null`),
    index('moderation_actions_discord_idx').on(t.targetDiscordId, t.createdAt),
    index('moderation_actions_roblox_idx').on(t.targetRobloxId, t.createdAt),
    index('moderation_actions_status_idx').on(t.status, t.expiresAt),
    index('moderation_actions_moderator_idx').on(t.moderatorId),
  ],
);

export const appealStatus = pgEnum('appeal_status', APPEAL_STATUS);

/** Einsprüche gegen Moderationsaktionen. Bearbeiter dürfen weder Antragsteller noch ursprüngliche Moderatoren sein. */
export const appeals = pgTable(
  'appeals',
  {
    id: id(),
    actionId: uuid('action_id')
      .notNull()
      .references(() => moderationActions.id, { onDelete: 'cascade' }),
    appellantDiscordId: text('appellant_discord_id').notNull(),
    statement: text('statement').notNull(),
    status: appealStatus('status').notNull().default('open'),
    reviewerId: text('reviewer_id'),
    decisionReason: text('decision_reason'),
    decidedAt: ts('decided_at'),
    createdAt: createdAt(),
  },
  (t) => [
    check('appeals_reviewer_chk', sql`${t.reviewerId} is null or ${t.reviewerId} <> ${t.appellantDiscordId}`),
    index('appeals_status_idx').on(t.status, t.createdAt),
  ],
);
