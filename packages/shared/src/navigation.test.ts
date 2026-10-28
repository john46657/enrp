import { describe, expect, it } from 'vitest';
import { NAV_SECTIONS, findNavSection } from './navigation.js';

describe('NAV_SECTIONS', () => {
  it('enthält genau die 13 vorgesehenen Bereiche in der festgelegten Reihenfolge', () => {
    expect(NAV_SECTIONS.map((s) => s.label)).toEqual([
      'Übersicht',
      'Roblox-Server',
      'Spieler',
      'Fraktionen',
      'Spielprotokolle',
      'Moderation',
      'Discord Security',
      'TikTok LIVE',
      'Benachrichtigungen',
      'Audit-Log',
      'Benutzer und Rollen',
      'Einstellungen',
      'Systemstatus',
    ]);
  });

  it('hat eindeutige Slugs und Pfade', () => {
    expect(new Set(NAV_SECTIONS.map((s) => s.slug)).size).toBe(NAV_SECTIONS.length);
    expect(new Set(NAV_SECTIONS.map((s) => s.href)).size).toBe(NAV_SECTIONS.length);
  });

  it('enthält keinen Dispatch- oder Personalbereich (außerhalb des Umfangs)', () => {
    const text = NAV_SECTIONS.map((s) => `${s.slug} ${s.label}`)
      .join(' ')
      .toLowerCase();
    for (const forbidden of ['dispatch', 'leitstelle', 'personal', 'ausbildung']) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('markiert nur Bereiche der Phase 1 als verfügbar', () => {
    for (const section of NAV_SECTIONS) {
      expect(section.available).toBe(section.phase === 1);
    }
  });

  it('findet Bereiche über ihren Slug', () => {
    expect(findNavSection('system')?.label).toBe('Systemstatus');
    expect(findNavSection('gibt-es-nicht')).toBeUndefined();
  });
});
