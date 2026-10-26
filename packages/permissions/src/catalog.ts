/**
 * Zentraler Berechtigungskatalog. Eine Berechtigung hat die Form "ressource:aktion".
 * Bot, API und Dashboard verwenden ausschließlich diese Schlüssel.
 */
export const ACTIONS = ['view', 'create', 'edit', 'delete', 'approve', 'export', 'publish', 'configure'] as const;
export type Action = (typeof ACTIONS)[number];

export const ACTION_LABELS: Record<Action, string> = {
  view: 'Anzeigen',
  create: 'Erstellen',
  edit: 'Bearbeiten',
  delete: 'Löschen',
  approve: 'Genehmigen',
  export: 'Exportieren',
  publish: 'Veröffentlichen',
  configure: 'Systemkonfiguration ändern',
};

interface ResourceDefinition {
  label: string;
  group: string;
  actions: readonly Action[];
  /** Ressourcen, deren Rechte auf einzelne Fraktionen eingeschränkt werden können. */
  factionScoped?: boolean;
}

export const RESOURCES = {
  players: { label: 'Spieler (öffentlich)', group: 'Spieler & Community', actions: ['view', 'edit', 'export'] },
  player_private: { label: 'Spieler (interne Daten)', group: 'Spieler & Community', actions: ['view'] },
  verification: {
    label: 'Verifizierung & Kontoverknüpfung',
    group: 'Spieler & Community',
    actions: ['view', 'edit', 'delete'],
  },
  factions: {
    label: 'Fraktionen',
    group: 'Spieler & Community',
    actions: ['view', 'create', 'edit', 'delete', 'configure'],
    factionScoped: true,
  },
  duty: {
    label: 'Dienstsystem',
    group: 'Spieler & Community',
    actions: ['view', 'edit', 'export'],
    factionScoped: true,
  },
  vehicles: {
    label: 'Fahrzeuge',
    group: 'Spieler & Community',
    actions: ['view', 'create', 'edit', 'delete'],
    factionScoped: true,
  },
  tickets: { label: 'Tickets', group: 'Support', actions: ['view', 'create', 'edit', 'delete'] },
  ticket_internal: { label: 'Interne Ticket-Notizen', group: 'Support', actions: ['view', 'create'] },
  reports: { label: 'Spielerreports', group: 'Support', actions: ['view', 'create', 'edit'] },
  cases: { label: 'Fallberichte', group: 'Support', actions: ['view', 'create', 'edit'] },
  moderation: { label: 'Moderation', group: 'Moderation', actions: ['view', 'create', 'edit', 'delete', 'approve'] },
  appeals: { label: 'Einsprüche', group: 'Moderation', actions: ['view', 'approve'] },
  community: {
    label: 'Community (Umfragen, Vorschläge, Giveaways)',
    group: 'Community',
    actions: ['view', 'create', 'edit', 'delete', 'publish'],
  },
  announcements: {
    label: 'Ankündigungen, Changelog, Wartung',
    group: 'Community',
    actions: ['view', 'create', 'edit', 'publish'],
  },
  rules: { label: 'Regelwerk & Begrüßung', group: 'Community', actions: ['view', 'edit', 'publish'] },
  codes: { label: 'Codes & Rewards', group: 'Community', actions: ['view', 'create', 'edit', 'delete'] },
  permissions: {
    label: 'Berechtigungen & Rollen',
    group: 'Bot-Verwaltung',
    actions: ['view', 'edit', 'approve', 'configure'],
  },
  settings: { label: 'Konfiguration & Module', group: 'Bot-Verwaltung', actions: ['view', 'edit', 'configure'] },
  feature_flags: {
    label: 'Feature-Flags & Kill-Switch',
    group: 'Bot-Verwaltung',
    actions: ['view', 'edit', 'configure'],
  },
  monitoring: { label: 'Monitoring & Gesundheit', group: 'Technik & Betrieb', actions: ['view'] },
  incidents: { label: 'Vorfälle', group: 'Technik & Betrieb', actions: ['view', 'create', 'edit'] },
  jobs: { label: 'Warteschlangen & Hintergrundjobs', group: 'Technik & Betrieb', actions: ['view', 'edit'] },
  releases: {
    label: 'Releases & Umgebungen',
    group: 'Technik & Betrieb',
    actions: ['view', 'create', 'approve', 'configure'],
  },
  backups: {
    label: 'Backups & Wiederherstellung',
    group: 'Technik & Betrieb',
    actions: ['view', 'create', 'approve', 'configure'],
  },
  automations: {
    label: 'Automatisierungen',
    group: 'Technik & Betrieb',
    actions: ['view', 'create', 'edit', 'delete'],
  },
  roblox_servers: {
    label: 'Roblox-Server & API-Schlüssel',
    group: 'Technik & Betrieb',
    actions: ['view', 'configure'],
  },
  audit: { label: 'Audit-Logs', group: 'Sicherheit & Kontrolle', actions: ['view', 'export'] },
  security: { label: 'Sicherheitsereignisse & Sitzungen', group: 'Sicherheit & Kontrolle', actions: ['view', 'edit'] },
  approvals: { label: 'Freigabezentrum', group: 'Sicherheit & Kontrolle', actions: ['view', 'create', 'approve'] },
  privacy: {
    label: 'Datenschutz',
    group: 'Sicherheit & Kontrolle',
    actions: ['view', 'export', 'delete', 'configure'],
  },
} as const satisfies Record<string, ResourceDefinition>;

export type Resource = keyof typeof RESOURCES;
export type PermissionKey = {
  [R in Resource]: `${R}:${(typeof RESOURCES)[R]['actions'][number]}`;
}[Resource];

export const ALL_PERMISSIONS: PermissionKey[] = (Object.keys(RESOURCES) as Resource[]).flatMap((resource) =>
  (RESOURCES[resource].actions as readonly Action[]).map((action) => `${resource}:${action}` as PermissionKey),
);

const PERMISSION_SET = new Set<string>(ALL_PERMISSIONS);

export function isPermissionKey(value: string): value is PermissionKey {
  return PERMISSION_SET.has(value);
}

/** Erlaubte Muster in Rollen: konkrete Schlüssel, "ressource:*" oder "*". */
export function isPermissionPattern(value: string): boolean {
  if (value === '*') return true;
  if (value.endsWith(':*')) return value.slice(0, -2) in RESOURCES;
  return isPermissionKey(value);
}

export function isFactionScoped(permission: string): boolean {
  const resource = permission.split(':')[0] as Resource;
  return Boolean((RESOURCES[resource] as ResourceDefinition | undefined)?.factionScoped);
}

/**
 * Kritische Berechtigungen: Wer sie vergibt, braucht eine zweite, unabhängige Freigabe
 * (Vier-Augen-Prinzip). Wildcards gelten immer als kritisch.
 */
export const CRITICAL_PERMISSIONS: ReadonlySet<string> = new Set<PermissionKey>([
  'permissions:edit',
  'permissions:approve',
  'permissions:configure',
  'settings:configure',
  'feature_flags:configure',
  'releases:approve',
  'releases:configure',
  'backups:approve',
  'backups:configure',
  'privacy:delete',
  'privacy:configure',
  'audit:export',
  'roblox_servers:configure',
  'security:edit',
]);

export function isCriticalPattern(pattern: string): boolean {
  if (pattern === '*' || pattern.endsWith(':*')) return true;
  return CRITICAL_PERMISSIONS.has(pattern);
}
