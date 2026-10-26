import { AppError } from '@enrp/shared';

export interface DiscordIdentity {
  id: string;
  username: string;
  globalName: string | null;
  avatarHash: string | null;
}

export interface RobloxUserInfo {
  id: number;
  username: string;
  displayName: string | null;
  accountCreatedAt: Date | null;
}

export interface OAuthClients {
  discord: {
    configured: boolean;
    authorizeUrl(input: { state: string; challenge: string; redirectUri: string }): string;
    exchange(input: { code: string; verifier: string; redirectUri: string }): Promise<string>;
    fetchUser(accessToken: string): Promise<DiscordIdentity>;
    revoke(accessToken: string): Promise<void>;
  };
  roblox: {
    configured: boolean;
    authorizeUrl(input: { state: string; challenge: string; redirectUri: string }): string;
    exchange(input: { code: string; verifier: string; redirectUri: string }): Promise<string>;
    fetchUser(accessToken: string): Promise<RobloxUserInfo>;
    revoke(accessToken: string): Promise<void>;
  };
}

async function postForm(fetchImpl: typeof fetch, url: string, form: Record<string, string>, headers: Record<string, string> = {}) {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', ...headers },
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, data };
}

async function getJson(fetchImpl: typeof fetch, url: string, accessToken: string) {
  const res = await fetchImpl(url, { headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new AppError('UPSTREAM_UNAVAILABLE', `Profil konnte nicht geladen werden (${res.status}).`);
  return (await res.json()) as Record<string, unknown>;
}

/**
 * OAuth-Clients für Discord (Dashboard-Login, Identitätsbestätigung bei /verify) und Roblox (Verifizierung).
 * Beide verwenden Authorization Code Flow mit PKCE (S256) und state. Tokens werden nach dem Profilabruf
 * widerrufen und nie gespeichert.
 */
export function createOAuthClients(
  config: { discordClientId?: string; discordClientSecret?: string; robloxClientId?: string; robloxClientSecret?: string },
  fetchImpl: typeof fetch = fetch,
): OAuthClients {
  const discordAuth = config.discordClientId && config.discordClientSecret ? `Basic ${Buffer.from(`${config.discordClientId}:${config.discordClientSecret}`).toString('base64')}` : '';
  return {
    discord: {
      configured: Boolean(discordAuth),
      authorizeUrl({ state, challenge, redirectUri }) {
        const url = new URL('https://discord.com/oauth2/authorize');
        url.search = new URLSearchParams({
          response_type: 'code',
          client_id: config.discordClientId ?? '',
          scope: 'identify',
          state,
          redirect_uri: redirectUri,
          code_challenge: challenge,
          code_challenge_method: 'S256',
          prompt: 'none',
        }).toString();
        return url.toString();
      },
      async exchange({ code, verifier, redirectUri }) {
        const r = await postForm(fetchImpl, 'https://discord.com/api/oauth2/token', { grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier }, { authorization: discordAuth });
        if (!r.ok || typeof r.data.access_token !== 'string') throw new AppError('UPSTREAM_UNAVAILABLE', 'Discord-Anmeldung fehlgeschlagen.');
        return r.data.access_token;
      },
      async fetchUser(accessToken) {
        const u = await getJson(fetchImpl, 'https://discord.com/api/v10/users/@me', accessToken);
        return { id: String(u.id), username: String(u.username), globalName: (u.global_name as string | null) ?? null, avatarHash: (u.avatar as string | null) ?? null };
      },
      async revoke(accessToken) {
        await postForm(fetchImpl, 'https://discord.com/api/oauth2/token/revoke', { token: accessToken, token_type_hint: 'access_token' }, { authorization: discordAuth }).catch(() => undefined);
      },
    },
    roblox: {
      configured: Boolean(config.robloxClientId && config.robloxClientSecret),
      authorizeUrl({ state, challenge, redirectUri }) {
        const url = new URL('https://apis.roblox.com/oauth/v1/authorize');
        url.search = new URLSearchParams({
          client_id: config.robloxClientId ?? '',
          redirect_uri: redirectUri,
          // Nur die nötigen Scopes: openid (User-ID) und profile (Benutzername, Anzeigename).
          scope: 'openid profile',
          response_type: 'code',
          state,
          code_challenge: challenge,
          code_challenge_method: 'S256',
        }).toString();
        return url.toString();
      },
      async exchange({ code, verifier, redirectUri }) {
        const r = await postForm(fetchImpl, 'https://apis.roblox.com/oauth/v1/token', {
          grant_type: 'authorization_code',
          code,
          code_verifier: verifier,
          redirect_uri: redirectUri,
          client_id: config.robloxClientId ?? '',
          client_secret: config.robloxClientSecret ?? '',
        });
        if (!r.ok || typeof r.data.access_token !== 'string') throw new AppError('UPSTREAM_UNAVAILABLE', 'Roblox-Anmeldung fehlgeschlagen.');
        return r.data.access_token;
      },
      async fetchUser(accessToken) {
        const u = await getJson(fetchImpl, 'https://apis.roblox.com/oauth/v1/userinfo', accessToken);
        const id = Number(u.sub);
        if (!Number.isSafeInteger(id) || id <= 0) throw new AppError('UPSTREAM_UNAVAILABLE', 'Ungültige Roblox-Antwort.');
        return {
          id,
          username: String(u.preferred_username ?? u.nickname ?? id),
          displayName: (u.name as string | undefined) ?? null,
          accountCreatedAt: typeof u.created_at === 'number' ? new Date(u.created_at * 1000) : null,
        };
      },
      async revoke(accessToken) {
        await postForm(fetchImpl, 'https://apis.roblox.com/oauth/v1/token/revoke', {
          token: accessToken,
          client_id: config.robloxClientId ?? '',
          client_secret: config.robloxClientSecret ?? '',
        }).catch(() => undefined);
      },
    },
  };
}
