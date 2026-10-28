import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { EnvValidationError, assertProductionSafety, baseEnvSchema, csv, optionalString, parseEnv } from './env';

describe('parseEnv', () => {
  const schema = baseEnvSchema.extend({ SECRET: z.string().min(10), LIST: csv, OPT: optionalString });

  it('liefert typisierte Werte mit Defaults', () => {
    const env = parseEnv(schema, { SECRET: 'abcdefghijk', LIST: 'a, b,,c', OPT: '' });
    expect(env.APP_ENV).toBe('development');
    expect(env.LIST).toEqual(['a', 'b', 'c']);
    expect(env.OPT).toBeUndefined();
  });

  it('nennt fehlerhafte Variablen, aber niemals deren Werte', () => {
    const secretValue = 'kurz';
    try {
      parseEnv(schema, { SECRET: secretValue });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(EnvValidationError);
      expect((err as Error).message).toContain('SECRET');
      expect((err as Error).message).not.toContain(secretValue);
    }
  });

  it('prüft Produktionsregeln nur in Produktion', () => {
    expect(() => assertProductionSafety({ APP_ENV: 'staging' }, [[false, 'x']])).not.toThrow();
    expect(() => assertProductionSafety({ APP_ENV: 'production' }, [[false, 'HTTPS erforderlich']])).toThrow(/HTTPS/);
  });
});
