import { type Grant } from './evaluate';

export interface DefaultRole {
  key: string;
  name: string;
  description: string;
  priority: number;
  grants: Grant[];
}

const g = (...permissions: string[]): Grant[] => permissions.map((permission) => ({ permission }));

/** Startrollen. Alle Rollen sind nachträglich im Dashboard oder per Befehl anpassbar. */
export const DEFAULT_ROLES: DefaultRole[] = [
  {
    key: 'owner',
    name: 'Owner',
    description: 'Vollzugriff. Sollte nur sehr wenigen Personen zugewiesen werden.',
    priority: 1000,
    grants: g('*'),
  },
  {
    key: 'tech_admin',
    name: 'Technische Administration',
    description: 'Betrieb, Monitoring, Releases, Backups, Feature-Flags.',
    priority: 900,
    grants: g(
      'monitoring:view',
      'incidents:*',
      'jobs:*',
      'releases:view',
      'releases:create',
      'releases:approve',
      'backups:view',
      'backups:create',
      'backups:approve',
      'automations:*',
      'feature_flags:view',
      'feature_flags:edit',
      'settings:view',
      'settings:edit',
      'roblox_servers:view',
      'roblox_servers:edit',
      'audit:view',
      'security:view',
      'approvals:view',
      'approvals:create',
      'approvals:approve',
      'permissions:view',
    ),
  },
  {
    key: 'community_management',
    name: 'Community-Management',
    description: 'Community-Tools, Ankündigungen, Regelwerk, Codes.',
    priority: 700,
    grants: g(
      'players:view',
      'community:*',
      'announcements:*',
      'rules:*',
      'codes:*',
      'tickets:view',
      'reports:view',
      'approvals:view',
      'approvals:create',
    ),
  },
  {
    key: 'moderation',
    name: 'Moderation',
    description: 'Tickets, Reports, Fallberichte und Moderationsaktionen.',
    priority: 600,
    grants: g(
      'players:view',
      'player_private:view',
      'verification:view',
      'tickets:*',
      'ticket_internal:*',
      'reports:*',
      'cases:*',
      'moderation:view',
      'moderation:create',
      'moderation:edit',
      'appeals:view',
      'appeals:approve',
      'roblox_servers:view',
      'roblox_servers:edit',
      'duty:view',
      'factions:view',
      'approvals:view',
      'approvals:create',
    ),
  },
  {
    key: 'faction_management',
    name: 'Fraktionsverwaltung',
    description:
      'Mitglieder, Dienstzeiten und Fahrzeuge der zugewiesenen Fraktion(en). Fraktionen bei der Zuweisung festlegen.',
    priority: 500,
    grants: g(
      'players:view',
      'factions:view',
      'factions:edit',
      'duty:view',
      'duty:edit',
      'vehicles:view',
      'vehicles:edit',
    ),
  },
  {
    key: 'read_only',
    name: 'Nur Lesen',
    description: 'Lesender Zugriff auf Dashboard-Übersichten ohne interne Personendaten.',
    priority: 100,
    grants: g(
      'players:view',
      'factions:view',
      'duty:view',
      'vehicles:view',
      'tickets:view',
      'reports:view',
      'moderation:view',
      'community:view',
      'announcements:view',
      'monitoring:view',
      'incidents:view',
    ),
  },
];
