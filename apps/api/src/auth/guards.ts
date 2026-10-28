import type { Permission } from '@emden/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { HttpError } from '../errors.js';
import { resolveSession, type AuthContext } from './sessions.js';

/** Liest die Sitzung aus dem Cookie (einmal pro Anfrage) und merkt sie sich an der Anfrage. */
export async function authenticate(request: FastifyRequest): Promise<AuthContext | null> {
  if (request.auth !== undefined) return request.auth;
  const app = request.server;
  const token = request.cookies[app.cookieSettings.session];
  request.auth = token ? await resolveSession(app.db.db, token, app.clock(), app.appConfig.session) : null;
  return request.auth;
}

/** preHandler: nur angemeldete Benutzer. */
export async function requireAuth(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  if (!(await authenticate(request))) {
    throw new HttpError(401, 'UNAUTHENTICATED', 'Bitte zuerst anmelden.');
  }
}

/** preHandler: angemeldet und mit der genannten Berechtigung. Die Prüfung passiert immer auf dem Server. */
export function requirePermission(permission: Permission) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await requireAuth(request, reply);
    if (!request.auth?.user.permissions.includes(permission)) {
      throw new HttpError(403, 'FORBIDDEN', 'Für diese Aktion fehlt die Berechtigung.');
    }
  };
}

declare module 'fastify' {
  interface FastifyRequest {
    /** undefined = noch nicht geprüft, null = nicht angemeldet. */
    auth?: AuthContext | null;
  }
}
