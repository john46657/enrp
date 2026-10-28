import type { FastifyError, FastifyInstance } from 'fastify';
import type { ApiError } from '@emden/shared';

/** Fehler, deren Meldung bewusst an Clients gehen darf. */
export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

function body(code: string, message: string, requestId: string): ApiError {
  return { error: { code, message, requestId } };
}

/**
 * Einheitliches Fehlerformat. Interne Details (Stacktraces, SQL, Geheimnisse) landen nur im Server-Log,
 * niemals in der Antwort an den Client.
 */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) => {
    void reply.status(404).send(body('NOT_FOUND', 'Diese Route existiert nicht.', request.id));
  });

  app.setErrorHandler((error: FastifyError | HttpError, request, reply) => {
    if (error instanceof HttpError) {
      return reply.status(error.statusCode).send(body(error.code, error.message, request.id));
    }
    if (error.validation) {
      return reply
        .status(400)
        .send(body('VALIDATION_ERROR', 'Die Anfrage enthält ungültige Daten.', request.id));
    }
    const status = error.statusCode ?? 500;
    if (status === 429) {
      return reply
        .status(429)
        .send(body('RATE_LIMITED', 'Zu viele Anfragen. Bitte später erneut versuchen.', request.id));
    }
    if (status >= 400 && status < 500) {
      // Von Fastify erkannte Client-Fehler (z. B. kaputtes JSON, zu großer Body).
      return reply
        .status(status)
        .send(body('BAD_REQUEST', 'Die Anfrage konnte nicht verarbeitet werden.', request.id));
    }
    request.log.error({ err: error }, 'Unerwarteter Fehler');
    return reply.status(500).send(body('INTERNAL_ERROR', 'Interner Serverfehler.', request.id));
  });
}
