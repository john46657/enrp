/**
 * Rollen und Berechtigungen des Emden Network Control Center.
 *
 * Die Datenbank ist die Quelle der Wahrheit für die aktuelle Zuordnung (Tabelle role_permissions,
 * im Dashboard änderbar). Diese Liste definiert, welche Berechtigungen es überhaupt gibt und welche
 * Rollen sie standardmäßig erhalten. Ein Test prüft, dass Migration und Liste übereinstimmen.
 */

/** Systemrollen, absteigend nach Rang. */
export const ROLE_KEYS = ['owner', 'administrator', 'moderator', 'support', 'viewer'] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

/** Der Owner hat immer alle Berechtigungen und wird ausschließlich über die Ersteinrichtung vergeben. */
export const OWNER_ROLE: RoleKey = 'owner';

export const PERMISSIONS = {
  'users.read': { category: 'Benutzer und Rollen', description: 'Benutzerliste ansehen' },
  'users.manage': {
    category: 'Benutzer und Rollen',
    description: 'Benutzer freischalten, sperren und Rollen zuweisen',
  },
  'roles.read': { category: 'Benutzer und Rollen', description: 'Rollen und ihre Berechtigungen ansehen' },
  'roles.manage': { category: 'Benutzer und Rollen', description: 'Berechtigungen von Rollen ändern' },
  'audit.read': { category: 'Audit-Log', description: 'Audit-Log ansehen' },
} as const satisfies Record<string, { category: string; description: string }>;

export type Permission = keyof typeof PERMISSIONS;
export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as Permission[];

export function isPermission(value: string): value is Permission {
  return Object.hasOwn(PERMISSIONS, value);
}

/** Standardzuordnung, die Migration 0001 anlegt (ohne Owner, der implizit alles darf). */
export const DEFAULT_ROLE_PERMISSIONS = {
  administrator: ['users.read', 'users.manage', 'roles.read', 'roles.manage', 'audit.read'],
  moderator: ['users.read', 'roles.read'],
  support: ['users.read'],
  viewer: [],
} as const satisfies Record<Exclude<RoleKey, 'owner'>, readonly Permission[]>;
