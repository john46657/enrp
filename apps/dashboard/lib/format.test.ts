import { describe, expect, it } from 'vitest';
import { formatUptime } from './format';

describe('formatUptime', () => {
  it.each([
    [0, '0 Sek'],
    [59.9, '59 Sek'],
    [60, '1 Min'],
    [3725, '1 Std 2 Min'],
    [90_000, '1 T 1 Std'],
  ])('%s Sekunden → %s', (input, expected) => {
    expect(formatUptime(input)).toBe(expected);
  });
});
