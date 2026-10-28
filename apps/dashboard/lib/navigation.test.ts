import { describe, expect, it } from 'vitest';
import { loginMessage } from './login-messages';
import { visibleSections } from './navigation';

describe('visibleSections', () => {
  it('blendet Verwaltungsbereiche ohne Berechtigung aus', () => {
    const slugs = visibleSections([]).map((s) => s.slug);
    expect(slugs).not.toContain('users');
    expect(slugs).not.toContain('audit-log');
    expect(slugs).toContain('overview');
    expect(slugs).toContain('system');
  });

  it('zeigt Bereiche passend zur Berechtigung', () => {
    expect(visibleSections(['users.read']).map((s) => s.slug)).toContain('users');
    expect(visibleSections(['audit.read']).map((s) => s.slug)).toContain('audit-log');
  });
});

describe('loginMessage', () => {
  it('kennt alle Fehlercodes des Backends', () => {
    for (const code of [
      'not_configured',
      'cancelled',
      'state_mismatch',
      'discord_unavailable',
      'login_failed',
      'not_registered',
      'account_disabled',
    ]) {
      expect(loginMessage(code)?.text).toBeTruthy();
    }
  });

  it('ignoriert unbekannte Codes statt sie anzuzeigen', () => {
    expect(loginMessage('<script>')).toBeUndefined();
    expect(loginMessage(undefined)).toBeUndefined();
  });
});
