import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { healthResponseSchema, readinessResponseSchema, apiErrorSchema } from '@emden/shared';
import { buildApp } from '../src/app.js';
import { testConfig } from './helpers.js';

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('GET /health', () => {
  it('antwortet mit 200 und einem schema-konformen Body', async () => {
    app = await buildApp(testConfig());
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = healthResponseSchema.parse(res.json());
    expect(body.service).toBe('emden-network-backend');
  });

  it('setzt Sicherheits-Header und eine Request-ID', async () => {
    app = await buildApp(testConfig());
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['x-request-id']).toMatch(/^[A-Za-z0-9-]{8,64}$/);
  });

  it('übernimmt harmlose Request-IDs, verwirft verdächtige', async () => {
    app = await buildApp(testConfig());
    const ok = await app.inject({ url: '/health', headers: { 'x-request-id': 'abcd-1234-efgh' } });
    expect(ok.headers['x-request-id']).toBe('abcd-1234-efgh');
    // Zeilenumbrüche lehnt schon der HTTP-Parser ab; hier ein gültiger, aber unerwünschter Wert.
    const bad = await app.inject({
      url: '/health',
      headers: { 'x-request-id': '<script>alert(1)</script>' },
    });
    expect(bad.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('ist vom Rate Limit ausgenommen', async () => {
    app = await buildApp(testConfig({ rateLimit: { max: 1, windowMs: 60_000 } }));
    for (let i = 0; i < 3; i++) {
      expect((await app.inject({ url: '/health' })).statusCode).toBe(200);
    }
  });
});

describe('GET /ready', () => {
  it('meldet die Datenbank ehrlich als nicht konfiguriert', async () => {
    app = await buildApp(testConfig());
    const res = await app.inject({ url: '/ready' });
    expect(res.statusCode).toBe(200);
    const body = readinessResponseSchema.parse(res.json());
    expect(body.status).toBe('ready');
    expect(body.checks).toContainEqual(
      expect.objectContaining({ name: 'database', status: 'not_configured' }),
    );
  });

  it('antwortet mit 503, wenn ein Check fehlschlägt', async () => {
    app = await buildApp(testConfig(), {
      readinessChecks: async () => [{ name: 'database', status: 'failed', message: 'nicht erreichbar' }],
    });
    const res = await app.inject({ url: '/ready' });
    expect(res.statusCode).toBe(503);
    expect(readinessResponseSchema.parse(res.json()).status).toBe('not_ready');
  });

  it('antwortet mit 503 ohne interne Details, wenn die Prüfung selbst abstürzt', async () => {
    app = await buildApp(testConfig(), {
      readinessChecks: async () => {
        throw new Error('geheimes-passwort-im-connection-string');
      },
    });
    const res = await app.inject({ url: '/ready' });
    expect(res.statusCode).toBe(503);
    expect(res.body).not.toContain('geheimes-passwort');
  });
});

describe('Fehlerbehandlung', () => {
  it('liefert 404 im einheitlichen Fehlerformat', async () => {
    app = await buildApp(testConfig());
    const res = await app.inject({ url: '/gibt-es-nicht' });
    expect(res.statusCode).toBe(404);
    const body = apiErrorSchema.parse(res.json());
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.requestId).toBe(res.headers['x-request-id']);
  });

  it('verbirgt interne Fehlermeldungen hinter INTERNAL_ERROR', async () => {
    app = await buildApp(testConfig());
    app.get('/boom', async () => {
      throw new Error('DB-Passwort: hunter2');
    });
    const res = await app.inject({ url: '/boom' });
    expect(res.statusCode).toBe(500);
    expect(apiErrorSchema.parse(res.json()).error.code).toBe('INTERNAL_ERROR');
    expect(res.body).not.toContain('hunter2');
  });

  it('meldet Validierungsfehler als VALIDATION_ERROR', async () => {
    app = await buildApp(testConfig());
    app.post(
      '/echo',
      { schema: { body: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } } } },
      async () => ({ ok: true }),
    );
    const res = await app.inject({ method: 'POST', url: '/echo', payload: { wrong: 1 } });
    expect(res.statusCode).toBe(400);
    expect(apiErrorSchema.parse(res.json()).error.code).toBe('VALIDATION_ERROR');
  });

  it('meldet kaputtes JSON als 400 BAD_REQUEST', async () => {
    app = await buildApp(testConfig());
    app.post('/echo', async () => ({ ok: true }));
    const res = await app.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{kaputt',
    });
    expect(res.statusCode).toBe(400);
    expect(apiErrorSchema.parse(res.json()).error.code).toBe('BAD_REQUEST');
  });

  it('begrenzt Anfragen mit 429 RATE_LIMITED', async () => {
    app = await buildApp(testConfig({ rateLimit: { max: 2, windowMs: 60_000 } }));
    app.get('/limited', async () => ({ ok: true }));
    await app.inject({ url: '/limited' });
    await app.inject({ url: '/limited' });
    const res = await app.inject({ url: '/limited' });
    expect(res.statusCode).toBe(429);
    expect(apiErrorSchema.parse(res.json()).error.code).toBe('RATE_LIMITED');
  });
});

describe('CORS', () => {
  it('erlaubt nur konfigurierte Ursprünge', async () => {
    app = await buildApp(testConfig({ corsOrigins: ['http://localhost:3000'] }));
    const allowed = await app.inject({ url: '/health', headers: { origin: 'http://localhost:3000' } });
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    const denied = await app.inject({ url: '/health', headers: { origin: 'https://evil.example' } });
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('lässt ohne Konfiguration keine fremden Ursprünge zu', async () => {
    app = await buildApp(testConfig());
    const res = await app.inject({ url: '/health', headers: { origin: 'http://localhost:3000' } });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
