import { PERMISSION_KEYS, apiErrorSchema } from '@emden/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { DiscordError } from '../src/auth/discord.js';
import { pkceChallenge, sha256Hex } from '../src/auth/tokens.js';
import type { DatabaseHandle } from '../src/db/database.js';
import { auditLog, sessions, users } from '../src/db/schema.js';
import { safeReturnPath } from '../src/routes/auth.js';
import { ALICE, DASHBOARD, fakeDiscord, insertUser, login, startLogin } from './support/auth.js';
import { createTestDatabase, resetDatabase } from './support/database.js';
import { testConfig } from './helpers.js';

let handle: DatabaseHandle;
let app: FastifyInstance | undefined;
let now: Date;

beforeAll(async () => {
  handle = await createTestDatabase();
});
afterAll(async () => {
  await handle.close();
});
beforeEach(async () => {
  await resetDatabase(handle);
  now = new Date('2026-10-28T12:00:00Z');
});
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function start(discord = fakeDiscord(), overrides: Parameters<typeof testConfig>[0] = {}) {
  app = await buildApp(testConfig(overrides), { db: handle, discord: discord.discord, clock: () => now });
  return { app, calls: discord.calls };
}

const auditRows = () => handle.db.select().from(auditLog).orderBy(auditLog.id);

describe('GET /auth/status', () => {
  it('meldet, ob die Discord-Anmeldung eingerichtet ist', async () => {
    const { app } = await start();
    expect((await app.inject({ url: '/auth/status' })).json()).toEqual({ discordLogin: 'configured' });
    await app.close();
    const unconfigured = await buildApp(testConfig(), { db: handle, discord: null });
    expect((await unconfigured.inject({ url: '/auth/status' })).json()).toEqual({
      discordLogin: 'not_configured',
    });
    await unconfigured.close();
  });
});

