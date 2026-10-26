import { buildApp } from '@enrp/api/app';
import { apiEnvSchema } from '@enrp/api/env';
import { Metrics } from '@enrp/api/metrics';
import { createOAuthClients } from '@enrp/api/oauth';
import { RealtimeHub } from '@enrp/integrations';
import { createTestContext, db, type TestContext } from './helpers';

export const BOT_TOKEN = 'test-bot-token-0123456789abcdefghijklmnop';

/** Fetch-Attrappe für Discord- und Roblox-OAuth. */
export function fakeOAuthFetch(identity: { discordId: string; robloxId: number; robloxName: string }) {
  const calls: string[] = [];
  const impl = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (url.endsWith('/oauth2/token') || url.endsWith('/oauth/v1/token')) {
      const body = new URLSearchParams(String(init?.body));
      if (!body.get('code_verifier')) return json({ error: 'invalid_grant' }, 400);
      return json({ access_token: `at-${body.get('code')}` });
    }
    if (url.endsWith('/users/@me')) return json({ id: identity.discordId, username: 'tester', global_name: 'Tester', avatar: null });
    if (url.endsWith('/oauth/v1/userinfo')) return json({ sub: String(identity.robloxId), preferred_username: identity.robloxName, name: identity.robloxName, created_at: 1500000000 });
    if (url.includes('/revoke')) return new Response(null, { status: 200 });
    return json({}, 404);
  }) as typeof fetch;
  return { impl, calls };
}

export async function createTestApp(ctx: TestContext = createTestContext(), oauthFetch?: typeof fetch) {
  const env = apiEnvSchema.parse({
    DATABASE_URL: process.env.TEST_DATABASE_URL,
    BOT_API_TOKEN: BOT_TOKEN,
    HASH_SECRET: ctx.config.hashSecret,
    OWNER_DISCORD_IDS: ctx.config.ownerDiscordIds.join(','),
    PUBLIC_URL: 'http://localhost:3000',
    DASHBOARD_URL: 'http://localhost:3000',
    DISCORD_CLIENT_ID: 'cid',
    DISCORD_CLIENT_SECRET: 'csecret',
    ROBLOX_CLIENT_ID: 'rid',
    ROBLOX_CLIENT_SECRET: 'rsecret',
    LOG_LEVEL: 'silent',
    METRICS_TOKEN: 'metrics-token',
  });
  const realtime = new RealtimeHub();
  ctx.realtime = realtime;
  const deps = {
    env,
    database: db(),
    core: ctx,
    realtime,
    metrics: new Metrics(),
    oauth: createOAuthClients({ discordClientId: 'cid', discordClientSecret: 'csecret', robloxClientId: 'rid', robloxClientSecret: 'rsecret' }, oauthFetch),
  };
  const app = await buildApp(deps, { logger: false });
  return { app, ctx, deps };
}

export const botHeaders = (actorId?: string, roles: string[] = []) => ({
  authorization: `Bearer ${BOT_TOKEN}`,
  ...(actorId ? { 'x-actor-id': actorId, 'x-actor-roles': roles.join(',') } : {}),
});

export function cookiesOf(res: { cookies: Array<{ name: string; value: string }> }) {
  return Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
}
