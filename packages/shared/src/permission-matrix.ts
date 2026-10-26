import { PERMISSIONS, ROLE_KEYS, ROLE_LABELS, checkPermission, type Permission } from './permissions.js';

/** Erzeugt die Berechtigungsmatrix als Markdown-Tabelle direkt aus der Code-Definition. */
export function permissionMatrixMarkdown(): string {
  const roles = ROLE_KEYS;
  const header = `| Berechtigung | Beschreibung | ${roles.map((r) => ROLE_LABELS[r]).join(' | ')} |`;
  const sep = `|---|---|${roles.map(() => ':-:').join('|')}|`;
  const rows = (Object.keys(PERMISSIONS) as Permission[]).map((p) => {
    const cells = roles.map((r) => {
      const actor = { discordId: '0', roles: new Set([r]) };
      if (checkPermission(actor, p).allowed) return '✅';
      // Leitungen: nur eigene Fraktion
      const own = { polizeileitung: 'polizei', feuerwehrleitung: 'feuerwehr', rettungsdienstleitung: 'rettungsdienst' } as const;
      const f = own[r as keyof typeof own];
      if (f && checkPermission(actor, p, { faction: f }).allowed) return '🔸';
      return '–';
    });
    return `| \`${p}\` | ${PERMISSIONS[p].description} | ${cells.join(' | ')} |`;
  });
  return [header, sep, ...rows].join('\n');
}
