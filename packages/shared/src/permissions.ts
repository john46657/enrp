/**
 * Zentrale Berechtigungsdefinition von Emden Network.
 *
 * Rollen sind abstrakte Schlüssel. Welche Discord-Rolle welchem Schlüssel entspricht, steht in
 * guild_config.role_map – nicht im Code. Jede Prüfung erfolgt serverseitig zum Zeitpunkt der Aktion;
 * das Verbergen von Commands ist kein Zugriffsschutz.
 */

export const ROLE_KEYS = [
  'owner',
  'management',
  'polizeileitung',
  'feuerwehrleitung',
  'rettungsdienstleitung',
  'moderator',
  'fraktionsmitglied',
  'verifiziert',
  'unverified',
] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

export const ROLE_LABELS: Record<RoleKey, string> = {
  owner: 'Owner',
  management: 'Management',
  polizeileitung: 'Polizeileitung',
  feuerwehrleitung: 'Feuerwehrleitung',
  rettungsdienstleitung: 'Rettungsdienstleitung',
  moderator: 'Moderator',
  fraktionsmitglied: 'Fraktionsmitglied',
  verifiziert: 'Verifiziert',
  unverified: 'Unverified',
};

export const FACTION_KEYS = ['polizei', 'feuerwehr', 'rettungsdienst', 'zivil'] as const;
export type FactionKey = (typeof FACTION_KEYS)[number];

/** Leitungsrolle -> Fraktion, die sie verwalten darf. */
export const LEADERSHIP_FACTION: Partial<Record<RoleKey, FactionKey>> = {
  polizeileitung: 'polizei',
  feuerwehrleitung: 'feuerwehr',
  rettungsdienstleitung: 'rettungsdienst',
};

interface PermissionDef {
  description: string;
  /** Rollen, die die Berechtigung global (fraktionsübergreifend) besitzen. */
  global: readonly RoleKey[];
  /** true: Fraktionsleitungen besitzen die Berechtigung für ihre eigene Fraktion. */
  leadershipScoped?: boolean;
  /** Mindestens diese Rolle wird zusätzlich vorausgesetzt (z. B. verifiziert für Selbstauskunft). */
  self?: readonly RoleKey[];
}

const STAFF_TOP = ['owner', 'management'] as const;
const MODS = ['owner', 'management', 'moderator'] as const;

export const PERMISSIONS = {
  'self.read': { description: 'Eigene Daten einsehen', global: ['owner', 'management', 'moderator', 'verifiziert'] },
  'player.read_any': { description: 'Profile anderer Spieler einsehen', global: MODS, leadershipScoped: true },
  'faction.read': { description: 'Fraktionsinfos und Dienstplan einsehen', global: ['owner', 'management', 'moderator', 'verifiziert'] },
  'faction.manage_members': { description: 'Mitglieder aufnehmen, entfernen, Ränge ändern', global: STAFF_TOP, leadershipScoped: true },
  'faction.announce': { description: 'Fraktionsankündigung senden', global: STAFF_TOP, leadershipScoped: true },
  'faction.audit': { description: 'Fraktions-Audit einsehen', global: STAFF_TOP, leadershipScoped: true },
  'duty.self': { description: 'Eigenen Dienst starten/beenden', global: ['owner', 'management', 'verifiziert'] },
  'duty.view_faction': { description: 'Dienststatus und Statistiken einer Fraktion', global: STAFF_TOP, leadershipScoped: true },
  'duty.correct': { description: 'Dienstsitzungen korrigieren', global: STAFF_TOP, leadershipScoped: true },
  'duty.export': { description: 'Dienstzeiten exportieren', global: STAFF_TOP, leadershipScoped: true },
  'applications.submit': { description: 'Bewerbung einreichen', global: ['verifiziert'] },
  'applications.review': { description: 'Bewerbungen bearbeiten', global: STAFF_TOP, leadershipScoped: true },
  'training.manage': { description: 'Ausbildungen anlegen und abschließen', global: STAFF_TOP, leadershipScoped: true },
  'training.attend': { description: 'An Ausbildung teilnehmen', global: ['verifiziert'] },
  'ticket.create': { description: 'Ticket/Meldung erstellen', global: ['owner', 'management', 'moderator', 'verifiziert', 'unverified'] },
  'ticket.staff': { description: 'Tickets übernehmen und schließen', global: MODS },
  'moderation.warn': { description: 'Verwarnen', global: MODS },
  'moderation.timeout': { description: 'Discord-Timeout', global: MODS },
  'moderation.case_view': { description: 'Moderationsfälle einsehen', global: MODS },
  'moderation.game_kick': { description: 'Spieler aus dem Spiel kicken', global: MODS },
  'moderation.game_ban': { description: 'Spieler im Spiel bannen', global: STAFF_TOP },
  'server.view': { description: 'Serverstatus einsehen', global: ['owner', 'management', 'moderator', 'verifiziert'] },
  'server.announce': { description: 'Ingame-Ankündigungen', global: STAFF_TOP },
  'server.maintenance': { description: 'Wartungsmodus setzen', global: STAFF_TOP },
  'gameevent.manage': { description: 'Spielevents verwalten', global: STAFF_TOP },
  'system.health': { description: 'Systemzustand einsehen', global: MODS },
  'system.audit': { description: 'Audit-Log einsehen', global: STAFF_TOP },
  'system.config': { description: 'Konfiguration ändern', global: ['owner'] },
  'verification.revoke_any': { description: 'Verknüpfung anderer Nutzer aufheben', global: STAFF_TOP },
} as const satisfies Record<string, PermissionDef>;

export type Permission = keyof typeof PERMISSIONS;

export interface Actor {
  discordId: string;
  roles: ReadonlySet<RoleKey>;
}

export interface PermissionContext {
  /** Fraktion, auf die sich die Aktion bezieht (für leitungsbezogene Rechte). */
  faction?: FactionKey;
}

export interface PermissionDecision {
  allowed: boolean;
  reason: 'global' | 'leadership' | 'missing_role' | 'wrong_faction' | 'faction_required';
}

export function checkPermission(actor: Actor, permission: Permission, ctx: PermissionContext = {}): PermissionDecision {
  const def: PermissionDef = PERMISSIONS[permission];
  if (def.global.some((r) => actor.roles.has(r))) return { allowed: true, reason: 'global' };
  if (def.leadershipScoped) {
    const ledFactions = leadershipFactions(actor);
    if (ledFactions.length > 0) {
      if (!ctx.faction) return { allowed: false, reason: 'faction_required' };
      return ledFactions.includes(ctx.faction) ? { allowed: true, reason: 'leadership' } : { allowed: false, reason: 'wrong_faction' };
    }
  }
  return { allowed: false, reason: 'missing_role' };
}

export function leadershipFactions(actor: Actor): FactionKey[] {
  const out: FactionKey[] = [];
  for (const role of actor.roles) {
    const f = LEADERSHIP_FACTION[role];
    if (f) out.push(f);
  }
  return out;
}

/**
 * Löst Discord-Rollen-IDs eines Mitglieds anhand der role_map zu Rollenschlüsseln auf.
 * Unbekannte Schlüssel in der role_map werden ignoriert.
 */
export function resolveRoleKeys(memberRoleIds: Iterable<string>, roleMap: Partial<Record<string, string>>): Set<RoleKey> {
  const ids = new Set(memberRoleIds);
  const keys = new Set<RoleKey>();
  for (const key of ROLE_KEYS) {
    const id = roleMap[key];
    if (id && ids.has(id)) keys.add(key);
  }
  return keys;
}
