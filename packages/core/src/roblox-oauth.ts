import { z } from 'zod';

/**
 * Client für Roblox OAuth 2.0 (Authorization Code Flow mit PKCE).
 * Endpunkte laut offizieller Doku bzw. Discovery-Dokument
 * https://apis.roblox.com/oauth/.well-known/openid-configuration (geprüft 2026-10):
 *   authorize  https://apis.roblox.com/oauth/v1/authorize
 *   token      https://apis.roblox.com/oauth/v1/token
 *   userinfo   https://apis.roblox.com/oauth/v1/userinfo
 *   revoke     https://apis.roblox.com/oauth/v1/token/revoke
 */
export const ROBLOX_OAUTH_BASE_URL = 'https://apis.roblox.com/oauth';
export const VERIFICATION_SCOPES = ['openid', 'profile'] as const;

export interface RobloxOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** Nur in Tests überschreibbar (Mock-Server). */
  baseUrl?: string;
  timeoutMs?: number;
}

export class RobloxOAuthError extends Error {
  constructor(
    readonly kind: 'token_exchange' | 'userinfo' | 'network',
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'RobloxOAuthError';
  }
}

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().regex(/^bearer$/i),
  expires_in: z.number().optional(),
  refresh_token: z.string().optional(),
  id_token: z.string().optional(),
  scope: z.string().optional(),
});
export type RobloxTokenResponse = z.infer<typeof tokenResponseSchema>;

const userInfoSchema = z.object({
  // sub ist die unveränderliche Roblox-User-ID und der einzige Identifikator, den wir verwenden.
  sub: z.string().regex(/^[1-9][0-9]{0,18}$/),
  name: z.string().optional().nullable(),
  nickname: z.string().optional().nullable(),
  preferred_username: z.string().optional().nullable(),
  created_at: z.number().optional().nullable(),
  profile: z.string().optional().nullable(),
  picture: z.string().optional().nullable(),
});
export type RobloxUserInfo = z.infer<typeof userInfoSchema>;

export class RobloxOAuthClient {
  private readonly base: string;
  private readonly timeoutMs: number;

  constructor(private readonly cfg: RobloxOAuthConfig) {
    this.base = (cfg.baseUrl ?? ROBLOX_OAUTH_BASE_URL).replace(/\/$/, '');
    this.timeoutMs = cfg.timeoutMs ?? 10_000;
  }

  buildAuthorizeUrl(params: { state: string; codeChallenge: string }): string {
    const url = new URL(`${this.base}/v1/authorize`);
    url.searchParams.set('client_id', this.cfg.clientId);
    url.searchParams.set('redirect_uri', this.cfg.redirectUri);
    url.searchParams.set('scope', VERIFICATION_SCOPES.join(' '));
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('state', params.state);
    url.searchParams.set('code_challenge', params.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    // URLSearchParams kodiert Leerzeichen als "+"; %20 ist für den scope-Parameter eindeutiger.
    return url.toString().replace(/\+/g, '%20');
  }

  async exchangeCode(code: string, codeVerifier: string): Promise<RobloxTokenResponse> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: codeVerifier,
      redirect_uri: this.cfg.redirectUri,
      ...this.clientAuth(),
    });
    const res = await this.request(`${this.base}/v1/token`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body,
    }, 'token_exchange');
    if (!res.ok) throw new RobloxOAuthError('token_exchange', `Token-Endpunkt antwortete mit ${res.status}`, res.status);
    const parsed = tokenResponseSchema.safeParse(await res.json().catch(() => null));
    if (!parsed.success) throw new RobloxOAuthError('token_exchange', 'Ungültige Token-Antwort');
    return parsed.data;
  }

  async fetchUserInfo(accessToken: string): Promise<RobloxUserInfo> {
    const res = await this.request(`${this.base}/v1/userinfo`, {
      headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
    }, 'userinfo');
    if (!res.ok) throw new RobloxOAuthError('userinfo', `Userinfo-Endpunkt antwortete mit ${res.status}`, res.status);
    const parsed = userInfoSchema.safeParse(await res.json().catch(() => null));
    if (!parsed.success) throw new RobloxOAuthError('userinfo', 'Ungültige Userinfo-Antwort');
    return parsed.data;
  }

  /** Widerruft ein Refresh-Token. Fehler werden geschluckt (best effort), da wir Tokens ohnehin verwerfen. */
  async revokeRefreshToken(token: string): Promise<boolean> {
    try {
      const res = await this.request(`${this.base}/v1/token/revoke`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token, ...this.clientAuth() }),
      }, 'network');
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Client-Authentifizierung per Body (client_secret_post), laut Discovery-Dokument unterstützt. */
  private clientAuth(): Record<string, string> {
    return { client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret };
  }

  private async request(url: string, init: RequestInit, kind: RobloxOAuthError['kind']): Promise<Response> {
    try {
      return await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (err) {
      throw new RobloxOAuthError(kind, `Netzwerkfehler: ${(err as Error).name}`);
    }
  }
}