describe('Anmeldung starten', () => {
  it('leitet zu Discord weiter – mit state, PKCE und kurzlebigem, geschütztem Cookie', async () => {
    const { app, calls } = await start();
    const { res, state } = await startLogin(app);
    expect(res.headers.location).toMatch(/^https:\/\/discord\.com\/oauth2\/authorize\?/);
    expect(calls.authorize[0]).toMatchObject({ redirectUri: `${DASHBOARD}/api/auth/discord/callback` });
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(calls.authorize[0]?.codeChallenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(res.cookies.find((c) => c.name === 'en_oauth')).toMatchObject({
      httpOnly: true,
      sameSite: 'Lax',
      path: '/',
      maxAge: 600,
    });
  });

  it('erzeugt bei jedem Versuch neue Zufallswerte', async () => {
    const { app, calls } = await start();
    const first = await startLogin(app);
    const second = await startLogin(app);
    expect(first.state).not.toBe(second.state);
    expect(calls.authorize[0]?.codeChallenge).not.toBe(calls.authorize[1]?.codeChallenge);
  });

  it('zeigt "nicht eingerichtet", wenn Discord nicht konfiguriert ist', async () => {
    app = await buildApp(testConfig(), { db: handle, discord: null });
    const res = await app.inject({ url: '/auth/discord/login' });
    expect(res.headers.location).toBe(`${DASHBOARD}/login?error=not_configured`);
  });

  it('nutzt in Produktion (HTTPS) Cookies mit __Host-Präfix und Secure', async () => {
    const { app } = await start(fakeDiscord(), { dashboardOrigin: 'https://cc.example.org' });
    const res = await app.inject({ url: '/auth/discord/login' });
    expect(res.cookies.find((c) => c.name === '__Host-en_oauth')).toMatchObject({ secure: true, path: '/' });
  });
});

describe('Rückkehr von Discord', () => {
  it('meldet eine freigeschaltete Person an und speichert nur den Hash der Sitzung', async () => {
    const userId = await insertUser(handle.db, { discordUserId: ALICE.id, displayName: 'Alter Name' });
    const { app, calls } = await start();
    const { res, location, session } = await login(app, '?returnTo=%2Fservers%3Ftab%3D1');

    expect(res.statusCode).toBe(302);
    expect(location).toBe(`${DASHBOARD}/servers?tab=1`);
    expect(res.cookies.find((c) => c.name === 'en_session')).toMatchObject({
      httpOnly: true,
      sameSite: 'Lax',
      path: '/',
      maxAge: 24 * 3600,
    });
    expect(session).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const [stored] = await handle.db.select().from(sessions);
    expect(stored?.tokenHash).toBe(sha256Hex(session as string));
    expect(JSON.stringify(stored)).not.toContain(session);

    // PKCE: Der Verifier, der bei Discord eingelöst wird, passt zur vorher gesendeten Challenge.
    expect(pkceChallenge(calls.exchange[0]?.codeVerifier as string)).toBe(calls.authorize[0]?.codeChallenge);
    expect(calls.exchange[0]?.redirectUri).toBe(`${DASHBOARD}/api/auth/discord/callback`);
    expect(calls.revoke).toEqual(['discord-access-token']);

    const [user] = await handle.db.select().from(users).where(eq(users.id, userId));
    expect(user?.displayName).toBe('Alice Emden');
    expect(user?.lastLoginAt?.toISOString()).toBe(now.toISOString());

    const audit = await auditRows();
    expect(audit).toMatchObject([{ action: 'auth.login', outcome: 'success', actorUserId: userId }]);
  });

  it('entfernt das Ablauf-Cookie nach jedem Versuch', async () => {
    await insertUser(handle.db, { discordUserId: ALICE.id });
    const { app } = await start();
    const { res } = await login(app);
    const cleared = res.cookies.find((c) => c.name === 'en_oauth');
    expect(cleared?.value).toBe('');
  });

  it('lehnt nicht freigeschaltete Discord-Konten ab und protokolliert den Versuch', async () => {
    const { app } = await start();
    const { location, session } = await login(app);
    expect(location).toBe(`${DASHBOARD}/login?error=not_registered`);
    expect(session).toBeUndefined();
    expect(await auditRows()).toMatchObject([
      { action: 'auth.login_denied', outcome: 'denied', targetType: 'discord_user', targetId: ALICE.id },
    ]);
  });

  it('lehnt gesperrte Benutzer ab', async () => {
    await insertUser(handle.db, { discordUserId: ALICE.id, status: 'disabled' });
    const { app } = await start();
    const { location, session } = await login(app);
    expect(location).toBe(`${DASHBOARD}/login?error=account_disabled`);
    expect(session).toBeUndefined();
    expect((await auditRows())[0]).toMatchObject({
      action: 'auth.login_denied',
      details: { reason: 'disabled' },
    });
  });

  it.each([
    ['falscher state', (state: string) => `code=abc&state=${state}x`, true],
    ['fehlender state', () => 'code=abc', true],
    ['fehlendes Ablauf-Cookie', (state: string) => `code=abc&state=${state}`, false],
    [
      'fremder Aussteller (iss)',
      (state: string) => `code=abc&state=${state}&iss=https%3A%2F%2Fevil.example`,
      true,
    ],
  ])('verweigert die Anmeldung bei %s', async (_name, query, withCookie) => {
    await insertUser(handle.db, { discordUserId: ALICE.id });
    const { app, calls } = await start();
    const { state, oauthCookie } = await startLogin(app);
    const res = await app.inject({
      url: `/auth/discord/callback?${query(state)}`,
      cookies: withCookie ? { en_oauth: oauthCookie } : {},
    });
    expect(res.headers.location).toBe(`${DASHBOARD}/login?error=state_mismatch`);
    expect(calls.exchange).toEqual([]);
  });

  it('verweigert die Anmeldung, wenn der Versuch älter als 10 Minuten ist', async () => {
    await insertUser(handle.db, { discordUserId: ALICE.id });
    const { app } = await start();
    const { state, oauthCookie } = await startLogin(app);
    now = new Date(now.getTime() + 11 * 60_000);
    const res = await app.inject({
      url: `/auth/discord/callback?code=abc&state=${state}`,
      cookies: { en_oauth: oauthCookie },
    });
    expect(res.headers.location).toBe(`${DASHBOARD}/login?error=state_mismatch`);
  });

  it('meldet "abgebrochen", wenn die Person bei Discord auf "Abbrechen" klickt', async () => {
    const { app, calls } = await start();
    const { state, oauthCookie } = await startLogin(app);
    const res = await app.inject({
      url: `/auth/discord/callback?error=access_denied&state=${state}`,
      cookies: { en_oauth: oauthCookie },
    });
    expect(res.headers.location).toBe(`${DASHBOARD}/login?error=cancelled`);
    expect(calls.exchange).toEqual([]);
  });

  it.each([
    ['unavailable', 'discord_unavailable'],
    ['rejected', 'login_failed'],
    ['invalid_response', 'login_failed'],
  ] as const)('meldet Discord-Fehler "%s" verständlich als %s', async (kind, expected) => {
    const { app } = await start(fakeDiscord(new DiscordError(kind, 'Test')));
    const { location } = await login(app);
    expect(location).toBe(`${DASHBOARD}/login?error=${expected}`);
  });

  it.each(['//evil.example', 'https://evil.example', '/\\evil.example', '/login', '/%0d%0aSet-Cookie:x'])(
    'leitet nach dem Login nie auf fremde Seiten weiter (returnTo=%s)',
    async (target) => {
      await insertUser(handle.db, { discordUserId: ALICE.id });
      const { app } = await start();
      const { location } = await login(app, `?returnTo=${encodeURIComponent(target)}`);
      expect(new URL(location).origin).toBe(DASHBOARD);
      if (target !== '/%0d%0aSet-Cookie:x') expect(location).toBe(`${DASHBOARD}/`);
    },
  );
});

describe('safeReturnPath', () => {
  it.each([
    ['/servers', '/servers'],
    ['/players?id=5#x', '/players?id=5#x'],
    ['//evil.example', '/'],
    ['/\\evil.example', '/'],
    ['https://evil.example', '/'],
    ['/mit leerzeichen', '/'],
    ['/api/auth/logout', '/'],
    [undefined, '/'],
    [42, '/'],
  ])('%s → %s', (input, expected) => {
    expect(safeReturnPath(input)).toBe(expected);
  });
});

describe('Sitzungen', () => {
  async function loggedIn(roleKey = 'viewer') {
    await insertUser(handle.db, { discordUserId: ALICE.id, roleKey });
    const { app } = await start();
    const { session } = await login(app);
    const me = () => app.inject({ url: '/auth/me', cookies: { en_session: session as string } });
    return { app, session: session as string, me };
  }

  it('liefert unter /auth/me Benutzer, Rolle und Berechtigungen', async () => {
    const { me } = await loggedIn('moderator');
    const res = await me();
    expect(res.statusCode).toBe(200);
    expect(res.json().user).toMatchObject({
      discordUserId: ALICE.id,
      displayName: 'Alice Emden',
      role: { key: 'moderator', name: 'Moderator', rank: 60 },
      permissions: ['roles.read', 'users.read'],
    });
  });

  it('gibt dem Owner immer alle Berechtigungen', async () => {
    const { me } = await loggedIn('owner');
    expect((await me()).json().user.permissions).toEqual([...PERMISSION_KEYS].sort());
  });

  it('antwortet ohne oder mit ungültigem Cookie mit 401', async () => {
    const { app } = await start();
    for (const cookies of [{}, { en_session: 'kaputt' }, { en_session: 'a'.repeat(43) }]) {
      const res = await app.inject({ url: '/auth/me', cookies });
      expect(res.statusCode).toBe(401);
      expect(apiErrorSchema.parse(res.json()).error.code).toBe('UNAUTHENTICATED');
    }
  });

  it('endet nach 4 Stunden ohne Aktivität', async () => {
    const { me } = await loggedIn();
    now = new Date(now.getTime() + 239 * 60_000);
    expect((await me()).statusCode).toBe(200);
    now = new Date(now.getTime() + 241 * 60_000);
    expect((await me()).statusCode).toBe(401);
    expect(await handle.db.select().from(sessions)).toEqual([]);
  });

  it('endet spätestens nach 24 Stunden, auch bei ständiger Aktivität', async () => {
    const { me } = await loggedIn();
    for (let hour = 3; hour < 24; hour += 3) {
      now = new Date(Date.parse('2026-10-28T12:00:00Z') + hour * 3_600_000);
      expect((await me()).statusCode).toBe(200);
    }
    now = new Date(Date.parse('2026-10-28T12:00:00Z') + 24 * 3_600_000 + 60_000);
    expect((await me()).statusCode).toBe(401);
  });

  it('endet sofort, wenn der Benutzer gesperrt wird', async () => {
    const { me } = await loggedIn();
    await handle.db.update(users).set({ status: 'disabled' }).where(eq(users.discordUserId, ALICE.id));
    expect((await me()).statusCode).toBe(401);
  });

  it('meldet sich ab: Sitzung gelöscht, Cookie entfernt, Eintrag im Audit-Log', async () => {
    const { app, session, me } = await loggedIn();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      cookies: { en_session: session },
      headers: { origin: DASHBOARD, 'sec-fetch-site': 'same-origin' },
    });
    expect(res.statusCode).toBe(204);
    expect(res.cookies.find((c) => c.name === 'en_session')?.value).toBe('');
    expect((await me()).statusCode).toBe(401);
    expect((await auditRows()).map((r) => r.action)).toEqual(['auth.login', 'auth.logout']);
  });
});

