import { type PermissionKey } from './catalog';
import { can, type Subject } from './evaluate';

/**
 * Standard-Berechtigung je Slash-Command (Befehl + Unterbefehl, getrennt durch Leerzeichen).
 * "null" = für alle Mitglieder verfügbar. Rollen-Overrides (/permissions grant|revoke)
 * gelten pro Hauptbefehl oder pro Unterbefehl.
 */
export const COMMAND_PERMISSIONS: Record<string, PermissionKey | null> = {
  verify: null,
  'verify start': null,
  'verify status': null,
  'verify unlink': null,
  profile: null,
  'profile me': null,
  'profile view': 'players:view',
  'profile history': 'player_private:view',
  'leaderboard playtime': null,
  'leaderboard duty': null,
  'faction list': null,
  'faction members': 'factions:view',
  'faction add': 'factions:edit',
  'faction transfer': 'factions:edit',
  'faction remove': 'factions:edit',
  'duty status': null,
  'duty stats': null,
  'duty sessions': 'duty:view',
  'vehicle list': 'vehicles:view',
  'vehicle info': 'vehicles:view',
  'ticket create': null,
  'ticket claim': 'tickets:edit',
  'ticket assign': 'tickets:edit',
  'ticket note': 'ticket_internal:create',
  'ticket status': 'tickets:edit',
  'ticket close': 'tickets:edit',
  'ticket view': 'tickets:view',
  report: null,
  'report create': null,
  'report list': 'reports:view',
  'report resolve': 'reports:edit',
  'mod warn': 'moderation:create',
  'mod timeout': 'moderation:create',
  'mod kick': 'moderation:create',
  'mod ban': 'moderation:create',
  'mod unban': 'moderation:edit',
  'mod history': 'moderation:view',
  'mod revoke': 'moderation:edit',
  'appeal create': null,
  'appeal review': 'appeals:approve',
  'suggest create': null,
  'suggest status': 'community:edit',
  'giveaway create': 'community:create',
  'giveaway draw': 'community:edit',
  'giveaway cancel': 'community:edit',
  'poll create': 'community:create',
  'poll close': 'community:edit',
  'announce create': 'announcements:publish',
  'rules show': null,
  'rules accept': null,
  'permissions view': 'permissions:view',
  'permissions grant': 'permissions:edit',
  'permissions revoke': 'permissions:edit',
  'permissions test': 'permissions:view',
  'permissions reset': 'permissions:edit',
  'incident create': 'incidents:create',
  'incident assign': 'incidents:edit',
  'incident update': 'incidents:edit',
  'incident resolve': 'incidents:edit',
  'incident history': 'incidents:view',
  'ops health': 'monitoring:view',
  'ops metrics': 'monitoring:view',
  'ops dependencies': 'monitoring:view',
  'ops queue': 'jobs:view',
  'ops alerts': 'monitoring:view',
  'feature list': 'feature_flags:view',
  'feature enable': 'feature_flags:edit',
  'feature disable': 'feature_flags:edit',
  'feature status': 'feature_flags:view',
  'feature history': 'feature_flags:view',
  'deploy status': 'releases:view',
  'deploy prepare': 'releases:create',
  'deploy approve': 'releases:approve',
  'deploy history': 'releases:view',
  'deploy rollback': 'releases:create',
  'env status': 'releases:view',
  'env compare': 'releases:view',
  'env config-diff': 'releases:view',
  'env promote': 'releases:create',
  'env history': 'releases:view',
  'audit search': 'audit:view',
  'audit diff': 'audit:view',
  'audit export': 'audit:export',
  'audit verify': 'audit:view',
  'audit retention': 'audit:view',
  'data inspect': 'privacy:view',
  'data export': 'privacy:export',
  'data deletion-request': 'privacy:delete',
  'data retention': 'privacy:view',
  'data cleanup-preview': 'privacy:view',
  'automation list': 'automations:view',
  'automation create': 'automations:create',
  'automation pause': 'automations:edit',
  'automation test': 'automations:edit',
  'automation history': 'automations:view',
  'approval create': 'approvals:create',
  'approval view': 'approvals:view',
  'approval approve': 'approvals:approve',
  'approval reject': 'approvals:approve',
  'approval pending': 'approvals:view',
  'backup status': 'backups:view',
  'backup run': 'backups:create',
  'killswitch status': 'feature_flags:view',
  'killswitch activate': 'feature_flags:edit',
  'killswitch deactivate': 'feature_flags:edit',
  status: null,
  hilfe: null,
};

/** Befehle, die nicht per Rollen-Override für weitere Rollen geöffnet werden dürfen. */
export const LOCKED_COMMANDS: ReadonlySet<string> = new Set([
  'permissions grant',
  'permissions revoke',
  'permissions reset',
  'deploy approve',
  'deploy rollback',
  'env promote',
  'data deletion-request',
  'audit export',
  'approval approve',
  'approval reject',
]);

export interface CommandOverride {
  command: string;
  discordRoleId: string;
  effect: 'allow' | 'deny';
}

export interface CommandAccessResult {
  allowed: boolean;
  source: 'public' | 'permission' | 'override-allow' | 'override-deny' | 'owner' | 'unknown-command';
  permission: string | null;
}

export function isKnownCommand(command: string): boolean {
  return command in COMMAND_PERMISSIONS;
}

/**
 * Entscheidet, ob ein Mitglied einen Befehl ausführen darf.
 * Reihenfolge: Owner → Deny-Override → Allow-Override → Standard-Berechtigung.
 * Overrides auf den Unterbefehl haben Vorrang vor Overrides auf den Hauptbefehl.
 */
export function resolveCommandAccess(
  command: string,
  subject: Subject,
  memberRoleIds: readonly string[],
  overrides: readonly CommandOverride[],
): CommandAccessResult {
  if (!isKnownCommand(command)) return { allowed: false, source: 'unknown-command', permission: null };
  const permission = COMMAND_PERMISSIONS[command] ?? null;
  if (subject.isOwner) return { allowed: true, source: 'owner', permission };

  const root = command.split(' ')[0]!;
  const roles = new Set(memberRoleIds);
  for (const key of command === root ? [command] : [command, root]) {
    const relevant = overrides.filter((o) => o.command === key && roles.has(o.discordRoleId));
    if (relevant.some((o) => o.effect === 'deny')) return { allowed: false, source: 'override-deny', permission };
    if (relevant.some((o) => o.effect === 'allow') && !LOCKED_COMMANDS.has(command)) {
      return { allowed: true, source: 'override-allow', permission };
    }
  }

  if (permission === null) return { allowed: true, source: 'public', permission };
  return { allowed: can(subject, permission), source: 'permission', permission };
}
