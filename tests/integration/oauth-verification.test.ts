import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '@emden-network/api';
import { OUTBOX_ROLE_GRANT, RobloxOAuthClient, VerificationService } from '@emden-network/core';
import type { Pool } from '@emden-network/database';
import { resetDb, snowflake, testPool } from '../helpers/db.js';
import { RobloxOAuthMock } from '../helpers/roblox-mock.js';

const PUBLIC_BASE = 'http://localhost:3000';
const GUILD = '900000000000000001';

let pool: Pool;
let mock: RobloxOAuthMock;
let app: FastifyInstance;
let verification: VerificationService;

beforeAll(async () => {
  pool = testPool();
  mock = new RobloxOAuthMock();
  await mock.start();
  const oauth = new RobloxOAuthClient({
    clientId: mock.clientId,
    clientSecret: mock.clientSecret,
    redirectUri: `${PUBLIC_BASE}/auth/roblox/callback`,
    baseUrl: mock.baseUrl,
    timeoutMs: 2000,
  });
  verification = new VerificationService(pool, oauth, { publicBaseUrl: PUBLIC_BASE });
  app = await buildApp({
    pool,
    verification,
    cookieSecure: true,
    internalApiToken: 'i'.repeat(40),
    gameApiKey: 'g'.repeat(40),
    allowedPlaceIds: new Set(),
    disableRateLimit: true,
  });
});

afterAll(async () => {
  await app.close();
  await mock.stop();
  await pool.end();
});

beforeEach(async () => {
  await resetDb(pool);
  mock.reset();
});

/** Startet den Ablauf wie ein Browser: Discord-Link öffnen -> Redirect zu Roblox + Cookie. */
async function startFlow(discordId = snowflake()) {
  const { url } = await verification.createSession(discordId, GUILD);
  const startPath = new URL(url).pathname + new URL(url).search;
  const res = await app.inject({ method: 'GET', url: startPath });
  expect(res.statusCode).toBe(302);
  const setCookie = res.cookies.find((c) => c.name === '__Host-en_oauth');
  expect(setCookie).toBeDefined();
  return { discordId, authorizeUrl: res.headers.location as string, cookie: `__Host-en_oauth=${setCookie!.value}`, startPath };
}

function callback(params: Record<string, string>, cookie?: string) {
  const qs = new URLSearchParams(params).toString();
  return app.inject({ method: 'GET', url: `/auth/roblox/callback?${qs}`, headers: cookie ? { cookie } : {} });
}