describe('Schutz gegen Anfragen fremder Webseiten (CSRF)', () => {
  async function loggedIn() {
    await insertUser(handle.db, { discordUserId: ALICE.id });
    const { app } = await start();
    const { session } = await login(app);
    return { app, session: session as string };
  }

  it.each([
    ['fremder Origin', { origin: 'https://evil.example' }],
    ['Origin "null"', { origin: 'null' }],
    ['cross-site ohne Origin', { 'sec-fetch-site': 'cross-site' }],
    ['same-site ohne Origin', { 'sec-fetch-site': 'same-site' }],
  ])('lehnt verändernde Anfragen ab: %s', async (_name, headers) => {
    const { app, session } = await loggedIn();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      cookies: { en_session: session },
      headers,
    });
    expect(res.statusCode).toBe(403);
    expect(apiErrorSchema.parse(res.json()).error.code).toBe('CSRF_REJECTED');
    // Die Sitzung ist unverändert gültig.
    expect((await app.inject({ url: '/auth/me', cookies: { en_session: session } })).statusCode).toBe(200);
  });

  it('erlaubt Anfragen vom Dashboard-Server (ohne Browser-Header)', async () => {
    const { app, session } = await loggedIn();
    const res = await app.inject({ method: 'POST', url: '/auth/logout', cookies: { en_session: session } });
    expect(res.statusCode).toBe(204);
  });
});

