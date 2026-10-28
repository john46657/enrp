import { describe, expect, it } from 'vitest';
import {
  ALL_PERMISSIONS,
  DEFAULT_ROLES,
  COMMAND_PERMISSIONS,
  can,
  checkGrantChange,
  covers,
  isPermissionKey,
  isPermissionPattern,
  resolveCommandAccess,
  scopeFor,
  type Subject,
} from './index';

const subject = (...permissions: string[]): Subject => ({
  isOwner: false,
  grants: permissions.map((permission) => ({ permission })),
});
const POLICE = 'faction-polizei';
const FIRE = 'faction-feuerwehr';

describe('can', () => {
  it('erlaubt nur zugewiesene Rechte', () => {
    const s = subject('tickets:view');
    expect(can(s, 'tickets:view')).toBe(true);
    expect(can(s, 'tickets:edit')).toBe(false);
  });

  it('unterstützt Wildcards pro Ressource und global', () => {
    expect(can(subject('tickets:*'), 'tickets:delete')).toBe(true);
    expect(can(subject('tickets:*'), 'reports:view')).toBe(false);
    expect(can(subject('*'), 'backups:approve')).toBe(true);
  });

  it('Owner darf alles, leere Rechte nichts', () => {
    expect(can({ isOwner: true, grants: [] }, 'privacy:delete')).toBe(true);
    expect(can(subject(), 'players:view')).toBe(false);
  });

  it('wertet fraktionsbezogene Einschränkungen aus', () => {
    const s: Subject = { isOwner: false, grants: [{ permission: 'factions:edit', factionIds: [POLICE] }] };
    expect(can(s, 'factions:edit', { factionId: POLICE })).toBe(true);
    expect(can(s, 'factions:edit', { factionId: FIRE })).toBe(false);
    // ohne Fraktionsbezug greift eine eingeschränkte Zuweisung nicht
    expect(can(s, 'factions:edit')).toBe(false);
    expect(scopeFor(s, 'factions:edit')).toEqual({ kind: 'factions', factionIds: [POLICE] });
    expect(scopeFor(subject('factions:edit'), 'factions:edit')).toEqual({ kind: 'all' });
    expect(scopeFor(subject(), 'factions:edit')).toEqual({ kind: 'none' });
  });
});

describe('covers / checkGrantChange (Schutz gegen Rechteausweitung)', () => {
  const admin = subject('permissions:edit', 'tickets:*', 'reports:view');

  it('verweigert Rechte, die der Akteur nicht selbst besitzt', () => {
    const result = checkGrantChange(admin, [{ permission: 'backups:approve' }]);
    expect(result.allowed).toBe(false);
    expect(result.exceeding).toEqual([{ permission: 'backups:approve' }]);
  });

  it('verweigert Wildcards ohne eigene Wildcard', () => {
    expect(checkGrantChange(admin, [{ permission: '*' }]).allowed).toBe(false);
    expect(checkGrantChange(admin, [{ permission: 'reports:*' }]).allowed).toBe(false);
    expect(checkGrantChange(admin, [{ permission: 'tickets:*' }]).allowed).toBe(true);
  });

  it('verlangt permissions:edit', () => {
    const result = checkGrantChange(subject('tickets:view'), [{ permission: 'tickets:view' }]);
    expect(result.allowed).toBe(false);
  });

  it('kritische Rechte brauchen eine Freigabe – auch beim Entfernen', () => {
    const lead = subject('permissions:edit', 'backups:approve');
    expect(checkGrantChange(lead, [{ permission: 'backups:approve' }])).toMatchObject({
      allowed: true,
      requiresApproval: true,
    });
    expect(checkGrantChange(lead, [], [{ permission: 'backups:approve' }])).toMatchObject({
      allowed: true,
      requiresApproval: true,
    });
    expect(checkGrantChange(lead, [{ permission: 'tickets:view' }].slice(0, 0))).toMatchObject({
      requiresApproval: false,
    });
  });

  it('bereits vorhandene Zuweisungen werden nicht erneut geprüft', () => {
    const result = checkGrantChange(
      admin,
      [{ permission: 'backups:approve' }, { permission: 'tickets:view' }],
      [{ permission: 'backups:approve' }],
    );
    expect(result.allowed).toBe(true);
  });

  it('eingeschränkte Rechte dürfen nur innerhalb der eigenen Fraktion weitergegeben werden', () => {
    const policeLead: Subject = {
      isOwner: false,
      grants: [{ permission: 'permissions:edit' }, { permission: 'factions:edit', factionIds: [POLICE] }],
    };
    expect(covers(policeLead, { permission: 'factions:edit', factionIds: [POLICE] })).toBe(true);
    expect(covers(policeLead, { permission: 'factions:edit', factionIds: [FIRE] })).toBe(false);
    expect(covers(policeLead, { permission: 'factions:edit' })).toBe(false);
  });
});

describe('resolveCommandAccess', () => {
  const mod = subject('moderation:create', 'moderation:view');

  it('nutzt die Standard-Berechtigung', () => {
    expect(resolveCommandAccess('mod warn', mod, [], []).allowed).toBe(true);
    expect(resolveCommandAccess('mod unban', mod, [], []).allowed).toBe(false);
    expect(resolveCommandAccess('verify start', subject(), [], [])).toMatchObject({ allowed: true, source: 'public' });
  });

  it('Deny-Override schlägt Berechtigung, Allow-Override öffnet Befehl', () => {
    expect(
      resolveCommandAccess('mod warn', mod, ['r1'], [{ command: 'mod', discordRoleId: 'r1', effect: 'deny' }]).allowed,
    ).toBe(false);
    expect(
      resolveCommandAccess('mod unban', mod, ['r1'], [{ command: 'mod unban', discordRoleId: 'r1', effect: 'allow' }]),
    ).toMatchObject({ allowed: true, source: 'override-allow' });
    // Override einer Rolle, die das Mitglied nicht hat, wirkt nicht
    expect(
      resolveCommandAccess('mod unban', mod, ['r2'], [{ command: 'mod unban', discordRoleId: 'r1', effect: 'allow' }])
        .allowed,
    ).toBe(false);
  });

  it('gesperrte Befehle lassen sich nicht per Override öffnen', () => {
    const result = resolveCommandAccess(
      'permissions grant',
      subject(),
      ['r1'],
      [{ command: 'permissions', discordRoleId: 'r1', effect: 'allow' }],
    );
    expect(result.allowed).toBe(false);
  });

  it('unbekannte Befehle werden abgelehnt', () => {
    expect(resolveCommandAccess('rm -rf', { isOwner: true, grants: [] }, [], []).allowed).toBe(false);
  });
});

describe('Katalogkonsistenz', () => {
  it('alle Befehls- und Rollenrechte existieren im Katalog', () => {
    for (const [command, permission] of Object.entries(COMMAND_PERMISSIONS)) {
      if (permission) expect(isPermissionKey(permission), command).toBe(true);
    }
    for (const role of DEFAULT_ROLES) {
      for (const grant of role.grants)
        expect(isPermissionPattern(grant.permission), `${role.key}: ${grant.permission}`).toBe(true);
    }
    expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length);
  });
});
