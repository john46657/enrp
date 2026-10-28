import { type FastifyInstance } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { createPkcePair, randomToken, recordSecurityEvent, requirePermission, verification } from '@enrp/core';
import { AppError, errors } from '@enrp/shared';
import { resultPage, RESULT_PAGE_CSP } from '../lib/html';
import { requireAuthenticated } from '../plugins/auth';
import { paginationQuery, reason, snowflake } from './schemas';

const BIND_COOKIE = 'enrp_vbind';

export async function verificationRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const { env, core, oauth } = app.deps;
  const secure = env.COOKIE_SECURE ?? env.APP_ENV !== 'development';
  const discordRedirect = `${env.PUBLIC_URL}/api/v1/verification/discord/callback`;
  const robloxRedirect = `${env.PUBLIC_URL}/api/v1/verification/roblox/callback`;
  const tags = ['Verifizierung'];
  const page = (
    reply: {
      header: (k: string, v: string) => unknown;
      type: (t: string) => unknown;
      status: (n: number) => { send: (b: string) => unknown };
    },
    status: number,
    title: string,
    message: string,
    success = false,
  ) => {
    reply.header('content-security-policy', RESULT_PAGE_CSP);
    reply.type('text/html; charset=utf-8');
    return reply.status(status).send(resultPage({ title, message, success }));
  };

  app.post(
    '/verification/start',
    {
      schema: { tags, summary: '/verify – persönlichen Verifizierungslink erzeugen' },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request) => {
      requireAuthenticated(request);
      if (!oauth.discord.configured || !oauth.roblox.configured) throw errors.notConfigured('Roblox-/Discord-OAuth');
      const { state, expiresAt } = await verification.startVerification(core, request.actor);
      return { url: `${env.PUBLIC_URL}/api/v1/verification/begin?token=${encodeURIComponent(state)}`, expiresAt };
    },
  );

  // Schritt 1: Link aus Discord öffnen → Browser binden → Discord-Identität bestätigen.
  app.get(
    '/verification/begin',
    {
      schema: { tags, summary: 'Verifizierungslink öffnen', querystring: z.object({ token: z.string().max(200) }) },
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      try {
        const start = await verification.consumeOAuthState(core.db, core.now(), 'verify_start', request.query.token);
        const binding = randomToken(24);
        const pkce = createPkcePair();
        const { state } = await verification.createOAuthState(core.db, core.now(), {
          purpose: 'verify_discord',
          discordUserId: start.discordUserId,
          codeVerifier: pkce.verifier,
          browserBinding: binding,
        });
        reply.setCookie(BIND_COOKIE, binding, {
          httpOnly: true,
          secure,
          sameSite: 'lax',
          path: '/api/v1/verification',
          maxAge: 900,
        });
        return reply.redirect(
          oauth.discord.authorizeUrl({ state, challenge: pkce.challenge, redirectUri: discordRedirect }),
        );
      } catch (err) {
        return page(
          reply,
          410,
          'Link ungültig',
          err instanceof AppError ? err.message : 'Bitte starte die Verifizierung in Discord neu.',
        );
      }
    },
  );

  // Schritt 2: Discord bestätigt, dass dieselbe Person den Link geöffnet hat (Schutz gegen untergeschobene Links).
  app.get(
    '/verification/discord/callback',
    {
      schema: {
        tags,
        summary: 'Discord-Bestätigung (Callback)',
        querystring: z.object({
          code: z.string().max(200).optional(),
          state: z.string().max(200).optional(),
          error: z.string().max(100).optional(),
        }),
      },
    },
    async (request, reply) => {
      let row;
      try {
        row = await verification.consumeOAuthState(
          core.db,
          core.now(),
          'verify_discord',
          request.query.state,
          request.cookies[BIND_COOKIE],
        );
      } catch (err) {
        await recordSecurityEvent(core.db, core.config.hashSecret, {
          type: 'verification.state_invalid',
          ip: request.ip,
          details: { step: 'discord', code: (err as AppError).code },
        });
        return page(
          reply,
          400,
          'Verifizierung abgebrochen',
          err instanceof AppError ? err.message : 'Bitte starte die Verifizierung neu.',
        );
      }
      if (request.query.error || !request.query.code)
        return page(reply, 400, 'Verifizierung abgebrochen', 'Die Discord-Anmeldung wurde abgebrochen.');
      const token = await oauth.discord.exchange({
        code: request.query.code,
        verifier: row.codeVerifier,
        redirectUri: discordRedirect,
      });
      const user = await oauth.discord.fetchUser(token);
      await oauth.discord.revoke(token);
      if (user.id !== row.discordUserId) {
        await verification.recordVerificationFailure(
          core.db,
          row.discordUserId!,
          'Discord-Konto stimmt nicht mit dem Link überein',
        );
        await recordSecurityEvent(core.db, core.config.hashSecret, {
          type: 'verification.discord_mismatch',
          actorId: user.id,
          ip: request.ip,
          details: { expected: row.discordUserId },
        });
        return page(
          reply,
          403,
          'Falsches Discord-Konto',
          'Dieser Link gehört zu einem anderen Discord-Konto. Bitte nutze /verify mit deinem eigenen Konto.',
        );
      }
      await verification.upsertDiscordUser(core.db, user, core.now());
      const pkce = createPkcePair();
      const { state } = await verification.createOAuthState(core.db, core.now(), {
        purpose: 'roblox_verify',
        discordUserId: user.id,
        codeVerifier: pkce.verifier,
        browserBinding: request.cookies[BIND_COOKIE],
      });
      return reply.redirect(
        oauth.roblox.authorizeUrl({ state, challenge: pkce.challenge, redirectUri: robloxRedirect }),
      );
    },
  );

  // Schritt 3: Roblox-Konto über den offiziellen OAuth-Flow bestätigen und verknüpfen.
  app.get(
    '/verification/roblox/callback',
    {
      schema: {
        tags,
        summary: 'Roblox-OAuth (Callback)',
        querystring: z.object({
          code: z.string().max(500).optional(),
          state: z.string().max(200).optional(),
          error: z.string().max(100).optional(),
        }),
      },
    },
    async (request, reply) => {
      let row;
      try {
        row = await verification.consumeOAuthState(
          core.db,
          core.now(),
          'roblox_verify',
          request.query.state,
          request.cookies[BIND_COOKIE],
        );
      } catch (err) {
        await recordSecurityEvent(core.db, core.config.hashSecret, {
          type: 'verification.state_invalid',
          ip: request.ip,
          details: { step: 'roblox', code: (err as AppError).code },
        });
        return page(
          reply,
          400,
          'Verifizierung abgebrochen',
          err instanceof AppError ? err.message : 'Bitte starte die Verifizierung neu.',
        );
      }
      reply.clearCookie(BIND_COOKIE, { path: '/api/v1/verification' });
      const discordUserId = row.discordUserId!;
      if (request.query.error || !request.query.code) {
        await verification.recordVerificationFailure(core.db, discordUserId, 'Roblox-Anmeldung abgebrochen');
        return page(
          reply,
          400,
          'Verifizierung abgebrochen',
          'Die Roblox-Anmeldung wurde abgebrochen. Du kannst es mit /verify erneut versuchen.',
        );
      }
      try {
        const token = await oauth.roblox.exchange({
          code: request.query.code,
          verifier: row.codeVerifier,
          redirectUri: robloxRedirect,
        });
        const roblox = await oauth.roblox.fetchUser(token);
        await oauth.roblox.revoke(token);
        await verification.completeVerification(core, discordUserId, roblox);
        return page(
          reply,
          200,
          'Verifizierung erfolgreich',
          `Dein Discord-Konto ist jetzt mit dem Roblox-Konto „${roblox.username}“ verknüpft. Du kannst dieses Fenster schließen.`,
          true,
        );
      } catch (err) {
        const message = err instanceof AppError ? err.message : 'Unerwarteter Fehler.';
        await verification.recordVerificationFailure(core.db, discordUserId, message);
        if (!(err instanceof AppError)) request.log.error({ err }, 'Verifizierung fehlgeschlagen');
        return page(reply, err instanceof AppError ? err.statusCode : 500, 'Verifizierung fehlgeschlagen', message);
      }
    },
  );

  app.get(
    '/verification/status',
    { schema: { tags, summary: '/verify status', querystring: z.object({ discordUserId: snowflake.optional() }) } },
    async (request) => {
      requireAuthenticated(request);
      const actor = request.actor as Extract<typeof request.actor, { kind: 'user' }>;
      const target = request.query.discordUserId ?? actor.discordUserId;
      if (target !== actor.discordUserId) requirePermission(actor, 'verification:view');
      return verification.verificationStatus(core.db, target);
    },
  );

  app.post(
    '/verification/unlink',
    {
      schema: { tags, summary: '/verify unlink', body: z.object({ discordUserId: snowflake.optional(), reason }) },
      config: { idempotent: true },
    },
    async (request) => {
      requireAuthenticated(request);
      const result = await verification.unlinkAccount(core, request.actor, request.body);
      return { ok: true, linkId: result.link.id };
    },
  );

  app.get(
    '/verification/links',
    {
      schema: {
        tags,
        summary: 'Kontoverknüpfungen',
        querystring: paginationQuery.extend({ status: z.enum(['active', 'revoked']).optional() }),
      },
    },
    async (request) => {
      requirePermission(request.actor, 'verification:view');
      return verification.listLinks(core.db, request.query);
    },
  );

  app.get('/verification/attempts', { schema: { tags, summary: 'Letzte Verifizierungsversuche' } }, async (request) => {
    requirePermission(request.actor, 'verification:view');
    return { items: await verification.listVerificationAttempts(core.db, 100) };
  });
}