describe('Roblox-OAuth-Verifizierung', () => {
  it('verknüpft erfolgreich und plant die Rollenvergabe ein', async () => {
    const { discordId, authorizeUrl, cookie } = await startFlow();

    // Autorisierungs-URL entspricht der offiziellen Spezifikation
    const au = new URL(authorizeUrl);
    expect(au.origin + au.pathname).toBe(`${mock.baseUrl}/v1/authorize`);
    expect(au.searchParams.get('scope')).toBe('openid profile');
    expect(au.searchParams.get('response_type')).toBe('code');
    expect(au.searchParams.get('code_challenge_method')).toBe('S256');
    expect(au.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(au.searchParams.get('state')!.length).toBeGreaterThanOrEqual(43);
    expect(au.searchParams.has('client_secret')).toBe(false);
    expect(au.searchParams.get('redirect_uri')).toBe(`${PUBLIC_BASE}/auth/roblox/callback`);

    const params = mock.approve(authorizeUrl, { sub: '5550001', preferred_username: 'EmdenTester', name: 'Tester' });
    const res = await callback(params, cookie);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Verifizierung erfolgreich');
    expect(res.body).toContain('EmdenTester');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['referrer-policy']).toBe('no-referrer');

    const link = await pool.query('SELECT l.roblox_user_id, l.roblox_username FROM discord_links l JOIN users u ON u.id = l.user_id WHERE u.discord_id = $1 AND l.revoked_at IS NULL', [discordId]);
    expect(link.rows).toEqual([{ roblox_user_id: '5550001', roblox_username: 'EmdenTester' }]);

    const session = await pool.query('SELECT status, code_verifier, roblox_user_id FROM oauth_verification_sessions WHERE discord_id = $1', [discordId]);
    expect(session.rows[0]).toEqual({ status: 'completed', code_verifier: null, roblox_user_id: '5550001' });

    const outbox = await pool.query('SELECT type, payload FROM outbox_events');
    expect(outbox.rows).toEqual([{ type: OUTBOX_ROLE_GRANT, payload: { guildId: GUILD, discordId, notify: true, robloxUsername: 'EmdenTester' } }]);

    // Refresh-Token wird widerrufen und nirgends gespeichert
    await new Promise((r) => setTimeout(r, 50));
    expect(mock.revokedTokens).toHaveLength(1);
    const dump = await pool.query(`SELECT string_agg(t::text, ' ') AS s FROM (SELECT row_to_json(a) t FROM audit_logs a UNION ALL SELECT row_to_json(o) FROM oauth_verification_sessions o) x`);
    expect(dump.rows[0].s).not.toContain(mock.revokedTokens[0]);
    expect(dump.rows[0].s).not.toContain(params.code);
  });

  it('behandelt einen nicht erreichbaren Roblox-Server (Netzwerkausfall)', async () => {
    const { discordId, authorizeUrl, cookie } = await startFlow();
    const params = mock.approve(authorizeUrl, { sub: '5550099' });
    const offline = new VerificationService(pool, new RobloxOAuthClient({ clientId: '1', clientSecret: 'x'.repeat(16), redirectUri: 'http://localhost/cb', baseUrl: 'http://127.0.0.1:9/oauth', timeoutMs: 500 }), { publicBaseUrl: PUBLIC_BASE });
    const binding = cookie.split('=')[1];
    expect(await offline.handleCallback({ ...params, browserBinding: binding })).toEqual({ ok: false, code: 'TOKEN_EXCHANGE_FAILED' });
    const s = await pool.query('SELECT status FROM oauth_verification_sessions WHERE discord_id = $1', [discordId]);
    expect(s.rows[0].status).toBe('failed');
  });

  it('lehnt manipulierten state ab', async () => {
    const { authorizeUrl, cookie } = await startFlow();
    const params = mock.approve(authorizeUrl, { sub: '5550002' });
    const res = await callback({ ...params, state: `${params.state}x` }, cookie);
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('ungültig');
    expect(mock.tokenRequests).toBe(0);
    expect((await pool.query('SELECT count(*)::int AS n FROM discord_links')).rows[0].n).toBe(0);
  });

  it('lehnt fehlenden state ab', async () => {
    const res = await callback({ code: 'abc' });
    expect(res.statusCode).toBe(400);
  });

  it('lehnt Callback ohne passendes Browser-Cookie ab (Login-CSRF)', async () => {
    const { discordId, authorizeUrl } = await startFlow();
    const params = mock.approve(authorizeUrl, { sub: '5550003' });
    const res = await callback(params, '__Host-en_oauth=fremder-browser-wert');
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('anderen Browser');
    expect(mock.tokenRequests).toBe(0);
    const s = await pool.query('SELECT status, failure_code, code_verifier FROM oauth_verification_sessions WHERE discord_id = $1', [discordId]);
    expect(s.rows[0]).toEqual({ status: 'failed', failure_code: 'BROWSER_MISMATCH', code_verifier: null });
  });

  it('lehnt abgelaufene Session ab', async () => {
    const { discordId, authorizeUrl, cookie } = await startFlow();
    await pool.query(`UPDATE oauth_verification_sessions SET expires_at = now() - interval '1 second' WHERE discord_id = $1`, [discordId]);
    const res = await callback(mock.approve(authorizeUrl, { sub: '5550004' }), cookie);
    expect(res.statusCode).toBe(410);
    expect(res.body).toContain('abgelaufen');
    expect(mock.tokenRequests).toBe(0);
  });

  it('lehnt abgelaufenen Start-Link ab', async () => {
    const discordId = snowflake();
    const { url } = await verification.createSession(discordId, GUILD);
    await pool.query(`UPDATE oauth_verification_sessions SET expires_at = now() - interval '1 second' WHERE discord_id = $1`, [discordId]);
    const res = await app.inject({ method: 'GET', url: new URL(url).pathname + new URL(url).search });
    expect(res.statusCode).toBe(410);
  });

  it('erlaubt den Start-Link nur einmal', async () => {
    const { startPath } = await startFlow();
    const again = await app.inject({ method: 'GET', url: startPath });
    expect(again.statusCode).toBe(409);
    expect(again.headers['set-cookie']).toBeUndefined();
  });

  it('verhindert die Wiederverwendung eines Callbacks/Autorisierungscodes', async () => {
    const { authorizeUrl, cookie } = await startFlow();
    const params = mock.approve(authorizeUrl, { sub: '5550005' });
    expect((await callback(params, cookie)).statusCode).toBe(200);
    const replay = await callback(params, cookie);
    expect(replay.statusCode).toBe(409);
    expect(replay.body).toContain('bereits verwendet');
    expect(mock.tokenRequests).toBe(1);
    const audit = await pool.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'verification.replay_rejected'`);
    expect(audit.rows[0].n).toBe(1);
  });

  it('verarbeitet parallele Callbacks mit demselben state genau einmal', async () => {
    const { authorizeUrl, cookie } = await startFlow();
    const params = mock.approve(authorizeUrl, { sub: '5550006' });
    mock.behavior.tokenDelayMs = 100;
    const results = await Promise.all([callback(params, cookie), callback(params, cookie), callback(params, cookie)]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409, 409]);
    expect(mock.tokenRequests).toBe(1);
  });

  it('behandelt fehlgeschlagenen Token-Austausch', async () => {
    const { discordId, authorizeUrl, cookie } = await startFlow();
    mock.behavior.tokenStatus = 500;
    const res = await callback(mock.approve(authorizeUrl, { sub: '5550007' }), cookie);
    expect(res.statusCode).toBe(502);
    expect(res.body).not.toContain('server_error');
    const s = await pool.query('SELECT status, failure_code, code_verifier FROM oauth_verification_sessions WHERE discord_id = $1', [discordId]);
    expect(s.rows[0]).toEqual({ status: 'failed', failure_code: 'TOKEN_EXCHANGE_FAILED', code_verifier: null });
  });

  it('erkennt einen falschen PKCE-Verifier beim Token-Austausch', async () => {
    const { authorizeUrl, cookie } = await startFlow();
    const params = mock.approve(authorizeUrl, { sub: '5550008' });
    // Angreifer kennt den Verifier nicht: wir manipulieren die gespeicherte Challenge im Mock nicht,
    // sondern den Verifier in der DB, um den Prüfpfad des Mocks zu verifizieren.
    await pool.query(`UPDATE oauth_verification_sessions SET code_verifier = 'falscher-verifier-falscher-verifier-falscher-verifier' WHERE status = 'started'`);
    const res = await callback(params, cookie);
    expect(res.statusCode).toBe(502);
    expect((await pool.query('SELECT count(*)::int AS n FROM discord_links')).rows[0].n).toBe(0);
  });

  it.each([
    ['ohne sub', { name: 'x' }],
    ['mit nicht-numerischem sub', { sub: 'abc' }],
    ['als null', null],
  ])('lehnt ungültige Userinfo-Antwort ab (%s)', async (_label, body) => {
    const { authorizeUrl, cookie } = await startFlow();
    mock.behavior.userinfoBody = body;
    const res = await callback(mock.approve(authorizeUrl, { sub: '5550009' }), cookie);
    expect(res.statusCode).toBe(502);
    expect(res.body).toContain('keine gültigen Kontodaten');
    expect((await pool.query('SELECT count(*)::int AS n FROM discord_links')).rows[0].n).toBe(0);
  });

  it('lehnt eine bereits mit anderem Discord-Account verknüpfte Roblox-ID ab', async () => {
    const first = await startFlow();
    expect((await callback(mock.approve(first.authorizeUrl, { sub: '5550010' }), first.cookie)).statusCode).toBe(200);

    const second = await startFlow();
    const res = await callback(mock.approve(second.authorizeUrl, { sub: '5550010' }), second.cookie);
    expect(res.statusCode).toBe(409);
    expect(res.body).toContain('bereits mit einem anderen Discord-Account');
    const links = await pool.query('SELECT count(*)::int AS n FROM discord_links WHERE roblox_user_id = 5550010');
    expect(links.rows[0].n).toBe(1);
    const outbox = await pool.query('SELECT count(*)::int AS n FROM outbox_events');
    expect(outbox.rows[0].n).toBe(1);
  });

  it('lehnt /verify ab, wenn der Discord-Account bereits verknüpft ist', async () => {
    const f = await startFlow();
    await callback(mock.approve(f.authorizeUrl, { sub: '5550011' }), f.cookie);
    await expect(verification.createSession(f.discordId, GUILD)).rejects.toMatchObject({ code: 'DISCORD_ALREADY_LINKED' });
  });

  it('lehnt eine zweite Roblox-ID für denselben Discord-Account ab (Race zwischen zwei Sessions)', async () => {
    const discordId = snowflake();
    // Erste Session startet, wird aber erst später abgeschlossen; dazwischen wird direkt verknüpft.
    const f = await startFlow(discordId);
    const userId = (await pool.query('INSERT INTO users (discord_id) VALUES ($1) ON CONFLICT (discord_id) DO UPDATE SET updated_at = now() RETURNING id', [discordId])).rows[0].id;
    await pool.query('INSERT INTO discord_links (user_id, roblox_user_id) VALUES ($1, 7770001)', [userId]);
    const res = await callback(mock.approve(f.authorizeUrl, { sub: '5550012' }), f.cookie);
    expect(res.statusCode).toBe(409);
    expect(res.body).toContain('/unlink');
  });

  it('ist idempotent, wenn dieselbe Kombination erneut verknüpft wird', async () => {
    const discordId = snowflake();
    const f = await startFlow(discordId);
    const userId = (await pool.query('INSERT INTO users (discord_id) VALUES ($1) ON CONFLICT (discord_id) DO UPDATE SET updated_at = now() RETURNING id', [discordId])).rows[0].id;
    await pool.query('INSERT INTO discord_links (user_id, roblox_user_id) VALUES ($1, 5550013)', [userId]);
    const res = await callback(mock.approve(f.authorizeUrl, { sub: '5550013', preferred_username: 'Neu' }), f.cookie);
    expect(res.statusCode).toBe(200);
    const links = await pool.query('SELECT roblox_username FROM discord_links WHERE user_id = $1', [userId]);
    expect(links.rows).toEqual([{ roblox_username: 'Neu' }]);
  });

  it('behandelt den Abbruch bei Roblox (access_denied) ohne Token-Austausch', async () => {
    const { discordId, authorizeUrl, cookie } = await startFlow();
    const { state } = mock.approve(authorizeUrl, { sub: '1' });
    const res = await callback({ state, error: 'access_denied' }, cookie);
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('/verify erneut');
    expect(mock.tokenRequests).toBe(0);
    // Neustart ist möglich
    await expect(verification.createSession(discordId, GUILD)).resolves.toBeDefined();
  });

  it('macht ältere Links ungültig, wenn /verify erneut ausgeführt wird', async () => {
    const discordId = snowflake();
    const old = await verification.createSession(discordId, GUILD);
    await verification.createSession(discordId, GUILD);
    const res = await app.inject({ method: 'GET', url: new URL(old.url).pathname + new URL(old.url).search });
    expect(res.statusCode).toBe(409);
  });

  it('begrenzt die Anzahl neuer Sessions je Nutzer', async () => {
    const discordId = snowflake();
    for (let i = 0; i < 5; i++) await verification.createSession(discordId, GUILD);
    await expect(verification.createSession(discordId, GUILD)).rejects.toMatchObject({ code: 'TOO_MANY_ATTEMPTS' });
  });

  it('lehnt syntaktisch ungültige Start-Tokens ab', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/roblox/start?t=%3Cscript%3E' });
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toContain('<script>');
  });

  it('bereinigt abgelaufene und alte Sessions', async () => {
    const a = snowflake();
    await verification.createSession(a, GUILD);
    await pool.query(`UPDATE oauth_verification_sessions SET expires_at = now() - interval '1 minute'`);
    expect(await verification.cleanup()).toEqual({ expired: 1, deleted: 0 });
    await pool.query(`UPDATE oauth_verification_sessions SET created_at = now() - interval '25 hours'`);
    expect(await verification.cleanup()).toEqual({ expired: 0, deleted: 1 });
  });

  it('hebt eine Verknüpfung auf und plant den Rollenentzug ein', async () => {
    const f = await startFlow();
    await callback(mock.approve(f.authorizeUrl, { sub: '5550014' }), f.cookie);
    await verification.revokeLink({ discordId: f.discordId, guildId: GUILD, actorDiscordId: f.discordId, reason: 'Selbst aufgehoben' });
    const active = await pool.query('SELECT count(*)::int AS n FROM discord_links WHERE revoked_at IS NULL');
    expect(active.rows[0].n).toBe(0);
    await expect(verification.revokeLink({ discordId: f.discordId, guildId: GUILD, actorDiscordId: f.discordId, reason: 'x' })).rejects.toMatchObject({ code: 'NOT_LINKED' });
    // Erneute Verknüpfung derselben Roblox-ID ist danach möglich
    const g = await startFlow(f.discordId);
    expect((await callback(mock.approve(g.authorizeUrl, { sub: '5550014' }), g.cookie)).statusCode).toBe(200);
  });
});
