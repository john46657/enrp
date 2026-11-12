import { type PermissionKey } from './catalog';
import { can, type Subject } from './evaluate';

/**
 * Altmodule (apps/bot/legacy). Plattform-Rechte und Rollen-Overrides gelten zusätzlich zu den bisherigen
 * Discord-Rechten bzw. Staff-/Support-Rollen der Altmodule: wer bisher durfte, darf weiterhin.
 */
export const LEGACY_COMMAND_PERMISSIONS: Record<string, PermissionKey | null> = {
  bewerbung: null,
  'bewerbungen offen': 'applications:view',
  'bewerbungen in-bearbeitung': 'applications:view',
  'bewerbungen anzeigen': 'applications:view',
  'bewerbungen verlauf': 'applications:view',
  'bewerbungen statistik': 'applications:view',
  'bewerbungen loeschen': 'applications:delete',
  'bewerbungssperre hinzufuegen': 'applications:edit',
  'bewerbungssperre aufheben': 'applications:edit',
  'bewerbungssperre liste': 'applications:view',
  bewerbungspanel: 'applications:configure',
  ...Object.fromEntries(
    [
      'uebersicht',
      'erstellen',
      'bearbeiten',
      'loeschen',
      'texte',
      'fragen',
      'frage-hinzufuegen',
      'frage-bearbeiten',
      'frage-entfernen',
      'frage-verschieben',
      'phase',
      'dienstnummer',
    ].map((sub) => [`bewerbung-verwalten ${sub}`, 'applications:configure'] as const),
  ),
  'dienstnummer anzeigen': null,
  'dienstnummer liste': 'applications:view',
  'dienstnummer setzen': 'applications:edit',
  'dienstnummer entfernen': 'applications:edit',
  bestenliste: null,
  rang: null,
  rollenpanel: 'community:create',
  clear: 'moderation:delete',
  'ticket panel': 'settings:edit',
  'ticket schliessen': 'tickets:edit',
  'ticket fuer': 'tickets:create',
  'ticket hinzufuegen': 'tickets:edit',
  'ticket entfernen': 'tickets:edit',
  ...Object.fromEntries(
    [
      'anzeigen',
      'kanal',
      'rolle',
      'tickets',
      'ticket-panel',
      'ticket-kategorie',
      'ticket-kategorie-neu',
      'ticket-kategorie-loeschen',
      'ticket-formular',
      'oeffnungszeiten',
      'bewerbung',
      'bewerbungs-kanaele',
      'willkommen',
      'level',
      'roblox',
      'statistik',
      'zeitzone',
      'zuruecksetzen',
    ].map((sub) => [`einstellungen ${sub}`, sub === 'anzeigen' ? 'settings:view' : 'settings:edit'] as const),
  ),
};

/**
 * Buttons, Menüs und Formulare der Altmodule, die bisher nur die Staff-/Support-Rollen der Altmodule geprüft haben
 * (customId "präfix:aktion:…"). Wer das Plattform-Recht hat, gilt bei dieser Aktion als Staff – zusätzlich zu den
 * bisherigen Rollen. Nicht aufgeführte Aktionen (Ticket öffnen, bewerben, Rollenpanel) sind für alle.
 */
export const LEGACY_COMPONENT_PERMISSIONS: Record<string, PermissionKey> = {
  ...Object.fromEntries(
    [
      'claim',
      'unclaim',
      'addok',
      'addno',
      'close',
      'closeyes',
      'closereason',
      'closemodal',
      'closeform',
      'closeformmodal',
      'closeaccept',
      'closedeny',
      'closeno',
    ].map((action) => [`ticket:${action}`, 'tickets:edit'] as const),
  ),
  'quali:decide': 'applications:edit',
  'quali:reason': 'applications:edit',
  'quali:reasonsubmit': 'applications:edit',
  'quali:status': 'applications:edit',
  'quali:ticket': 'applications:edit',
  'quali:history': 'applications:view',
};

