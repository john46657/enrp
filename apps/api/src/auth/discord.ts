import { z } from 'zod';

/**
 * Discord-OAuth2 (Authorization Code Grant mit PKCE), Endpunkte laut offizieller Dokumentation
 * https://docs.discord.com/developers/topics/oauth2 und https://discord.com/.well-known/oauth-authorization-server
 * Angefragt wird nur der Scope "identify" (Discord-ID, Benutzername, Anzeigename, Avatar – keine E-Mail).
 */

export interface DiscordIdentity {
  id: string;
  username: string;
  globalName: string | null;
}

export type DiscordErrorKind = 'unavailable' | 'rejected' | 'invalid_response';

export class DiscordError extends Error {
  override name = 'DiscordError';
  constructor(
    readonly kind: DiscordErrorKind,
    message: string,
  ) {
    super(message);
  }
}

export interface DiscordOAuth {
  /** Erwarteter Wert des Parameters "iss" in der Weiterleitung (RFC 9207). */
  readonly issuer: string;
  authorizeUrl(params: { state: string; codeChallenge: string; redirectUri: string }): string;
  exchangeCode(params: { code: string; codeVerifier: string; redirectUri: string }): Promise<string>;
  fetchIdentity(accessToken: string): Promise<DiscordIdentity>;
  /** Widerruft das Token wieder – das Backend braucht es nach der Anmeldung nicht mehr. */
  revokeToken(accessToken: string): Promise<void>;
}

const TIMEOUT_MS = 10_000;

const tokenResponse = z.object({ access_token: z.string().min(1), token_type: z.string() });
const userResponse = z.object({
  id: z.string().regex(/^[0-9]{17,20}$/),
  username: z.string().min(1).max(64),
  global_name: z.string().max(64).nullish(),
});

export function createDiscordOAuth(
  config: { clientId: string; clientSecret: string; baseUrl: string },
  fetchImpl: typeof fetch = fetch,
): DiscordOAuth {
  const api = `${config.baseUrl}/api/v10`;
  const basicAuth = `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`;

  async function call(url: string, init: RequestInit): Promise<Response> {
    let res: Response;
    try {
      res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error' });
    } catch {
      throw new DiscordError(
        'unavailable',
        'Discord ist nicht erreichbar oder hat nicht rechtzeitig geantwortet.',
      );
    }
    if (res.status >= 500 || res.status === 429) {
      throw new DiscordError('unavailable', `Discord antwortet mit HTTP ${res.status}.`);
    }
    return res;
  }

  async function json(res: Response): Promise<unknown> {
    try {
      return await res.json();
    } catch {
      throw new DiscordError('invalid_response', 'Discord hat eine unlesbare Antwort geschickt.');
    }
  }

  const form = (values: Record<string, string>) => new URLSearchParams(values).toString();
  const formHeaders = { 'content-type': 'application/x-www-form-urlencoded', authorization: basicAuth };

  return {
    issuer: config.baseUrl,

    authorizeUrl({ state, codeChallenge, redirectUri }) {
      const url = new URL('/oauth2/authorize', config.baseUrl);
      url.search = new URLSearchParams({
        response_type: 'code',
        client_id: config.clientId,
        scope: 'identify',
        state,
        redirect_uri: redirectUri,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      }).toString();
      return url.toString();
    },

    async exchangeCode({ code, codeVerifier, redirectUri }) {
      const res = await call(`${api}/oauth2/token`, {
        method: 'POST',
        headers: formHeaders,
        body: form({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          code_verifier: codeVerifier,
        }),
      });
      if (!res.ok)
        throw new DiscordError('rejected', `Discord hat den Anmeldecode abgelehnt (HTTP ${res.status}).`);
      const parsed = tokenResponse.safeParse(await json(res));
      if (!parsed.success || parsed.data.token_type.toLowerCase() !== 'bearer') {
        throw new DiscordError('invalid_response', 'Unerwartete Token-Antwort von Discord.');
      }
      return parsed.data.access_token;
    },

    async fetchIdentity(accessToken) {
      const res = await call(`${api}/users/@me`, { headers: { authorization: `Bearer ${accessToken}` } });
      if (!res.ok)
        throw new DiscordError('rejected', `Discord hat die Profilabfrage abgelehnt (HTTP ${res.status}).`);
      const parsed = userResponse.safeParse(await json(res));
      if (!parsed.success) throw new DiscordError('invalid_response', 'Unerwartete Profildaten von Discord.');
      return {
        id: parsed.data.id,
        username: parsed.data.username,
        globalName: parsed.data.global_name ?? null,
      };
    },

    async revokeToken(accessToken) {
      const res = await call(`${api}/oauth2/token/revoke`, {
        method: 'POST',
        headers: formHeaders,
        body: form({ token: accessToken, token_type_hint: 'access_token' }),
      });
      if (!res.ok)
        throw new DiscordError('rejected', `Discord hat den Widerruf abgelehnt (HTTP ${res.status}).`);
    },
  };
}
