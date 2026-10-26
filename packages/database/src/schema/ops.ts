import { sql } from 'drizzle-orm';
import { bigint, bigserial, boolean, check, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import {
  ACTOR_TYPES,
  APPROVAL_STATUS,
  AUTOMATION_ACTIONS,
  AUTOMATION_TRIGGERS,
  BACKUP_STATUS,
  INCIDENT_SEVERITY,
  INCIDENT_STATUS,
  PRIVACY_REQUEST_STATUS,
  PRIVACY_REQUEST_TYPES,
  RELEASE_STATUS,
  SECURITY_SEVERITY,
} from '@enrp/shared';
import { createdAt, id, robloxId, ts, updatedAt } from './_helpers';

export const actorType = pgEnum('actor_type', ACTOR_TYPES);

/**
 * Unveränderliches Audit-Log. Jede Zeile enthält den Hash der vorherigen Zeile (Hash-Kette),
 * sodass nachträgliche Änderungen mit /audit verify erkannt werden. UPDATE/DELETE werden per Trigger blockiert.
 */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    occurredAt: ts('occurred_at').notNull().defaultNow(),
    actorType: actorType('actor_type').notNull(),
    actorId: text('actor_id'),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id'),
    reason: text('reason'),
    before: jsonb('before'),
    after: jsonb('after'),
    metadata: jsonb('metadata'),
    requestId: text('request_id'),
    prevHash: text('prev_hash').notNull(),
    hash: text('hash').notNull(),
  },
  (t) => [
    index('audit_events_occurred_idx').on(t.occurredAt),
    index('audit_events_actor_idx').on(t.actorId, t.occurredAt),
    index('audit_events_resource_idx').on(t.resourceType, t.resourceId),
    index('audit_events_action_idx').on(t.action),
  ],
);

export const securitySeverity = pgEnum('security_severity', SECURITY_SEVERITY);

/** Sicherheitsereignisse (fehlgeschlagene Anmeldungen, ungültige Signaturen, Replays …) ohne Geheimnisse. */
export const securityEvents = pgTable(
  'security_events',
  {
    id: id(),
    occurredAt: ts('occurred_at').notNull().defaultNow(),
    type: text('type').notNull(),
    severity: securitySeverity('severity').notNull().default('warning'),
    actorId: text('actor_id'),
    ipHash: text('ip_hash'),
    details: jsonb('details'),
  },
  (t) => [index('security_events_occurred_idx').on(t.occurredAt), index('security_events_type_idx').on(t.type)],
);

export const incidentStatus = pgEnum('incident_status', INCIDENT_STATUS);
export const incidentSeverity = pgEnum('incident_severity', INCIDENT_SEVERITY);

