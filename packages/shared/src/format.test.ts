import { describe, expect, it } from 'vitest';
import { formatDuration, parseDuration } from './format';
import { periodStart, reason } from './schemas';

describe('format', () => {
  it('formatiert Dauern', () => {
    expect(formatDuration(0)).toBe('0 Min.');
    expect(formatDuration(3660)).toBe('1 Std. 1 Min.');
    expect(formatDuration(90000)).toBe('1 T. 1 Std.');
  });
  it('parst Dauern und lehnt Unsinn ab', () => {
    expect(parseDuration('30m')).toBe(1800);
    expect(parseDuration('2H')).toBe(7200);
    expect(parseDuration('1w')).toBe(604800);
    expect(parseDuration('abc')).toBeNull();
    expect(parseDuration('-5m')).toBeNull();
  });
  it('periodStart', () => {
    const now = new Date('2026-01-08T00:00:00Z');
    expect(periodStart('week', now)?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(periodStart('all', now)).toBeNull();
  });
  it('Begründungen müssen sinnvoll sein', () => {
    expect(reason.safeParse('  ').success).toBe(false);
    expect(reason.safeParse('ok\u0001').success).toBe(false);
    expect(reason.safeParse('Regelverstoß §3').success).toBe(true);
  });
});