/** Plattform-Recht für eine Komponente der Altmodule (null = keine Staff-Aktion). */
export function legacyComponentPermission(customId: string): PermissionKey | null {
  const [prefix, action] = customId.split(':');
  return LEGACY_COMPONENT_PERMISSIONS[`${prefix}:${action}`] ?? null;
}

/**
 * Altmodule im Dashboard (Anfragen an den Bot, siehe packages/core legacy.ts).
 * Daten lesen: Name → benötigtes Recht (eines davon genügt).
 */
export const LEGACY_LIVE: Record<string, readonly PermissionKey[]> = {
  // Einstellungen der Altmodule samt Kanälen und Rollen des Haupt-Discords (für Auswahlfelder)
  guild: ['settings:view', 'applications:view', 'community:view', 'tickets:view'],
  applications: ['applications:view'],
  'app-progress': ['applications:view'],
  'app-bans': ['applications:view'],
  'app-stats': ['applications:view'],
  levels: ['community:view'],
  tickets: ['tickets:view'],
};

/** Aktionen: Name → benötigtes Recht. */
export const LEGACY_ACTIONS: Record<string, PermissionKey> = {
  'app-decide': 'applications:edit',
  'app-status': 'applications:edit',
  'app-note': 'applications:edit',
  'app-ban-add': 'applications:edit',
  'app-ban-lift': 'applications:edit',
  'app-delete': 'applications:delete',
  'app-panel-post': 'applications:configure',
  'ticket-panel-post': 'settings:edit',
  'ticket-panels-refresh': 'settings:edit',
  'role-panel-post': 'community:create',
  'level-set': 'community:edit',
  'level-reset': 'community:delete',
};

/** Bereiche der Einstellungen, die das Dashboard ändern darf, mit dem jeweils nötigen Recht. */
export const LEGACY_SETTING_ROOTS: Record<string, PermissionKey> = {
  timezone: 'settings:edit',
  channels: 'settings:edit',
  roles: 'settings:edit',
  welcome: 'settings:edit',
  tickets: 'settings:edit',
  leveling: 'settings:edit',
  roblox: 'settings:edit',
  stats: 'settings:edit',
  applications: 'applications:configure',
};

/**
 * Standard-Berechtigung je Slash-Command (Befehl + Unterbefehl, getrennt durch Leerzeichen).
 * "null" = für alle Mitglieder verfügbar. Rollen-Overrides (/permissions grant|revoke)
 * gelten pro Hauptbefehl oder pro Unterbefehl.
 */
export const COMMAND_PERMISSIONS: Record<string, PermissionKey | null> = {
  'verify start': null,
  'verify status': null,
  'verify unlink': null,
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
  'cad list': 'dispatch:view',
  'cad info': 'dispatch:view',
  'cad create': 'dispatch:create',
  'cad assign': 'dispatch:edit',
  'cad status': 'dispatch:edit',
  'cad note': 'dispatch:edit',
  'cad close': 'dispatch:edit',
  'cad unit': 'dispatch:edit',
  'cad units': 'dispatch:view',
  'bolo list': 'dispatch:view',
  'bolo vehicle': 'dispatch:create',
  'bolo person': 'dispatch:create',
  'bolo clear': 'dispatch:edit',
  'ingame jail': 'player_actions:edit',
  'ingame unjail': 'player_actions:edit',
  'ingame wanted': 'player_actions:edit',
  'ingame heal': 'player_actions:edit',
  'ingame respawn': 'player_actions:edit',
  'ingame team': 'player_actions:edit',
  'ingame pm': 'player_actions:edit',
  'ingame kill': 'player_actions:delete',
  'ingame kick': 'player_actions:delete',
  'live players': 'roblox_servers:view',
  'live vehicles': 'roblox_servers:view',
  'live plate': 'roblox_servers:view',
  status: null,
  hilfe: null,
  ...LEGACY_COMMAND_PERMISSIONS,
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
