import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { EnvError, loadEnv } from './env.ts';

const schema = z.object({
  DATABASE_URL: z.url(),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  SECRET: z.string().min(32),
});

describe('loadEnv', () => {
  it('gibt gültige Werte typisiert zurück und setzt Standardwerte', () => {
    const env = loadEnv(schema, { DATABASE_URL: 'postgres://localhost/enrp', SECRET: 'x'.repeat(32) });
    expect(env).toEqual({ DATABASE_URL: 'postgres://localhost/enrp', PORT: 3000, SECRET: 'x'.repeat(32) });
  });

  it('wandelt Zahlen aus Text um', () => {
    const env = loadEnv(schema, { DATABASE_URL: 'postgres://localhost/enrp', PORT: '8080', SECRET: 'x'.repeat(32) });
    expect(env.PORT).toBe(8080);
  });

  it('behandelt leere Einträge als fehlend', () => {
    expect(() => loadEnv(schema, { DATABASE_URL: 'postgres://localhost/enrp', SECRET: '' })).toThrow(/SECRET/);
  });

  it('listet alle Fehler auf, ohne geheime Werte zu verraten', () => {
    const secret = 'zu-kurz-aber-geheim';
    let error: unknown;
    try {
      loadEnv(schema, { DATABASE_URL: 'kein-link', PORT: '99999', SECRET: secret });
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(EnvError);
    const message = (error as EnvError).message;
    expect(message).toContain('DATABASE_URL');
    expect(message).toContain('PORT');
    expect(message).toContain('SECRET');
    expect(message).not.toContain(secret);
  });
});
