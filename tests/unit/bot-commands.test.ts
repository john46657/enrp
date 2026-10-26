import { describe, expect, it } from 'vitest';
import { commands, formatDuration, parseGermanDateTime } from '@emden-network/bot';

describe('Slash-Command-Definitionen', () => {
  it('lassen sich für die Discord-API serialisieren und sind eindeutig', () => {
    const json = commands.map((c) => c.data.toJSON());
    const names = json.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    for (const c of json) {
      expect(c.name).toMatch(/^[a-z-]{1,32}$/);
      expect(c.description.length).toBeLessThanOrEqual(100);
      // Nur auf dem Server (InteractionContextType.Guild = 0)
      expect(c.contexts).toEqual([0]);
    }
  });

  it('enthält die geforderten Commands', () => {
    const names = commands.map((c) => c.data.name).sort();
    expect(names).toEqual(['case', 'duty', 'faction', 'gameban', 'gamekick', 'help', 'myfaction', 'playtime', 'privacy', 'profile', 'server', 'system', 'timeout', 'unlink', 'verify', 'warn']);
  });

  it('setzt Pflichtoptionen vor optionale (Discord-Vorgabe)', () => {
    type Opt = { required?: boolean; options?: Opt[] };
    const check = (opts: Opt[] = []) => {
      let seenOptional = false;
      for (const o of opts) {
        if (o.options) check(o.options);
        else if (!o.required) seenOptional = true;
        else expect(seenOptional).toBe(false);
      }
    };
    for (const c of commands) check(c.data.toJSON().options as Opt[]);
  });
});

describe('Hilfsfunktionen', () => {
  it('parst deutsche Zeitangaben in Europe/Berlin (Sommer- und Winterzeit)', () => {
    expect(parseGermanDateTime('24.07.2026 18:30')?.toISOString()).toBe('2026-07-24T16:30:00.000Z');
    expect(parseGermanDateTime('24.12.2026 18:30')?.toISOString()).toBe('2026-12-24T17:30:00.000Z');
    expect(parseGermanDateTime('2026-12-24 08:05')?.toISOString()).toBe('2026-12-24T07:05:00.000Z');
    expect(parseGermanDateTime('2026-12-24T08:05:00Z')?.toISOString()).toBe('2026-12-24T08:05:00.000Z');
    expect(parseGermanDateTime('32.13.2026 25:00')).toBeNull();
    expect(parseGermanDateTime('gestern')).toBeNull();
  });

  it('formatiert Dauern', () => {
    expect(formatDuration(59)).toBe('0 Min.');
    expect(formatDuration(3720)).toBe('1 Std. 2 Min.');
  });
});