export const incidents = pgTable(
  'incidents',
  {
    id: id(),
    number: integer('number').generatedAlwaysAsIdentity().notNull().unique(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    severity: incidentSeverity('severity').notNull().default('sev3'),
    status: incidentStatus('status').notNull().default('open'),
    assigneeId: text('assignee_id'),
    source: text('source').notNull().default('manual'),
    /** Verhindert doppelte automatische Vorfälle für dieselbe Ursache. */
    dedupeKey: text('dedupe_key'),
    createdBy: text('created_by').notNull(),
    resolution: text('resolution'),
    resolvedBy: text('resolved_by'),
    resolvedAt: ts('resolved_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('incidents_status_idx').on(t.status, t.severity),
    uniqueIndex('incidents_open_dedupe_uq').on(t.dedupeKey).where(sql`${t.status} <> 'resolved' and ${t.dedupeKey} is not null`),
  ],
);

export const featureFlags = pgTable('feature_flags', {
  key: text('key').primaryKey(),
  description: text('description').notNull().default(''),
  enabled: boolean('enabled').notNull().default(true),
  updatedBy: text('updated_by'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Aktuelle Konfiguration (Schlüssel → JSON). */
export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedBy: text('updated_by'),
  updatedAt: updatedAt(),
});

/** Versionshistorie für Konfiguration, Feature-Flags und Rollen (Scope z. B. "setting:welcome"). */
export const configVersions = pgTable(
  'config_versions',
  {
    id: id(),
    scope: text('scope').notNull(),
    version: integer('version').notNull(),
    value: jsonb('value'),
    previous: jsonb('previous'),
    actorId: text('actor_id').notNull(),
    reason: text('reason'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('config_versions_scope_version_uq').on(t.scope, t.version)],
);

export const approvalStatus = pgEnum('approval_status', APPROVAL_STATUS);

/**
 * Vier-Augen-Freigaben. Der Payload-Hash bindet eine Freigabe an exakt die beantragte Aktion;
 * eine Freigabe kann genau einmal ausgeführt werden.
 */
export const approvalRequests = pgTable(
  'approval_requests',
  {
    id: id(),
    number: integer('number').generatedAlwaysAsIdentity().notNull().unique(),
    actionType: text('action_type').notNull(),
    summary: text('summary').notNull(),
    payload: jsonb('payload').notNull(),
    payloadHash: text('payload_hash').notNull(),
    reason: text('reason').notNull(),
    requestedBy: text('requested_by').notNull(),
    status: approvalStatus('status').notNull().default('pending'),
    decidedBy: text('decided_by'),
    decidedAt: ts('decided_at'),
    decisionReason: text('decision_reason'),
    expiresAt: ts('expires_at').notNull(),
    executedAt: ts('executed_at'),
    executedBy: text('executed_by'),
    executionResult: jsonb('execution_result'),
    createdAt: createdAt(),
  },
  (t) => [
    check('approval_requests_no_self_chk', sql`${t.decidedBy} is null or ${t.decidedBy} <> ${t.requestedBy}`),
    index('approval_requests_status_idx').on(t.status, t.expiresAt),
  ],
);

export const environments = pgTable('environments', {
  id: id(),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  url: text('url'),
  currentVersion: text('current_version'),
  /** Nicht geheime Konfigurationswerte (Schlüssel → Wert oder Fingerabdruck) für Vergleiche. */
  configSnapshot: jsonb('config_snapshot').notNull().default({}),
  requiresApproval: boolean('requires_approval').notNull().default(false),
  updatedAt: updatedAt(),
});

export const releaseStatus = pgEnum('release_status', RELEASE_STATUS);

export const releases = pgTable(
  'releases',
  {
    id: id(),
    number: integer('number').generatedAlwaysAsIdentity().notNull().unique(),
    version: text('version').notNull(),
    environmentId: uuid('environment_id')
      .notNull()
      .references(() => environments.id, { onDelete: 'restrict' }),
    kind: text('kind').notNull().default('deploy'),
    status: releaseStatus('status').notNull().default('prepared'),
    commitSha: text('commit_sha'),
    notes: text('notes').notNull().default(''),
    preparedBy: text('prepared_by').notNull(),
    approvedBy: text('approved_by'),
    approvalRequestId: uuid('approval_request_id'),
    pipelineRunUrl: text('pipeline_run_url'),
    deployedAt: ts('deployed_at'),
    failureReason: text('failure_reason'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('releases_env_idx').on(t.environmentId, t.createdAt),
    check('releases_no_self_approval_chk', sql`${t.approvedBy} is null or ${t.approvedBy} <> ${t.preparedBy}`),
  ],
);

export const backupStatus = pgEnum('backup_status', BACKUP_STATUS);

/** Ein Backup gilt erst nach erfolgreicher Integritätsprüfung (verified_at) als erfolgreich. */
export const backupRuns = pgTable(
  'backup_runs',
  {
    id: id(),
    kind: text('kind').notNull().default('scheduled'),
    status: backupStatus('status').notNull().default('running'),
    fileName: text('file_name'),
    storageLocation: text('storage_location'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    sha256: text('sha256'),
    verifiedAt: ts('verified_at'),
    verification: jsonb('verification'),
    error: text('error'),
    triggeredBy: text('triggered_by').notNull(),
    startedAt: ts('started_at').notNull().defaultNow(),
    finishedAt: ts('finished_at'),
    expiresAt: ts('expires_at'),
    deletedAt: ts('deleted_at'),
  },
  (t) => [index('backup_runs_started_idx').on(t.startedAt)],
);

export const restoreRequests = pgTable('restore_requests', {
  id: id(),
  backupId: uuid('backup_id')
    .notNull()
    .references(() => backupRuns.id, { onDelete: 'restrict' }),
  targetEnvironment: text('target_environment').notNull(),
  status: text('status').notNull().default('planned'),
  preview: jsonb('preview'),
  requestedBy: text('requested_by').notNull(),
  reason: text('reason').notNull(),
  approvalRequestId: uuid('approval_request_id'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const automationTrigger = pgEnum('automation_trigger', AUTOMATION_TRIGGERS);
export const automationAction = pgEnum('automation_action', AUTOMATION_ACTIONS);

/**
 * Automatisierungsregeln mit begrenztem Aktionsumfang. Cooldown und Ausführungstiefe
 * verhindern Endlosschleifen; kritische Aktionen sind nicht als Aktion verfügbar.
 */
export const automationRules = pgTable('automation_rules', {
  id: id(),
  name: text('name').notNull(),
  trigger: automationTrigger('trigger').notNull(),
  /** z. B. { "threshold": 3 } für "3 fehlgeschlagene Backups in Folge" */
  conditions: jsonb('conditions').notNull().default({}),
  action: automationAction('action').notNull(),
  actionConfig: jsonb('action_config').notNull().default({}),
  enabled: boolean('enabled').notNull().default(true),
  cooldownSeconds: integer('cooldown_seconds').notNull().default(900),
  lastFiredAt: ts('last_fired_at'),
  createdBy: text('created_by').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const automationRuns = pgTable(
  'automation_runs',
  {
    id: id(),
    ruleId: uuid('rule_id')
      .notNull()
      .references(() => automationRules.id, { onDelete: 'cascade' }),
    status: text('status').notNull(),
    test: boolean('test').notNull().default(false),
    depth: integer('depth').notNull().default(0),
    details: jsonb('details'),
    createdAt: createdAt(),
  },
  (t) => [index('automation_runs_rule_idx').on(t.ruleId, t.createdAt)],
);

/** Historie der Hintergrundjobs (die Warteschlange selbst liegt in Redis/BullMQ). */
export const jobRuns = pgTable(
  'job_runs',
  {
    id: id(),
    queue: text('queue').notNull(),
    name: text('name').notNull(),
    jobId: text('job_id'),
    status: text('status').notNull(),
    attempts: integer('attempts').notNull().default(0),
    error: text('error'),
    result: jsonb('result'),
    startedAt: ts('started_at').notNull().defaultNow(),
    finishedAt: ts('finished_at'),
  },
  (t) => [index('job_runs_started_idx').on(t.startedAt), index('job_runs_queue_idx').on(t.queue, t.status)],
);

export const privacyRequestType = pgEnum('privacy_request_type', PRIVACY_REQUEST_TYPES);
export const privacyRequestStatus = pgEnum('privacy_request_status', PRIVACY_REQUEST_STATUS);

export const privacyRequests = pgTable(
  'privacy_requests',
  {
    id: id(),
    number: integer('number').generatedAlwaysAsIdentity().notNull().unique(),
    type: privacyRequestType('type').notNull(),
    subjectDiscordId: text('subject_discord_id'),
    subjectRobloxId: robloxId('subject_roblox_id'),
    status: privacyRequestStatus('status').notNull().default('pending'),
    requestedBy: text('requested_by').notNull(),
    reason: text('reason').notNull(),
    approvalRequestId: uuid('approval_request_id'),
    preview: jsonb('preview'),
    /** Exportdaten werden nach Ablauf (expires_at) automatisch gelöscht. */
    result: jsonb('result'),
    completedAt: ts('completed_at'),
    expiresAt: ts('expires_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check('privacy_requests_subject_chk', sql`${t.subjectDiscordId} is not null or ${t.subjectRobloxId} is not null`)],
);

/** Lebenszeichen von Bot, Worker und API-Instanzen. */
export const serviceHeartbeats = pgTable(
  'service_heartbeats',
  {
    service: text('service').notNull(),
    instanceId: text('instance_id').notNull(),
    version: text('version'),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
    startedAt: ts('started_at').notNull().defaultNow(),
    info: jsonb('info'),
  },
  (t) => [primaryKey({ columns: [t.service, t.instanceId] })],
);

/** Idempotenzschlüssel für wiederholbare Schreibanfragen (Header "Idempotency-Key"). */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    scope: text('scope').notNull(),
    key: text('key').notNull(),
    requestHash: text('request_hash').notNull(),
    statusCode: integer('status_code'),
    response: jsonb('response'),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.scope, t.key] }), index('idempotency_keys_created_idx').on(t.createdAt)],
);

/** Nonces der Roblox-Serveranfragen (Replay-Schutz innerhalb des Zeitfensters). */
export const requestNonces = pgTable(
  'request_nonces',
  {
    nonce: text('nonce').primaryKey(),
    apiKeyId: uuid('api_key_id'),
    receivedAt: ts('received_at').notNull().defaultNow(),
  },
  (t) => [index('request_nonces_received_idx').on(t.receivedAt)],
);
