/** Gemeinsame Status- und Typwerte. Datenbank, API, Bot und Dashboard verwenden dieselben Werte. */
export const FACTION_KEYS = ['polizei', 'feuerwehr', 'rettungsdienst', 'zivil'] as const;
export type FactionKey = (typeof FACTION_KEYS)[number];

export const ACCOUNT_LINK_STATUS = ['active', 'revoked'] as const;
export const MEMBERSHIP_STATUS = ['active', 'ended'] as const;
export const DUTY_STATUS = ['active', 'completed', 'auto_closed', 'invalidated'] as const;
export type DutyStatus = (typeof DUTY_STATUS)[number];
export const VEHICLE_STATUS = ['active', 'maintenance', 'disabled', 'retired'] as const;
export const TICKET_STATUS = ['open', 'claimed', 'waiting', 'closed'] as const;
export type TicketStatus = (typeof TICKET_STATUS)[number];
export const TICKET_PRIORITY = ['low', 'normal', 'high', 'urgent'] as const;
export const REPORT_STATUS = ['open', 'in_review', 'resolved', 'rejected'] as const;
export const CASE_STATUS = ['open', 'closed'] as const;
export const MODERATION_TYPES = ['warn', 'timeout', 'kick', 'ban', 'unban', 'note'] as const;
export type ModerationType = (typeof MODERATION_TYPES)[number];
export const MODERATION_PLATFORMS = ['discord', 'roblox'] as const;
export const MODERATION_STATUS = ['active', 'expired', 'revoked', 'pending_execution', 'failed', 'completed'] as const;
export const APPEAL_STATUS = ['open', 'accepted', 'rejected'] as const;
export const SUGGESTION_STATUS = ['open', 'under_review', 'accepted', 'rejected', 'implemented'] as const;
export const POLL_STATUS = ['open', 'closed'] as const;
export const GIVEAWAY_STATUS = ['open', 'drawn', 'cancelled'] as const;
export const ANNOUNCEMENT_STATUS = ['draft', 'scheduled', 'published'] as const;
export const MAINTENANCE_STATUS = ['scheduled', 'active', 'completed', 'cancelled'] as const;
export const CODE_STATUS = ['active', 'disabled'] as const;
export const INCIDENT_STATUS = ['open', 'investigating', 'monitoring', 'resolved'] as const;
export const INCIDENT_SEVERITY = ['sev1', 'sev2', 'sev3', 'sev4'] as const;
export const APPROVAL_STATUS = ['pending', 'approved', 'rejected', 'expired', 'executed', 'cancelled'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUS)[number];
export const RELEASE_STATUS = ['prepared', 'approved', 'deploying', 'deployed', 'failed', 'rolled_back'] as const;
export const BACKUP_STATUS = ['running', 'verifying', 'succeeded', 'failed'] as const;
export const PRIVACY_REQUEST_TYPES = ['export', 'deletion'] as const;
export const PRIVACY_REQUEST_STATUS = [
  'pending',
  'awaiting_approval',
  'processing',
  'completed',
  'rejected',
  'failed',
] as const;
export const AUTOMATION_TRIGGERS = [
  'backup_failed',
  'service_down',
  'release_deployed',
  'roblox_disconnected',
  'incident_created',
  'error_rate_high',
] as const;
export type AutomationTrigger = (typeof AUTOMATION_TRIGGERS)[number];
export const AUTOMATION_ACTIONS = ['notify_discord', 'create_incident', 'run_health_check'] as const;
export type AutomationAction = (typeof AUTOMATION_ACTIONS)[number];
export const ACTOR_TYPES = ['user', 'service', 'system', 'roblox_server'] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];
export const SECURITY_SEVERITY = ['info', 'warning', 'critical'] as const;
export const RECORD_TYPES = ['ticket', 'report', 'case', 'incident', 'appeal'] as const;
export type RecordType = (typeof RECORD_TYPES)[number];
export const ENVIRONMENT_KEYS = ['development', 'staging', 'production'] as const;
export const SERVICE_NAMES = ['api', 'bot', 'worker'] as const;

/** Feature-Flags, die der Code kennt. Weitere Flags können im Dashboard angelegt werden. */
export const KNOWN_FEATURE_FLAGS = {
  kill_switch: 'Notfall-Kill-Switch: stoppt alle nicht-lesenden Bot-Befehle und Roblox-Schreibereignisse',
  maintenance_mode: 'Wartungsmodus: Bot und Spiel zeigen Wartungshinweis, Schreibaktionen der Community sind gesperrt',
  verification: 'Roblox-Verifizierung über /verify',
  tickets: 'Ticket-System',
  reports: 'Spielerreports',
  suggestions: 'Vorschläge',
  giveaways: 'Giveaways',
  polls: 'Umfragen',
  code_redemption: 'Einlösen von Codes im Spiel',
  duty_tracking: 'Dienstzeiterfassung aus dem Spiel',
  automations: 'Automatisierungsregeln',
} as const;
export type KnownFeatureFlag = keyof typeof KNOWN_FEATURE_FLAGS;
