import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { writeAudit } from '../audit.js';
import { cookieOptions } from '../auth/cookies.js';
import { DiscordError, type DiscordOAuth } from '../auth/discord.js';
import { authenticate, requireAuth } from '../auth/guards.js';
import { createSession, deleteSession } from '../auth/sessions.js';
import { pkceChallenge, randomToken, safeEqual } from '../auth/tokens.js';
import { users } from '../db/schema.js';

/** Fehlercodes, die die Anmeldeseite des Dashboards verständlich anzeigt. */
export type LoginError =
  | 'not_configured'
  | 'cancelled'
  | 'state_mismatch'
  | 'discord_unavailable'
  | 'login_failed'
  | 'not_registered'
  | 'account_disabled';

const OAUTH_COOKIE_MAX_AGE_S = 10 * 60;
// Anmelde-Endpunkte sind ein beliebtes Ziel für automatisierte Versuche: strengeres Limit.
const authRateLimit = { rateLimit: { max: 20, timeWindow: 60_000 } };

const oauthCookieSchema = z.object({
  s: z.string().min(43), // state
  v: z.string().min(43), // PKCE code_verifier
  r: z.string(), // Rücksprungpfad im Dashboard
  t: z.number().int(), // Ausstellungszeit (ms)
});

const callbackQuery = z.object({
  code: z.string().min(1).max(512).optional(),
  state: z.string().min(1).max(512).optional(),
  error: z.string().max(128).optional(),
  iss: z.string().max(256).optional(),
});

/**
 * Nur Pfade innerhalb des Dashboards sind als Rücksprungziel erlaubt (Schutz vor "Open Redirect").
 * Erlaubt: "/servers?x=1". Abgelehnt: "https://…", "//…", "/\…", Steuerzeichen, "/login".
 */
export function safeReturnPath(value: unknown): string {
  if (typeof value !== 'string' || value.length > 512) return '/';
  if (!/^\/(?![/\\])[^\s\\]*$/.test(value)) return '/';
  if (value === '/login' || value.startsWith('/login?') || value.startsWith('/api/')) return '/';
  return value;
}

export interface AuthRouteOptions {
  discord: DiscordOAuth | null;
}

