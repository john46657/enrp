import { describe, expect, it } from 'vitest';
import { DiscordError, createDiscordOAuth } from '../src/auth/discord.js';

const CONFIG = {
  clientId: '222222222222222222',
  clientSecret: 'test-secret-0123456789',
  baseUrl: 'https://discord.com',
};

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

/** Ersetzt fetch: zeichnet Anfragen auf und antwortet mit vorgegebenen Antworten. */
function fakeFetch(...responses: (Response | Error)[]) {
  const requests: Recorded[] = [];
  const impl: typeof fetch = async (input, init) => {
    requests.push({
      url: String(input),
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: typeof init?.body === 'string' ? init.body : '',
    });
    const next = responses.shift();
    if (!next) throw new Error('Keine Antwort vorbereitet');
    if (next instanceof Error) throw next;
    return next;
  };
  return { impl, requests };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('Discord OAuth2', () => {
  it('baut die Autorisierungs-URL laut Dokumentation (nur Scope "identify", PKCE S256)', () => {
    const url = new URL(
      createDiscordOAuth(CONFIG).authorizeUrl({
        state: 's'.repeat(43),
        codeChallenge: 'c'.repeat(43),
        redirectUri: 'http://127.0.0.1:3000/api/auth/discord/callback',
      }),
    );
    expect(url.origin + url.pathname).toBe('https://discord.com/oauth2/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: CONFIG.clientId,
      scope: 'identify',
      state: 's'.repeat(43),
      redirect_uri: 'http://127.0.0.1:3000/api/auth/discord/callback',
      code_challenge: 'c'.repeat(43),
      code_challenge_method: 'S256',
    });
  });

  it('löst den Code mit Formular-Daten, Basic-Auth und code_verifier ein', async () => {
    const { impl, requests } = fakeFetch(
      json({ access_token: 'tok', token_type: 'Bearer', expires_in: 604800 }),
    );
    const token = await createDiscordOAuth(CONFIG, impl).exchangeCode({
      code: 'code-1',
      codeVerifier: 'v'.repeat(43),
      redirectUri: 'http://127.0.0.1:3000/api/auth/discord/callback',
    });
    expect(token).toBe('tok');
    const [req] = requests;
    expect(req).toMatchObject({ url: 'https://discord.com/api/v10/oauth2/token', method: 'POST' });
    expect(req?.headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(req?.headers.authorization).toBe(
      `Basic ${Buffer.from(`${CONFIG.clientId}:${CONFIG.clientSecret}`).toString('base64')}`,
    );
    expect(Object.fromEntries(new URLSearchParams(req?.body))).toEqual({
      grant_type: 'authorization_code',
      code: 'code-1',
      redirect_uri: 'http://127.0.0.1:3000/api/auth/discord/callback',
      code_verifier: 'v'.repeat(43),
    });
  });

  it('liest das Profil über GET /users/@me mit Bearer-Token', async () => {
    const { impl, requests } = fakeFetch(
      json({
        id: '111111111111111111',
        username: 'alice',
        global_name: 'Alice',
        avatar: null,
        discriminator: '0',
      }),
    );
    const identity = await createDiscordOAuth(CONFIG, impl).fetchIdentity('tok');
    expect(identity).toEqual({ id: '111111111111111111', username: 'alice', globalName: 'Alice' });
    expect(requests[0]).toMatchObject({ url: 'https://discord.com/api/v10/users/@me', method: 'GET' });
    expect(requests[0]?.headers.authorization).toBe('Bearer tok');
  });

  it('widerruft das Token über den Revocation-Endpunkt', async () => {
    const { impl, requests } = fakeFetch(new Response(null, { status: 200 }));
    await createDiscordOAuth(CONFIG, impl).revokeToken('tok');
    expect(requests[0]).toMatchObject({
      url: 'https://discord.com/api/v10/oauth2/token/revoke',
      method: 'POST',
    });
    expect(Object.fromEntries(new URLSearchParams(requests[0]?.body))).toEqual({
      token: 'tok',
      token_type_hint: 'access_token',
    });
  });

  it.each([
    ['Netzwerkfehler', new TypeError('fetch failed'), 'unavailable'],
    ['HTTP 500', json({}, 500), 'unavailable'],
    ['HTTP 429 (Discord-Rate-Limit)', json({}, 429), 'unavailable'],
    ['HTTP 400 (ungültiger Code)', json({ error: 'invalid_grant' }, 400), 'rejected'],
    ['kein JSON', new Response('<html>', { status: 200 }), 'invalid_response'],
    ['falscher Token-Typ', json({ access_token: 'x', token_type: 'mac' }), 'invalid_response'],
  ] as const)('ordnet %s als "%s" ein', async (_name, response, kind) => {
    const { impl } = fakeFetch(response);
    const error = await createDiscordOAuth(CONFIG, impl)
      .exchangeCode({ code: 'c', codeVerifier: 'v', redirectUri: 'r' })
      .catch((err: unknown) => err);
    expect(error).toBeInstanceOf(DiscordError);
    expect((error as DiscordError).kind).toBe(kind);
    expect((error as Error).message).not.toContain(CONFIG.clientSecret);
  });

  it('lehnt Profildaten ohne gültige Discord-ID ab', async () => {
    const { impl } = fakeFetch(json({ id: '42', username: 'x' }));
    await expect(createDiscordOAuth(CONFIG, impl).fetchIdentity('tok')).rejects.toMatchObject({
      kind: 'invalid_response',
    });
  });
});
