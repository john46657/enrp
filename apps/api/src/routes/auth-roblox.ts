import { z } from 'zod';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { AppError, ERROR_MESSAGES, type ErrorCode } from '@emden-network/shared';
import type { VerificationService } from '@emden-network/core';
import { resultPage } from '../html.js';

export interface AuthRouteOptions {
  verification: VerificationService;
  cookieSecure: boolean;
}

const startQuery = z.object({ t: z.string().max(200) });
const callbackQuery = z.object({
  state: z.string().max(200).optional(),
  code: z.string().max(2048).optional(),
  error: z.string().max(100).optional(),
  error_description: z.string().max(500).optional(),
});

const ERROR_TITLES: Partial<Record<ErrorCode, string>> = {
  OAUTH_DENIED: 'Anmeldung abgebrochen',
  ROBLOX_ALREADY_LINKED: 'Account bereits verknüpft',
  DISCORD_ALREADY_LINKED: 'Account bereits verknüpft',
  SESSION_EXPIRED: 'Link abgelaufen',
};

const STATUS_FOR: Partial<Record<ErrorCode, number>> = {
  INVALID_STATE: 400,
  BROWSER_MISMATCH: 400,
  SESSION_EXPIRED: 410,
  SESSION_ALREADY_USED: 409,
  ROBLOX_ALREADY_LINKED: 409,
  DISCORD_ALREADY_LINKED: 409,
  OAUTH_DENIED: 400,
  OAUTH_ERROR: 400,
  TOKEN_EXCHANGE_FAILED: 502,
  USERINFO_INVALID: 502,
  INTERNAL: 500,
};

function sendPage(reply: FastifyReply, status: number, title: string, message: string, success: boolean) {
  return reply
    .code(status)
    .header('cache-control', 'no-store')
    .header('referrer-policy', 'no-referrer')
    .type('text/html; charset=utf-8')
    .send(resultPage({ title, message, success }));
}

export async function authRobloxRoutes(app: FastifyInstance, opts: AuthRouteOptions) {
  const cookieName = opts.cookieSecure ? '__Host-en_oauth' : 'en_oauth';
  const cookieBase = { httpOnly: true, secure: opts.cookieSecure, sameSite: 'lax' as const, path: '/' };

  app.get('/auth/roblox/start', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const q = startQuery.safeParse(req.query);
    if (!q.success) return sendPage(reply, 400, 'Ungültiger Link', ERROR_MESSAGES.INVALID_STATE, false);
    try {
      const { authorizeUrl, browserBinding, maxAgeSeconds } = await opts.verification.beginAuthorization(q.data.t);
      reply.setCookie(cookieName, browserBinding, { ...cookieBase, maxAge: maxAgeSeconds });
      return reply.header('cache-control', 'no-store').header('referrer-policy', 'no-referrer').redirect(authorizeUrl, 302);
    } catch (err) {
      if (err instanceof AppError) return sendPage(reply, err.httpStatus, ERROR_TITLES[err.code] ?? 'Verifizierung nicht möglich', err.userMessage, false);
      throw err;
    }
  });

  app.get('/auth/roblox/callback', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const q = callbackQuery.safeParse(req.query);
    if (!q.success) return sendPage(reply, 400, 'Ungültige Anfrage', ERROR_MESSAGES.INVALID_STATE, false);
    let result;
    try {
      result = await opts.verification.handleCallback({
        state: q.data.state,
        code: q.data.code,
        error: q.data.error,
        browserBinding: req.cookies[cookieName],
      });
    } catch (err) {
      // z. B. Datenbank nicht erreichbar: verständliche Seite statt JSON, keine Interna.
      req.log.error({ err: { message: (err as Error).message } }, 'Callback fehlgeschlagen');
      return sendPage(reply, 500, 'Verifizierung fehlgeschlagen', ERROR_MESSAGES.INTERNAL, false);
    }
    reply.clearCookie(cookieName, cookieBase);
    if (result.ok) {
      const name = result.robloxUsername ? ` mit dem Roblox-Account ${result.robloxUsername}` : '';
      return sendPage(reply, 200, 'Verifizierung erfolgreich', `Dein Discord-Account wurde${name} verknüpft. Die Rolle „Verifiziert“ wird dir in wenigen Sekunden zugewiesen.`, true);
    }
    return sendPage(reply, STATUS_FOR[result.code] ?? 400, ERROR_TITLES[result.code] ?? 'Verifizierung fehlgeschlagen', ERROR_MESSAGES[result.code], false);
  });
}
