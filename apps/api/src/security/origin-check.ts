import type { FastifyInstance } from 'fastify';
import { HttpError } from '../errors.js';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Schutz gegen Cross-Site Request Forgery (CSRF): Verändernde Anfragen, die ein Browser im Auftrag einer
 * fremden Webseite schickt, werden abgelehnt. Browser senden dafür die Header Origin und Sec-Fetch-Site.
 * Anfragen ohne diese Header (Server-zu-Server, z. B. vom Dashboard-Server) sind nicht betroffen –
 * sie tragen keine fremden Browser-Cookies. Zusätzlich sind alle Cookies SameSite=Lax.
 */
export function registerOriginCheck(app: FastifyInstance, allowedOrigins: string[]): void {
  const allowed = new Set(allowedOrigins);
  app.addHook('onRequest', async (request) => {
    if (!UNSAFE_METHODS.has(request.method)) return;
    const origin = request.headers.origin;
    if (origin !== undefined) {
      if (!allowed.has(origin))
        throw new HttpError(403, 'CSRF_REJECTED', 'Anfrage von einer fremden Seite abgelehnt.');
      return;
    }
    const site = request.headers['sec-fetch-site'];
    if (typeof site === 'string' && site !== 'same-origin' && site !== 'none') {
      throw new HttpError(403, 'CSRF_REJECTED', 'Anfrage von einer fremden Seite abgelehnt.');
    }
  });
}
