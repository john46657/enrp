import { describe, expect, it } from 'vitest';
import { checkDomain } from './domain-check.mjs';
import { PlanError, missingVariables, planServices, restartDelay, selectedServices } from './services.mjs';

const env = {
  SERVER_PORT: '25565',
  DATABASE_URL: 'postgres://u:p@db.example:5432/enrp',
  REDIS_URL: 'redis://redis.example:6379',
  HASH_SECRET: 'h'.repeat(40),
  BOT_API_TOKEN: 'b'.repeat(40),
  PUBLIC_URL: 'https://x.apps.bot-hosting.cloud',
  DASHBOARD_URL: 'https://x.apps.bot-hosting.cloud',
  OWNER_DISCORD_IDS: '1',
  DISCORD_BOT_TOKEN: 'token',
  DISCORD_CLIENT_SECRET: 'client-secret',
  GITHUB_DEPLOY_TOKEN: 'gh-secret',
  PATH: '/usr/bin',
};

describe('bot-hosting Dienstplan', () => {
  it('nur das Dashboard belegt den öffentlichen Port, die API lauscht intern', () => {
    const plan = planServices(env, '/srv');
    expect(plan.map((s) => s.name)).toEqual(['api', 'worker', 'bot', 'dashboard']);
    const dash = plan.find((s) => s.name === 'dashboard');
    expect(dash.env.PORT).toBe('25565');
    expect(dash.env.HOSTNAME).toBe('0.0.0.0');
    const api = plan.find((s) => s.name === 'api');
    expect(api.env.API_HOST).toBe('127.0.0.1');
    expect(api.env.API_PORT).toBe('4000');
    expect(api.env.RUN_MIGRATIONS).toBe('true');
    for (const s of plan.filter((p) => p.name !== 'dashboard')) {
      expect(s.env.SERVER_PORT).toBeUndefined();
      expect(s.env.PORT).toBeUndefined();
    }
  });

  it('das alte Express-Dashboard der Altmodule wird im Bot abgeschaltet', () => {
    const bot = planServices(env, '/srv').find((s) => s.name === 'bot');
    expect(bot.env.LEGACY_DASHBOARD).toBe('false');
    expect(bot.env.API_URL).toBe('http://127.0.0.1:4000');
  });

  it('Geheimnisse gelangen nur zu den Diensten, die sie brauchen', () => {
    const plan = planServices(env, '/srv');
    const by = Object.fromEntries(plan.map((s) => [s.name, s.env]));
    expect(by.dashboard.DATABASE_URL).toBeUndefined();
    expect(by.dashboard.BOT_API_TOKEN).toBeUndefined();
    expect(by.dashboard.DISCORD_BOT_TOKEN).toBeUndefined();
    expect(by.bot.DISCORD_CLIENT_SECRET).toBeUndefined();
    expect(by.bot.GITHUB_DEPLOY_TOKEN).toBeUndefined();
    expect(by.worker.DISCORD_CLIENT_SECRET).toBeUndefined();
    expect(by.api.GITHUB_DEPLOY_TOKEN).toBeUndefined();
    expect(by.api.DISCORD_CLIENT_SECRET).toBe('client-secret');
  });

  it('ENRP_SERVICES wählt Dienste aus (Aufteilung auf mehrere Deployments)', () => {
    expect(selectedServices({ ENRP_SERVICES: 'bot, worker' })).toEqual(['worker', 'bot']);
    expect(() => selectedServices({ ENRP_SERVICES: 'api,fivem' })).toThrow(PlanError);
  });

  it('verlangt einen gültigen SERVER_PORT und verhindert Portkonflikte', () => {
    expect(() => planServices({ ...env, SERVER_PORT: '' }, '/srv')).toThrow(/SERVER_PORT/);
    expect(() => planServices({ ...env, SERVER_PORT: '4000' }, '/srv')).toThrow(/API_PORT/);
  });

  it('meldet fehlende Variablen nur mit Namen', () => {
    const missing = missingVariables({ SERVER_PORT: '1', HASH_SECRET: 'geheim' });
    expect(missing).toContain('DATABASE_URL');
    expect(missing).toContain('DISCORD_BOT_TOKEN');
    expect(missing).not.toContain('HASH_SECRET');
    expect(missing.join()).not.toContain('geheim');
    expect(missingVariables(env)).toEqual([]);
  });

  it('Neustart-Backoff wächst exponentiell bis höchstens 60 s', () => {
    expect(restartDelay(0)).toBe(1000);
    expect(restartDelay(3)).toBe(8000);
    expect(restartDelay(20)).toBe(60_000);
  });
});

function fakeFetch(routes) {
  return async (url) => {
    const r = routes[new URL(url).pathname];
    if (!r) return new Response('not found', { status: 404 });
    return new Response(typeof r.body === 'string' ? r.body : JSON.stringify(r.body), { status: r.status });
  };
}

describe('Domain-Prüfung', () => {
  it('erkennt das alte Express-Dashboard statt der Plattform', async () => {
    const results = await checkDomain(
      'https://x',
      fakeFetch({
        '/healthz': { status: 200, body: '<!doctype html><title>Dashboard</title>' },
        '/api/v1/status': { status: 401, body: { error: 'Nicht angemeldet' } },
        '/api/v1/game/heartbeat': { status: 401, body: { error: 'Nicht angemeldet' } },
      }),
    );
    expect(results.every((r) => !r.ok)).toBe(true);
    expect(results[1].detail).toMatch(/alten Express-Dashboard/);
  });

  it('bestätigt eine erreichbare Plattform', async () => {
    const results = await checkDomain(
      'https://x',
      fakeFetch({
        '/healthz': { status: 200, body: { status: 'ok' } },
        '/api/v1/status': { status: 200, body: { status: 'ok', roblox: { connected: true, playersOnline: 3 } } },
        '/api/v1/game/heartbeat': { status: 401, body: { error: { code: 'UNAUTHENTICATED', message: 'x' } } },
      }),
    );
    expect(results.every((r) => r.ok)).toBe(true);
  });
});
