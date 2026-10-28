import { describe, expect, it } from 'vitest';
import { healthResponseSchema, readinessResponseSchema } from './health.js';

describe('healthResponseSchema', () => {
  it('akzeptiert eine gültige Antwort', () => {
    const parsed = healthResponseSchema.safeParse({
      status: 'ok',
      service: 'emden-network-backend',
      version: '0.1.0',
      uptimeSeconds: 12.5,
      timestamp: new Date().toISOString(),
    });
    expect(parsed.success).toBe(true);
  });

  it('lehnt negative Laufzeit und falschen Status ab', () => {
    const base = { service: 'x', version: '1', timestamp: new Date().toISOString() };
    expect(healthResponseSchema.safeParse({ ...base, status: 'ok', uptimeSeconds: -1 }).success).toBe(false);
    expect(healthResponseSchema.safeParse({ ...base, status: 'down', uptimeSeconds: 1 }).success).toBe(false);
  });
});

describe('readinessResponseSchema', () => {
  it('erlaubt den Check-Status not_configured', () => {
    const parsed = readinessResponseSchema.safeParse({
      status: 'ready',
      checks: [{ name: 'database', status: 'not_configured', message: 'Phase 2' }],
      timestamp: new Date().toISOString(),
    });
    expect(parsed.success).toBe(true);
  });
});
