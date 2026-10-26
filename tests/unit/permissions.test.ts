import { describe, expect, it } from 'vitest';
import { checkPermission, resolveRoleKeys, type RoleKey } from '@emden-network/shared';

const actor = (...roles: RoleKey[]) => ({ discordId: '1', roles: new Set(roles) });

describe('Berechtigungen', () => {
  it('Fraktionsleitungen dürfen nur die eigene Fraktion verwalten', () => {
    const pl = actor('polizeileitung', 'verifiziert');
    expect(checkPermission(pl, 'faction.manage_members', { faction: 'polizei' }).allowed).toBe(true);
    expect(checkPermission(pl, 'faction.manage_members', { faction: 'feuerwehr' })).toEqual({ allowed: false, reason: 'wrong_faction' });
    expect(checkPermission(pl, 'faction.manage_members')).toEqual({ allowed: false, reason: 'faction_required' });
    expect(checkPermission(actor('feuerwehrleitung'), 'duty.correct', { faction: 'feuerwehr' }).allowed).toBe(true);
    expect(checkPermission(actor('rettungsdienstleitung'), 'duty.correct', { faction: 'polizei' }).allowed).toBe(false);
  });

  it('Management darf fraktionsübergreifend handeln, aber keine Konfiguration ändern', () => {
    const m = actor('management');
    for (const f of ['polizei', 'feuerwehr', 'rettungsdienst'] as const) {
      expect(checkPermission(m, 'faction.manage_members', { faction: f }).allowed).toBe(true);
    }
    expect(checkPermission(m, 'system.config').allowed).toBe(false);
    expect(checkPermission(actor('owner'), 'system.config').allowed).toBe(true);
  });

  it('Moderatoren erhalten nur Moderationsrechte', () => {
    const mod = actor('moderator');
    expect(checkPermission(mod, 'moderation.warn').allowed).toBe(true);
    expect(checkPermission(mod, 'moderation.game_kick').allowed).toBe(true);
    expect(checkPermission(mod, 'moderation.game_ban').allowed).toBe(false);
    expect(checkPermission(mod, 'faction.manage_members', { faction: 'polizei' }).allowed).toBe(false);
    expect(checkPermission(mod, 'server.announce').allowed).toBe(false);
  });

  it('Verifizierte dürfen nur eigene Daten einsehen', () => {
    const v = actor('verifiziert');
    expect(checkPermission(v, 'self.read').allowed).toBe(true);
    expect(checkPermission(v, 'player.read_any').allowed).toBe(false);
    expect(checkPermission(actor('unverified'), 'self.read').allowed).toBe(false);
    expect(checkPermission(actor(), 'ticket.create').allowed).toBe(false);
  });

  it('Fraktionsmitglied allein gewährt keine Verwaltungsrechte', () => {
    expect(checkPermission(actor('fraktionsmitglied', 'verifiziert'), 'faction.manage_members', { faction: 'polizei' }).allowed).toBe(false);
  });

  it('löst Discord-Rollen-IDs über die role_map auf', () => {
    const keys = resolveRoleKeys(['111', '222', '999'], { owner: '111', moderator: '222', management: '333' });
    expect([...keys].sort()).toEqual(['moderator', 'owner']);
    expect(resolveRoleKeys(['111'], {}).size).toBe(0);
  });
});
