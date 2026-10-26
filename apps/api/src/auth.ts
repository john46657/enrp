import { timingSafeEqual, createHash } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

function digest(v: string): Buffer {
  return createHash('sha256').update(v).digest();
}

/** Vergleicht ein Bearer-Token zeitkonstant mit dem erwarteten Wert. */
export function bearerMatches(req: FastifyRequest, expected: string): boolean {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return false;
  return timingSafeEqual(digest(header.slice(7)), digest(expected));
}

export function requireBearer(expected: string) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!bearerMatches(req, expected)) {
      return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Ungültige oder fehlende Authentifizierung.' });
    }
  };
}
