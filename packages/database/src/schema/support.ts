import { boolean, index, integer, jsonb, pgEnum, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { CASE_STATUS, RECORD_TYPES, REPORT_STATUS, TICKET_PRIORITY, TICKET_STATUS } from '@enrp/shared';
import { createdAt, id, robloxId, ts, updatedAt } from './_helpers';

export const ticketStatus = pgEnum('ticket_status', TICKET_STATUS);
export const ticketPriority = pgEnum('ticket_priority', TICKET_PRIORITY);

export const tickets = pgTable(
  'tickets',
  {
    id: id(),
    number: integer('number').generatedAlwaysAsIdentity().notNull().unique(),
    category: text('category').notNull().default('general'),
    subject: text('subject').notNull(),
    status: ticketStatus('status').notNull().default('open'),
    priority: ticketPriority('priority').notNull().default('normal'),
    creatorDiscordId: text('creator_discord_id').notNull(),
    assigneeDiscordId: text('assignee_discord_id'),
    team: text('team'),
    /** Discord-Kanal des Tickets (falls über das Discord-Ticketpanel eröffnet). */
    discordChannelId: text('discord_channel_id').unique(),
    closeReason: text('close_reason'),
    closedBy: text('closed_by'),
    closedAt: ts('closed_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('tickets_status_idx').on(t.status, t.createdAt),
    index('tickets_creator_idx').on(t.creatorDiscordId),
    index('tickets_assignee_idx').on(t.assigneeDiscordId),
  ],
);

export const reportStatus = pgEnum('report_status', REPORT_STATUS);

/** Spielerreports und Meldungen über Regelverstöße. */
export const reports = pgTable(
  'reports',
  {
    id: id(),
    number: integer('number').generatedAlwaysAsIdentity().notNull().unique(),
    reporterDiscordId: text('reporter_discord_id').notNull(),
    reportedRobloxId: robloxId('reported_roblox_id'),
    reportedDiscordId: text('reported_discord_id'),
    ruleReference: text('rule_reference'),
    description: text('description').notNull(),
    status: reportStatus('status').notNull().default('open'),
    assigneeDiscordId: text('assignee_discord_id'),
    resolution: text('resolution'),
    resolvedBy: text('resolved_by'),
    resolvedAt: ts('resolved_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('reports_status_idx').on(t.status, t.createdAt),
    index('reports_reported_roblox_idx').on(t.reportedRobloxId),
    index('reports_reported_discord_idx').on(t.reportedDiscordId),
  ],
);

export const caseStatus = pgEnum('case_status', CASE_STATUS);

/** Fallberichte, die mehrere Reports, Tickets oder Moderationsaktionen bündeln. */
export const caseReports = pgTable(
  'case_reports',
  {
    id: id(),
    number: integer('number').generatedAlwaysAsIdentity().notNull().unique(),
    title: text('title').notNull(),
    summary: text('summary').notNull(),
    status: caseStatus('status').notNull().default('open'),
    subjectRobloxId: robloxId('subject_roblox_id'),
    subjectDiscordId: text('subject_discord_id'),
    createdBy: text('created_by').notNull(),
    closedBy: text('closed_by'),
    closedAt: ts('closed_at'),
    closeReason: text('close_reason'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('case_reports_status_idx').on(t.status),
    index('case_reports_subject_roblox_idx').on(t.subjectRobloxId),
  ],
);

export const caseReferenceKind = pgEnum('case_reference_kind', [
  'url',
  'report',
  'ticket',
  'moderation_action',
  'discord_message',
]);

/**
 * Anhänge werden nicht als Dateien gespeichert, sondern als Referenzen (geprüfte HTTPS-URLs oder interne IDs).
 * So landen keine sensiblen Dateien in der Datenbank.
 */
export const caseReferences = pgTable('case_references', {
  id: id(),
  caseId: uuid('case_id')
    .notNull()
    .references(() => caseReports.id, { onDelete: 'cascade' }),
  kind: caseReferenceKind('kind').notNull(),
  value: text('value').notNull(),
  label: text('label'),
  addedBy: text('added_by').notNull(),
  createdAt: createdAt(),
});

export const recordType = pgEnum('record_type', RECORD_TYPES);

/** Zeitleiste und Notizen für Tickets, Reports, Fälle, Vorfälle und Einsprüche. */
export const recordEvents = pgTable(
  'record_events',
  {
    id: id(),
    recordType: recordType('record_type').notNull(),
    recordId: uuid('record_id').notNull(),
    type: text('type').notNull(),
    actorId: text('actor_id'),
    body: text('body'),
    /** Interne Notizen sind nur für berechtigte Teammitglieder sichtbar. */
    internal: boolean('internal').notNull().default(false),
    data: jsonb('data'),
    createdAt: createdAt(),
  },
  (t) => [index('record_events_record_idx').on(t.recordType, t.recordId, t.createdAt)],
);
