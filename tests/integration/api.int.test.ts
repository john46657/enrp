import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { game } from '@enrp/core';
import { accountLinks, auditEvents, eq, roleBindings, appRoles } from '@enrp/database';
import { closeDb, createTestContext, OWNER_ID, owner, resetDatabase } from './helpers';
import { botHeaders, cookiesOf, createTestApp, fakeOAuthFetch } from './api-helpers';

const USER = '700000000000000001';
const MOD = '700000000000000002';

beforeEach(resetDatabase);
afterAll(closeDb);

describe('API: Grundlagen', () => {
  it('Health, OpenAPI, einheitliches Fehlerformat, Request-ID', async () => {
    const { app } = await createTestApp();
    expect((await app.inject('/health')).json()).toEqual({ status: 'ok' });
    expect((await app.inject('/health/ready')).statusCode).toBe(200);
    const notFound = await app.inject('/api/v1/gibtsnicht');
    expect(notFound.statusCode).toBe(404);
    expect(notFound.json().error).toMatchObject({ code: 'NOT_FOUND' });
    expect(notFound.headers['x-request-id']).toBeTruthy();
    const spec = await app.inject('/api/docs/json');
    expect(spec.statusCode).toBe(200);
    expect(Object.keys(spec.json().paths).length).toBeGreaterThan(80);
    // Metriken nur mit Token
    expect((await app.inject('/metrics')).statusCode).toBe(404);
    expect((await app.inject({ url: '/metrics', headers: { authorization: 'Bearer metrics-token' } })).body).toContain('enrp_api_requests_total');
    await app.close();
  });

  it('Authentifizierung: anonym 401, falsches Service-Token 401 + Sicherheitsereignis, fehlende Rechte 403', async () => {
    const { app } = await createTestApp();
    expect((await app.inject('/api/v1/overview')).statusCode).toBe(401);
    expect((await app.inject('/api/v1/auth/me')).statusCode).toBe(401);
    const bad = await app.inject({ url: '/api/v1/auth/me', headers: { authorization: 'Bearer falsch' } });
    expect(bad.statusCode).toBe(401);
    expect(bad.json().error.code).toBe('UNAUTHENTICATED');
    const forbidden = await app.inject({ url: '/api/v1/audit', headers: botHeaders(USER) });
    expect(forbidden.statusCode).toBe(403);
    const ok = await app.inject({ url: '/api/v1/audit', headers: botHeaders(OWNER_ID) });
    expect(ok.statusCode).toBe(200);
    await app.close();
  });

  it('Validierung liefert verständliche Fehler ohne Interna; Request-Größe ist begrenzt', async () => {
    const { app } = await createTestApp();
    const res = await app.inject({ method: 'POST', url: '/api/v1/reports', headers: botHeaders(USER), payload: { description: '' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
    const big = await app.inject({ method: 'POST', url: '/api/v1/reports', headers: { ...botHeaders(USER), 'content-type': 'application/json' }, payload: JSON.stringify({ description: 'x'.repeat(400_000) }) });
    expect(big.statusCode).toBe(413);
    await app.close();
  });

  it('Idempotenz: gleiche Anfrage wird nur einmal ausgeführt, abweichende Daten → 409', async () => {
    const { app } = await createTestApp();
    const headers = { ...botHeaders(USER), 'idempotency-key': 'ticket-key-0001' };
    const first = await app.inject({ method: 'POST', url: '/api/v1/tickets', headers, payload: { subject: 'Hilfe' } });
    const second = await app.inject({ method: 'POST', url: '/api/v1/tickets', headers, payload: { subject: 'Hilfe' } });
    expect(first.statusCode).toBe(200);
    expect(second.json().number).toBe(first.json().number);
    expect(second.headers['idempotent-replay']).toBe('true');
    const conflict = await app.inject({ method: 'POST', url: '/api/v1/tickets', headers, payload: { subject: 'Anders' } });
    expect(conflict.statusCode).toBe(409);
    const list = await app.inject({ url: '/api/v1/tickets', headers: botHeaders(USER) });
    expect(list.json().total).toBe(1);
    await app.close();
  });
});

describe('API: Dashboard-Login mit Sitzung und CSRF', () => {
  it('Login nur mit Rechten, Sitzung, CSRF-Pflicht für Schreibzugriffe, Logout', async () => {
    const ctx = createTestContext();
    const [modRole] = await ctx.db.select().from(appRoles).where(eq(appRoles.key, 'moderation'));
    await ctx.db.insert(roleBindings).values({ roleId: modRole!.id, discordUserId: MOD });
    const oauthFetch = fakeOAuthFetch({ discordId: MOD, robloxId: 1, robloxName: 'x' });
    const { app } = await createTestApp(ctx, oauthFetch.impl);

    const start = await app.inject('/api/v1/auth/discord/login?redirect=//evil.example');
    expect(start.statusCode).toBe(302);
    const location = new URL(start.headers.location as string);
    expect(location.host).toBe('discord.com');
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    const state = location.searchParams.get('state')!;
    const binding = cookiesOf(start).enrp_oauth!;

    // Ohne Browser-Bindung (anderer Browser) schlägt der Callback fehl.
    const csrfAttempt = await app.inject({ url: `/api/v1/auth/discord/callback?code=c1&state=${state}`, cookies: { enrp_oauth: 'falsch' } });
    expect(csrfAttempt.headers.location).toContain('/login?error=');

    const start2 = await app.inject('/api/v1/auth/discord/login?redirect=/players');
    const state2 = new URL(start2.headers.location as string).searchParams.get('state')!;
    const callback = await app.inject({ url: `/api/v1/auth/discord/callback?code=c2&state=${state2}`, cookies: { enrp_oauth: cookiesOf(start2).enrp_oauth! } });
    expect(callback.headers.location).toBe('http://localhost:3000/players');
    const session = cookiesOf(callback).enrp_session!;
    expect(session).toBeTruthy();
    // State ist verbraucht (Replay-Schutz)
    const replay = await app.inject({ url: `/api/v1/auth/discord/callback?code=c2&state=${state2}`, cookies: { enrp_oauth: cookiesOf(start2).enrp_oauth! } });
    expect(replay.headers.location).toContain('error=');
    expect(binding).toBeTruthy();

    const me = await app.inject({ url: '/api/v1/auth/me', cookies: { enrp_session: session } });
    expect(me.statusCode).toBe(200);
    expect(me.json().permissions).toContain('moderation:create');
    const csrf = me.json().csrfToken;

    const noCsrf = await app.inject({ method: 'POST', url: '/api/v1/tickets', cookies: { enrp_session: session }, payload: { subject: 'x' } });
    expect(noCsrf.statusCode).toBe(403);
    expect(noCsrf.json().error.code).toBe('CSRF_FAILED');
    const wrongOrigin = await app.inject({ method: 'POST', url: '/api/v1/tickets', cookies: { enrp_session: session }, headers: { 'x-csrf-token': csrf, origin: 'https://evil.example' }, payload: { subject: 'x' } });
    expect(wrongOrigin.statusCode).toBe(403);
    const ok = await app.inject({ method: 'POST', url: '/api/v1/tickets', cookies: { enrp_session: session }, headers: { 'x-csrf-token': csrf, origin: 'http://localhost:3000' }, payload: { subject: 'Echt' } });
    expect(ok.statusCode).toBe(200);

    await app.inject({ method: 'POST', url: '/api/v1/auth/logout', cookies: { enrp_session: session }, headers: { 'x-csrf-token': csrf } });
    expect((await app.inject({ url: '/api/v1/auth/me', cookies: { enrp_session: session } })).statusCode).toBe(401);
    const logins = await ctx.db.select().from(auditEvents).where(eq(auditEvents.action, 'auth.login'));
    expect(logins).toHaveLength(1);
    await app.close();
  });

  it('Personen ohne Rechte erhalten keine Sitzung', async () => {
    const oauthFetch = fakeOAuthFetch({ discordId: USER, robloxId: 1, robloxName: 'x' });
    const { app } = await createTestApp(createTestContext(), oauthFetch.impl);
    const start = await app.inject('/api/v1/auth/discord/login');
    const state = new URL(start.headers.location as string).searchParams.get('state')!;
    const cb = await app.inject({ url: `/api/v1/auth/discord/callback?code=c&state=${state}`, cookies: { enrp_oauth: cookiesOf(start).enrp_oauth! } });
    expect(cb.headers.location).toContain('error=kein_zugriff');
    expect(cookiesOf(cb).enrp_session).toBeUndefined();
    await app.close();
  });
});

describe('API: Roblox-Verifizierung (Ende-zu-Ende mit OAuth-Attrappen)', () => {
  it('Discord-Bestätigung + Roblox-OAuth verknüpfen das Konto; fremdes Discord-Konto wird abgelehnt', async () => {
    const ctx = createTestContext({ verifiedRoleId: '800000000000000001' });
    const fake = fakeOAuthFetch({ discordId: USER, robloxId: 31337, robloxName: 'RPHeld' });
    const { app } = await createTestApp(ctx, fake.impl);

    const start = await app.inject({ method: 'POST', url: '/api/v1/verification/start', headers: botHeaders(USER) });
    expect(start.statusCode).toBe(200);
    const begin = await app.inject(new URL(start.json().url).pathname + new URL(start.json().url).search);
    expect(begin.statusCode).toBe(302);
    const bind = cookiesOf(begin).enrp_vbind!;
    const discordState = new URL(begin.headers.location as string).searchParams.get('state')!;
    const discordCb = await app.inject({ url: `/api/v1/verification/discord/callback?code=d1&state=${discordState}`, cookies: { enrp_vbind: bind } });
    const robloxUrl = new URL(discordCb.headers.location as string);
    expect(robloxUrl.host).toBe('apis.roblox.com');
    expect(robloxUrl.searchParams.get('scope')).toBe('openid profile');
    const robloxCb = await app.inject({ url: `/api/v1/verification/roblox/callback?code=r1&state=${robloxUrl.searchParams.get('state')}`, cookies: { enrp_vbind: bind } });
    expect(robloxCb.statusCode).toBe(200);
    expect(robloxCb.body).toContain('RPHeld');
    expect(robloxCb.headers['content-security-policy']).toContain("default-src 'none'");
    const [link] = await ctx.db.select().from(accountLinks).where(eq(accountLinks.discordUserId, USER));
    expect(link!.robloxUserId).toBe(31337);
    // Nur die Rolle „Verifiziert“ wird angefordert – keine Fraktionsrolle.
    const jobs = (ctx.queue as { jobs: Array<{ name: string; data: { roleId?: string } }> }).jobs;
    expect(jobs.filter((j) => j.name === 'role.add').map((j) => j.data.roleId)).toEqual(['800000000000000001']);
    // Tokens werden widerrufen.
    expect(fake.calls.filter((c) => c.includes('revoke'))).toHaveLength(2);

    const status = await app.inject({ url: '/api/v1/verification/status', headers: botHeaders(USER) });
    expect(status.json()).toMatchObject({ verified: true, roblox: { id: 31337, username: 'RPHeld' } });
    await app.close();
  });

  it('untergeschobener Link: anderes Discord-Konto im Browser wird erkannt', async () => {
    const ctx = createTestContext();
    const fake = fakeOAuthFetch({ discordId: MOD, robloxId: 5, robloxName: 'Opfer' });
    const { app } = await createTestApp(ctx, fake.impl);
    const start = await app.inject({ method: 'POST', url: '/api/v1/verification/start', headers: botHeaders(USER) });
    const url = new URL(start.json().url);
    const begin = await app.inject(url.pathname + url.search);
    const discordState = new URL(begin.headers.location as string).searchParams.get('state')!;
    const cb = await app.inject({ url: `/api/v1/verification/discord/callback?code=d&state=${discordState}`, cookies: { enrp_vbind: cookiesOf(begin).enrp_vbind! } });
    expect(cb.statusCode).toBe(403);
    expect(cb.body).toContain('Falsches Discord-Konto');
    expect(await ctx.db.select().from(accountLinks)).toHaveLength(0);
    await app.close();
  });
});

describe('API: Roblox-Spielserver', () => {
  it('Heartbeat mit Schlüssel, Replay-Erkennung und fehlende Header', async () => {
    const ctx = createTestContext();
    const { app } = await createTestApp(ctx);
    const { key } = await game.createRobloxApiKey(ctx, await owner(ctx), { name: 'Live' }, 'Einrichtung');
    const headers = (nonce: string) => ({ authorization: `Bearer ${key}`, 'x-roblox-timestamp': String(Math.floor(ctx.now().getTime() / 1000)), 'x-roblox-nonce': nonce });
    const payload = { jobId: 'job-a', placeId: '1', players: [{ userId: 10, username: 'Spieler10' }] };
    const ok = await app.inject({ method: 'POST', url: '/api/v1/game/heartbeat', headers: headers('nonce-aaaaaaaaaaaaaaaa'), payload });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ killSwitch: false, maintenance: { active: false } });
    const replay = await app.inject({ method: 'POST', url: '/api/v1/game/heartbeat', headers: headers('nonce-aaaaaaaaaaaaaaaa'), payload });
    expect(replay.statusCode).toBe(409);
    expect(replay.json().error.code).toBe('REPLAY_DETECTED');
    const noKey = await app.inject({ method: 'POST', url: '/api/v1/game/heartbeat', payload });
    expect(noKey.statusCode).toBe(401);
    const invalid = await app.inject({ method: 'POST', url: '/api/v1/game/events', headers: headers('nonce-bbbbbbbbbbbbbbbb'), payload: { jobId: 'job-a', events: [{ id: 'x', type: 'hack', data: {} }] } });
    expect(invalid.statusCode).toBe(400);
    const redeemNoKey = await app.inject({ method: 'POST', url: '/api/v1/game/redeem', headers: headers('nonce-cccccccccccccccc'), payload: { jobId: 'job-a', userId: 10, code: 'ABCD' } });
    expect(redeemNoKey.statusCode).toBe(400);
    await app.close();
  });
});
