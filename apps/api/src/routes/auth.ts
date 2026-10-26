import { type FastifyInstance } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ALL_PERMISSIONS, can } from '@enrp/permissions';
import {
  createPkcePair,
  loadSubject,
  randomToken,
  recordSecurityEvent,
  sha256Hex,
  verification,
  writeAudit,
  hashIp,
} from '@enrp/core';
import { adminSessions, and, desc, discordUsers, eq, gt, isNull } from '@enrp/database';
import { type AppError } from '@enrp/shared';
import { memberRoles, requireAuthenticated, SESSION_COOKIE } from '../plugins/auth';

const OAUTH_COOKIE = 'enrp_oauth';
const SESSION_TTL_MS = 12 * 3600_000;

/** Nur relative Pfade innerhalb des Dashboards zulassen (Schutz gegen Open Redirects). */
export function safeRedirectPath(input: unknown): string {
  if (
    typeof input !== 'string' ||
    !input.startsWith('/') ||
    input.startsWith('//') ||
    input.includes('\\') ||
    input.length > 200
  )
    return '/';
  return input;
}

export async function authRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const { env, core, oauth } = app.deps;
  const secure = env.COOKIE_SECURE ?? env.APP_ENV !== 'development';
  const redirectUri = `${env.PUBLIC_URL}/api/v1/auth/discord/callback`;
  const dashboard = (path: string) => `${env.DASHBOARD_URL.replace(/\/$/, '')}${path}`;

  app.get(
    '/auth/discord/login',
    {
      schema: {
        tags: ['Authentifizierung'],
        summary: 'Dashboard-Login über Discord starten',
        querystring: z.object({ redirect: z.string().optional() }),
      },
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      if (!oauth.discord.configured) return reply.redirect(dashboard('/login?error=nicht_konfiguriert'));
      const binding = randomToken(24);
      const pkce = createPkcePair();
      const { state } = await verification.createOAuthState(core.db, core.now(), {
        purpose: 'dashboard_login',
        codeVerifier: pkce.verifier,
        redirectPath: safeRedirectPath(request.query.redirect),
        browserBinding: binding,
      });
      reply.setCookie(OAUTH_COOKIE, binding, {
        httpOnly: true,
        secure,
        sameSite: 'lax',
        path: '/api/v1/auth',
        maxAge: 600,
      });
      return reply.redirect(oauth.discord.authorizeUrl({ state, challenge: pkce.challenge, redirectUri }));
    },
  );

  app.get(
    '/auth/discord/callback',
    {
      schema: {
        tags: ['Authentifizierung'],
        summary: 'OAuth-Callback von Discord',
        querystring: z.object({
          code: z.string().max(200).optional(),
          state: z.string().max(200).optional(),
          error: z.string().max(100).optional(),
        }),
      },
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const fail = (reason: string) => reply.redirect(dashboard(`/login?error=${encodeURIComponent(reason)}`));
      if (request.query.error) return fail('abgebrochen');
      let row;
      try {
        row = await verification.consumeOAuthState(
          core.db,
          core.now(),
          'dashboard_login',
          request.query.state,
          request.cookies[OAUTH_COOKIE],
        );
      } catch (err) {
        await recordSecurityEvent(core.db, core.config.hashSecret, {
          type: 'auth.oauth_state_invalid',
          ip: request.ip,
          details: { code: (err as AppError).code },
        });
        return fail('ungueltig');
      }
      reply.clearCookie(OAUTH_COOKIE, { path: '/api/v1/auth' });
      if (!request.query.code) return fail('ungueltig');
      const accessToken = await oauth.discord.exchange({
        code: request.query.code,
        verifier: row.codeVerifier,
        redirectUri,
      });
      const user = await oauth.discord.fetchUser(accessToken);
      await oauth.discord.revoke(accessToken);
      await verification.upsertDiscordUser(core.db, user, core.now());

      const roles = await memberRoles(app, user.id, true);
      const subject = await loadSubject(core.db, core.config, user.id, roles.roleIds);
      if (!subject.isOwner && subject.grants.length === 0) {
        await recordSecurityEvent(core.db, core.config.hashSecret, {
          type: 'auth.login_denied',
          actorId: user.id,
          ip: request.ip,
          severity: 'info',
        });
        return fail('kein_zugriff');
      }
      const token = randomToken(32);
      const now = core.now();
      const [session] = await core.db
        .insert(adminSessions)
        .values({
          tokenHash: sha256Hex(token),
          csrfToken: randomToken(24),
          discordUserId: user.id,
          ipHash: hashIp(core.config.hashSecret, request.ip),
          userAgent: (request.headers['user-agent'] ?? '').slice(0, 300),
          expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
          lastSeenAt: now,
        })
        .returning();
      await writeAudit(
        core.db,
        { kind: 'user', discordUserId: user.id, roleIds: roles.roleIds, via: 'dashboard', subject },
        { action: 'auth.login', resourceType: 'session', resourceId: session!.id },
        now,
      );
      reply.setCookie(SESSION_COOKIE, token, { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: 7 * 86400 });
      return reply.redirect(dashboard(row.redirectPath ?? '/'));
    },
  );

  app.post('/auth/logout', { schema: { tags: ['Authentifizierung'], summary: 'Abmelden' } }, async (request, reply) => {
    if (request.session) {
      await core.db
        .update(adminSessions)
        .set({ revokedAt: core.now(), revokedBy: request.session.discordUserId })
        .where(eq(adminSessions.id, request.session.id));
      await writeAudit(
        core.db,
        request.actor,
        { action: 'auth.logout', resourceType: 'session', resourceId: request.session.id },
        core.now(),
      );
    }
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get(
    '/auth/me',
    { schema: { tags: ['Authentifizierung'], summary: 'Aktuelle Person, Rechte und CSRF-Token' } },
    async (request) => {
      requireAuthenticated(request);
      const actor = request.actor as Extract<typeof request.actor, { kind: 'user' }>;
      const [profile] = await core.db.select().from(discordUsers).where(eq(discordUsers.id, actor.discordUserId));
      return {
        user: {
          id: actor.discordUserId,
          username: profile?.username ?? actor.discordUserId,
          globalName: profile?.globalName ?? null,
          avatarHash: profile?.avatarHash ?? null,
        },
        isOwner: actor.subject.isOwner,
        roles:
          (actor.subject as { roles?: Array<{ key: string; name: string }> }).roles?.map((r) => ({
            key: r.key,
            name: r.name,
          })) ?? [],
        permissions: ALL_PERMISSIONS.filter((p) => can(actor.subject, p)),
        scopedGrants: actor.subject.grants.filter((g) => g.factionIds?.length),
        csrfToken: request.session?.csrfToken ?? null,
        sessionExpiresAt: request.session?.expiresAt ?? null,
      };
    },
  );

  app.get(
    '/auth/sessions',
    { schema: { tags: ['Authentifizierung'], summary: 'Eigene aktive Sitzungen' } },
    async (request) => {
      requireAuthenticated(request);
      const actor = request.actor as Extract<typeof request.actor, { kind: 'user' }>;
      const rows = await core.db
        .select({
          id: adminSessions.id,
          createdAt: adminSessions.createdAt,
          lastSeenAt: adminSessions.lastSeenAt,
          expiresAt: adminSessions.expiresAt,
          userAgent: adminSessions.userAgent,
        })
        .from(adminSessions)
        .where(
          and(
            eq(adminSessions.discordUserId, actor.discordUserId),
            isNull(adminSessions.revokedAt),
            gt(adminSessions.expiresAt, core.now()),
          ),
        )
        .orderBy(desc(adminSessions.lastSeenAt));
      return { items: rows.map((r) => ({ ...r, current: r.id === request.session?.id })) };
    },
  );
}
