import type { FastifyInstance } from 'fastify';
import { expect } from 'vitest';
import type { DiscordIdentity, DiscordOAuth } from '../../src/auth/discord.js';
import type { Database } from '../../src/db/database.js';
import { users } from '../../src/db/schema.js';

export const DASHBOARD = 'http://127.0.0.1:3000';
export const ALICE: DiscordIdentity = {
  id: '111111111111111111',
  username: 'alice',
  globalName: 'Alice Emden',
};

/** Discord-Attrappe: zeichnet Aufrufe auf und liefert eine feste Identität oder einen Fehler. */
export function fakeDiscord(result: DiscordIdentity | Error = ALICE) {
  const calls = {
    authorize: [] as { state: string; codeChallenge: string; redirectUri: string }[],
    exchange: [] as { code: string; codeVerifier: string; redirectUri: string }[],
    revoke: [] as string[],
  };
  const discord: DiscordOAuth = {
    issuer: 'https://discord.com',
    authorizeUrl(params) {
      calls.authorize.push(params);
      const url = new URL('https://discord.com/oauth2/authorize');
      url.searchParams.set('state', params.state);
      url.searchParams.set('code_challenge', params.codeChallenge);
      return url.toString();
    },
    async exchangeCode(params) {
      calls.exchange.push(params);
      if (result instanceof Error) throw result;
      return 'discord-access-token';
    },
    async fetchIdentity() {
      if (result instanceof Error) throw result;
      return result;
    },
    async revokeToken(token) {
      calls.revoke.push(token);
    },
  };
  return { discord, calls };
}

export async function insertUser(
  db: Database,
  values: { discordUserId: string; displayName?: string; roleKey?: string; status?: 'active' | 'disabled' },
): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({
      discordUserId: values.discordUserId,
      displayName: values.displayName ?? 'Testperson',
      roleKey: values.roleKey ?? 'viewer',
      status: values.status ?? 'active',
    })
    .returning({ id: users.id });
  return (row as { id: string }).id;
}

/** Startet den Login: liefert state und das Ablauf-Cookie, wie es der Browser hätte. */
export async function startLogin(app: FastifyInstance, query = '') {
  const res = await app.inject({ url: `/auth/discord/login${query}` });
  expect(res.statusCode).toBe(302);
  const location = new URL(res.headers.location as string);
  const cookie = res.cookies.find((c) => c.name === 'en_oauth');
  return { res, state: location.searchParams.get('state') ?? '', oauthCookie: cookie?.value ?? '' };
}

/** Kompletter Login; liefert die Weiterleitung und das Sitzungs-Cookie (falls erfolgreich). */
export async function login(app: FastifyInstance, query = '') {
  const { state, oauthCookie } = await startLogin(app, query);
  const res = await app.inject({
    url: `/auth/discord/callback?code=abc&state=${state}&iss=${encodeURIComponent('https://discord.com')}`,
    cookies: { en_oauth: oauthCookie },
  });
  const session = res.cookies.find((c) => c.name === 'en_session' && c.value !== '');
  return { res, location: res.headers.location as string, session: session?.value };
}