describe('Rate Limit', () => {
  it('begrenzt Anmeldeversuche auf 20 pro Minute', async () => {
    const { app } = await start();
    const codes: number[] = [];
    for (let i = 0; i < 21; i++) codes.push((await app.inject({ url: '/auth/discord/login' })).statusCode);
    expect(codes.slice(0, 20).every((code) => code === 302)).toBe(true);
    expect(codes[20]).toBe(429);
  });
});

describe('Rate Limit für angemeldete Personen', () => {
  it('zählt angemeldete Personen pro Sitzung – gefälschte Sitzungen zählen wie Unbekannte', async () => {
    await insertUser(handle.db, { discordUserId: ALICE.id });
    const { app } = await start(fakeDiscord(), { rateLimit: { max: 2, windowMs: 60_000 } });
    const { session } = await login(app);

    // Unbekannte (auch mit erfundenem Cookie) teilen sich das IP-Limit: 2 pro Minute.
    const anonymous = [];
    for (let i = 0; i < 3; i++) {
      anonymous.push(
        (await app.inject({ url: '/auth/me', cookies: { en_session: 'x'.repeat(43) } })).statusCode,
      );
    }
    expect(anonymous).toEqual([401, 401, 429]);

    // Die angemeldete Person hat ihr eigenes, höheres Limit (2 × 6 = 12) – trotz gleicher IP.
    const own = [];
    for (let i = 0; i < 13; i++) {
      own.push(
        (await app.inject({ url: '/auth/me', cookies: { en_session: session as string } })).statusCode,
      );
    }
    expect(own.slice(0, 12).every((code) => code === 200)).toBe(true);
    expect(own[12]).toBe(429);
  });
});
