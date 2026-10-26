import { type FastifyInstance } from 'fastify';
import { actorId, canonicalJson, sha256Hex } from '@enrp/core';
import { and, eq, idempotencyKeys } from '@enrp/database';
import { AppError } from '@enrp/shared';

const KEY_PATTERN = /^[\w{}.:-]{8,100}$/;

/**
 * Idempotenz für wiederholbare Schreibanfragen: Gleicher Idempotency-Key + gleiche Daten liefert die
 * gespeicherte Antwort, ohne die Aktion erneut auszuführen. Abweichende Daten → 409.
 */
export function registerIdempotency(app: FastifyInstance) {
  app.addHook('preHandler', async (request, reply) => {
    if (!request.routeOptions.config.idempotent) return;
    const key = request.headers['idempotency-key'];
    if (key === undefined) return;
    if (typeof key !== 'string' || !KEY_PATTERN.test(key)) throw new AppError('BAD_REQUEST', 'Ungültiger Idempotency-Key.');
    const scope = `${actorId(request.actor)}:${request.method}:${request.routeOptions.url}`;
    const requestHash = sha256Hex(canonicalJson({ body: request.body ?? null, params: request.params ?? null }));
    const { db } = app.deps.core;
    const inserted = await db.insert(idempotencyKeys).values({ scope, key, requestHash }).onConflictDoNothing().returning();
    if (inserted.length) {
      (request as { idempotency?: { scope: string; key: string } }).idempotency = { scope, key };
      return;
    }
    const [existing] = await db.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key)));
    if (!existing) throw new AppError('CONFLICT', 'Bitte erneut versuchen.');
    if (existing.requestHash !== requestHash) throw new AppError('DUPLICATE_REQUEST', 'Dieser Idempotency-Key wurde bereits mit anderen Daten verwendet.');
    if (existing.statusCode === null) throw new AppError('DUPLICATE_REQUEST', 'Diese Anfrage wird bereits verarbeitet.');
    reply.header('idempotent-replay', 'true');
    return reply.status(existing.statusCode).send(existing.response);
  });

  app.addHook('onSend', async (request, reply, payload) => {
    const idem = (request as { idempotency?: { scope: string; key: string } }).idempotency;
    if (!idem) return payload;
    const { db } = app.deps.core;
    const where = and(eq(idempotencyKeys.scope, idem.scope), eq(idempotencyKeys.key, idem.key));
    if (reply.statusCode >= 500) {
      await db.delete(idempotencyKeys).where(where); // Serverfehler dürfen wiederholt werden.
      return payload;
    }
    let response: unknown = null;
    try {
      response = typeof payload === 'string' ? JSON.parse(payload) : null;
    } catch {
      response = null;
    }
    await db.update(idempotencyKeys).set({ statusCode: reply.statusCode, response: response as never }).where(where);
    return payload;
  });
}
