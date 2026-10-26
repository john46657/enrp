import { createHash, randomBytes } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';

/**
 * Mock des Roblox-OAuth-Servers für automatisierte Tests. Bildet das dokumentierte Verhalten nach:
 * Codes sind einmalig gültig, PKCE S256 wird geprüft, Client-Credentials im Body.
 */
export interface MockUser {
  sub: string;
  preferred_username?: string;
  name?: string;
}

interface IssuedCode {
  user: MockUser;
  challenge: string;
  redirectUri: string;
  used: boolean;
}

export class RobloxOAuthMock {
  readonly app: FastifyInstance = Fastify();
  readonly clientId = '1234567890123456789';
  readonly clientSecret = 'test-client-secret-not-real-0000';
  baseUrl = '';
  private codes = new Map<string, IssuedCode>();
  private accessTokens = new Map<string, MockUser>();
  tokenRequests = 0;
  revokedTokens: string[] = [];
  /** Überschreibt das Verhalten für Fehlerfälle */
  behavior: { tokenStatus?: number; userinfoBody?: unknown; userinfoStatus?: number; tokenDelayMs?: number } = {};

  async start(): Promise<void> {
    this.app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
      done(null, Object.fromEntries(new URLSearchParams(body as string)));
    });

    this.app.post('/oauth/v1/token', async (req, reply) => {
      this.tokenRequests++;
      if (this.behavior.tokenDelayMs) await new Promise((r) => setTimeout(r, this.behavior.tokenDelayMs));
      const b = req.body as Record<string, string>;
      if (this.behavior.tokenStatus) return reply.code(this.behavior.tokenStatus).send({ error: 'server_error' });
      if (b.client_id !== this.clientId || b.client_secret !== this.clientSecret) return reply.code(401).send({ error: 'invalid_client' });
      if (b.grant_type !== 'authorization_code') return reply.code(400).send({ error: 'unsupported_grant_type' });
      const issued = this.codes.get(b.code ?? '');
      if (!issued || issued.used) return reply.code(400).send({ error: 'invalid_grant' });
      issued.used = true;
      if (b.redirect_uri !== issued.redirectUri) return reply.code(400).send({ error: 'invalid_grant' });
      const challenge = createHash('sha256').update(b.code_verifier ?? '', 'ascii').digest('base64url');
      if (challenge !== issued.challenge) return reply.code(400).send({ error: 'invalid_grant', error_description: 'pkce' });
      const access = randomBytes(16).toString('hex');
      this.accessTokens.set(access, issued.user);
      return { access_token: access, refresh_token: `rt-${access}`, token_type: 'Bearer', expires_in: 899, scope: 'openid profile' };
    });

    this.app.get('/oauth/v1/userinfo', async (req, reply) => {
      const token = req.headers.authorization?.replace(/^Bearer /, '') ?? '';
      const user = this.accessTokens.get(token);
      if (!user) return reply.code(401).send({ error: 'invalid_token' });
      if (this.behavior.userinfoStatus) return reply.code(this.behavior.userinfoStatus).send({});
      if (this.behavior.userinfoBody !== undefined) return this.behavior.userinfoBody;
      return { sub: user.sub, name: user.name ?? 'Display', nickname: user.name ?? 'Display', preferred_username: user.preferred_username ?? 'user', created_at: 1600000000, profile: `https://www.roblox.com/users/${user.sub}/profile`, picture: null };
    });

    this.app.post('/oauth/v1/token/revoke', async (req) => {
      const b = req.body as Record<string, string>;
      this.revokedTokens.push(b.token ?? '');
      return '';
    });

    const address = await this.app.listen({ host: '127.0.0.1', port: 0 });
    this.baseUrl = `${address}/oauth`;
  }

  /**
   * Simuliert die Zustimmung des Nutzers auf roblox.com: liest state/challenge aus der Autorisierungs-URL
   * und liefert die Callback-Parameter, die Roblox an die Redirect-URI anhängen würde.
   */
  approve(authorizeUrl: string, user: MockUser): { state: string; code: string } {
    const url = new URL(authorizeUrl);
    const code = randomBytes(12).toString('hex');
    this.codes.set(code, {
      user,
      challenge: url.searchParams.get('code_challenge')!,
      redirectUri: url.searchParams.get('redirect_uri')!,
      used: false,
    });
    return { state: url.searchParams.get('state')!, code };
  }

  reset(): void {
    this.codes.clear();
    this.accessTokens.clear();
    this.tokenRequests = 0;
    this.revokedTokens = [];
    this.behavior = {};
  }

  async stop(): Promise<void> {
    await this.app.close();
  }
}
