import { isCriticalPattern, isFactionScoped } from './catalog';

/**
 * Eine Berechtigungszuweisung einer Rolle. "factionIds" schränkt fraktionsbezogene
 * Rechte auf bestimmte Fraktionen ein (z. B. Fraktionsverwaltung Polizei).
 */
export interface Grant {
  permission: string;
  factionIds?: string[] | null;
}

export interface Subject {
  /** Owner (aus OWNER_DISCORD_IDS) haben alle Rechte. */
  isOwner: boolean;
  grants: Grant[];
}

export interface ResourceContext {
  factionId?: string | null;
}

function patternMatches(pattern: string, permission: string): boolean {
  if (pattern === '*' || pattern === permission) return true;
  if (pattern.endsWith(':*')) return permission.startsWith(pattern.slice(0, -1));
  return false;
}

function isScoped(grant: Grant): boolean {
  return Array.isArray(grant.factionIds) && grant.factionIds.length > 0;
}

/**
 * Prüft, ob das Subjekt eine Berechtigung besitzt. Eingeschränkte Zuweisungen greifen nur,
 * wenn die Ressource zu einer der erlaubten Fraktionen gehört.
 */
export function can(subject: Subject, permission: string, resource: ResourceContext = {}): boolean {
  if (subject.isOwner) return true;
  for (const grant of subject.grants) {
    if (!patternMatches(grant.permission, permission)) continue;
    if (!isScoped(grant)) return true;
    if (resource.factionId && grant.factionIds!.includes(resource.factionId)) return true;
  }
  return false;
}

export type Scope = { kind: 'all' } | { kind: 'factions'; factionIds: string[] } | { kind: 'none' };

/** Für Listen: Auf welche Fraktionen darf das Subjekt mit dieser Berechtigung zugreifen? */
export function scopeFor(subject: Subject, permission: string): Scope {
  if (subject.isOwner) return { kind: 'all' };
  const factionIds = new Set<string>();
  for (const grant of subject.grants) {
    if (!patternMatches(grant.permission, permission)) continue;
    if (!isScoped(grant)) return { kind: 'all' };
    for (const id of grant.factionIds!) factionIds.add(id);
  }
  return factionIds.size ? { kind: 'factions', factionIds: [...factionIds] } : { kind: 'none' };
}

/** Prüft, ob die eigenen Rechte eine Zuweisung vollständig abdecken. */
export function covers(subject: Subject, grant: Grant): boolean {
  if (subject.isOwner) return true;
  if (grant.permission === '*') {
    return subject.grants.some((g) => g.permission === '*' && !isScoped(g));
  }
  if (grant.permission.endsWith(':*')) {
    const prefix = grant.permission;
    return subject.grants.some((g) => (g.permission === '*' || g.permission === prefix) && !isScoped(g));
  }
  if (!isScoped(grant) || !isFactionScoped(grant.permission)) return can(subject, grant.permission);
  return grant.factionIds!.every((factionId) => can(subject, grant.permission, { factionId }));
}

export interface GrantChangeCheck {
  allowed: boolean;
  /** Änderung ist erlaubt, braucht aber eine zweite Freigabe. */
  requiresApproval: boolean;
  /** Zuweisungen, die die eigenen Rechte übersteigen. */
  exceeding: Grant[];
  reason?: string;
}

/**
 * Schutz gegen Rechteausweitung: Eine Rolle darf nur Rechte erhalten, die der Akteur selbst besitzt.
 * Kritische Rechte (und Wildcards) brauchen zusätzlich das Vier-Augen-Prinzip.
 */
export function checkGrantChange(actor: Subject, nextGrants: Grant[], previousGrants: Grant[] = []): GrantChangeCheck {
  if (!can(actor, 'permissions:edit')) {
    return {
      allowed: false,
      requiresApproval: false,
      exceeding: [],
      reason: 'Dir fehlt die Berechtigung permissions:edit.',
    };
  }
  const previousKeys = new Set(previousGrants.map(grantKey));
  const added = nextGrants.filter((g) => !previousKeys.has(grantKey(g)));
  const exceeding = added.filter((g) => !covers(actor, g));
  if (exceeding.length) {
    return {
      allowed: false,
      requiresApproval: false,
      exceeding,
      reason: 'Du kannst keine Rechte vergeben, die du selbst nicht besitzt.',
    };
  }
  const nextKeys = new Set(nextGrants.map(grantKey));
  const removed = previousGrants.filter((g) => !nextKeys.has(grantKey(g)));
  const touchesCritical = [...added, ...removed].some((g) => isCriticalPattern(g.permission));
  return { allowed: true, requiresApproval: touchesCritical && !actor.isOwner, exceeding: [] };
}

export function grantKey(grant: Grant): string {
  const scope = isScoped(grant) ? [...grant.factionIds!].sort().join(',') : '';
  return `${grant.permission}|${scope}`;
}

/** Vereinigt Zuweisungen mehrerer Rollen, Duplikate werden entfernt. */
export function mergeGrants(...lists: Grant[][]): Grant[] {
  const map = new Map<string, Grant>();
  for (const grant of lists.flat()) map.set(grantKey(grant), grant);
  return [...map.values()];
}