export async function authRoutes(app: FastifyInstance, options: AuthRouteOptions): Promise<void> {
  const { discord } = options;
  const cookies = app.cookieSettings;
  const dashboard = app.appConfig.dashboardOrigin;
  const redirectUri = `${dashboard}/api/auth/discord/callback`;

  const toLogin = (reply: FastifyReply, error: LoginError) =>
    reply.redirect(`${dashboard}/login?error=${error}`, 302);

  app.get('/auth/status', async () => ({ discordLogin: discord ? 'configured' : 'not_configured' }));

  app.get('/auth/discord/login', { config: authRateLimit }, async (request, reply) => {
    if (!discord) return toLogin(reply, 'not_configured');
    const state = randomToken();
    const verifier = randomToken();
    const returnTo = safeReturnPath((request.query as Record<string, unknown>).returnTo);
    const payload = Buffer.from(
      JSON.stringify({ s: state, v: verifier, r: returnTo, t: app.clock().getTime() }),
    ).toString('base64url');
    reply.setCookie(cookies.oauth, payload, cookieOptions(cookies, OAUTH_COOKIE_MAX_AGE_S));
    return reply.redirect(
      discord.authorizeUrl({ state, codeChallenge: pkceChallenge(verifier), redirectUri }),
      302,
    );
  });

  app.get('/auth/discord/callback', { config: authRateLimit }, async (request, reply) => {
    // Das Cookie gilt genau für einen Versuch und wird in jedem Fall entfernt.
    const rawCookie = request.cookies[cookies.oauth];
    reply.clearCookie(cookies.oauth, cookieOptions(cookies));
    if (!discord) return toLogin(reply, 'not_configured');

    const query = callbackQuery.safeParse(request.query);
    if (!query.success) return toLogin(reply, 'login_failed');
    if (query.data.error)
      return toLogin(reply, query.data.error === 'access_denied' ? 'cancelled' : 'login_failed');

    const flow = parseOAuthCookie(rawCookie);
    const now = app.clock().getTime();
    const stateOk =
      flow !== null &&
      query.data.state !== undefined &&
      safeEqual(flow.s, query.data.state) &&
      now - flow.t >= 0 &&
      now - flow.t <= OAUTH_COOKIE_MAX_AGE_S * 1000;
    // RFC 9207: Discord nennt sich in der Weiterleitung selbst; ein anderer Absender wird abgelehnt.
    const issuerOk = query.data.iss === undefined || query.data.iss === discord.issuer;
    if (!stateOk || !issuerOk || !query.data.code || !flow) {
      request.log.warn({ stateOk, issuerOk }, 'Discord-Rückmeldung passt nicht zum Anmeldeversuch');
      return toLogin(reply, 'state_mismatch');
    }

    let identity;
    try {
      const accessToken = await discord.exchangeCode({
        code: query.data.code,
        codeVerifier: flow.v,
        redirectUri,
      });
      identity = await discord.fetchIdentity(accessToken);
      // Das Token wird nicht gespeichert und sofort widerrufen; ein Fehlschlag verhindert die Anmeldung nicht.
      discord
        .revokeToken(accessToken)
        .catch((err: unknown) => request.log.warn({ err }, 'Token-Widerruf fehlgeschlagen'));
    } catch (err) {
      if (err instanceof DiscordError) {
        request.log.warn({ kind: err.kind, msg: err.message }, 'Discord-Anmeldung fehlgeschlagen');
        return toLogin(reply, err.kind === 'unavailable' ? 'discord_unavailable' : 'login_failed');
      }
      throw err;
    }

    const db = app.db.db;
    const [user] = await db
      .select({ id: users.id, status: users.status, displayName: users.displayName })
      .from(users)
      .where(eq(users.discordUserId, identity.id))
      .limit(1);

    if (!user) {
      // Zugang nur für freigeschaltete Personen. Gespeichert wird nur die Discord-ID des Versuchs.
      await writeAudit(db, {
        actor: { type: 'system', label: 'Discord-Anmeldung' },
        action: 'auth.login_denied',
        outcome: 'denied',
        target: { type: 'discord_user', id: identity.id },
        details: { reason: 'not_registered' },
        requestId: request.id,
      });
      return toLogin(reply, 'not_registered');
    }
    if (user.status !== 'active') {
      await writeAudit(db, {
        actor: { type: 'user', userId: user.id, label: user.displayName },
        action: 'auth.login_denied',
        outcome: 'denied',
        target: { type: 'user', id: user.id },
        details: { reason: 'disabled' },
        requestId: request.id,
      });
      return toLogin(reply, 'account_disabled');
    }

    const displayName = (identity.globalName ?? identity.username).trim().slice(0, 64) || user.displayName;
    const loginAt = app.clock();
    const session = await db.transaction(async (tx) => {
      await tx.update(users).set({ displayName, lastLoginAt: loginAt }).where(eq(users.id, user.id));
      await writeAudit(tx, {
        actor: { type: 'user', userId: user.id, label: displayName },
        action: 'auth.login',
        outcome: 'success',
        target: { type: 'user', id: user.id },
        requestId: request.id,
      });
      return createSession(tx, user.id, loginAt, app.appConfig.session);
    });

    reply.setCookie(
      cookies.session,
      session.token,
      cookieOptions(cookies, app.appConfig.session.maxHours * 3600),
    );
    return reply.redirect(`${dashboard}${flow.r}`, 302);
  });

  app.get('/auth/me', { preHandler: requireAuth }, async (request) => ({ user: request.auth?.user }));

  app.post('/auth/logout', { config: authRateLimit }, async (request: FastifyRequest, reply) => {
    const auth = await authenticate(request);
    if (auth) {
      await deleteSession(app.db.db, auth.sessionId);
      await writeAudit(app.db.db, {
        actor: { type: 'user', userId: auth.user.id, label: auth.user.displayName },
        action: 'auth.logout',
        outcome: 'success',
        requestId: request.id,
      });
    }
    reply.clearCookie(cookies.session, cookieOptions(cookies));
    return reply.status(204).send();
  });
}

function parseOAuthCookie(value: string | undefined): z.infer<typeof oauthCookieSchema> | null {
  if (!value || value.length > 2048) return null;
  try {
    const parsed = oauthCookieSchema.safeParse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
    if (!parsed.success) return null;
    return { ...parsed.data, r: safeReturnPath(parsed.data.r) };
  } catch {
    return null;
  }
}
