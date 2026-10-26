import { type FastifyError, type FastifyInstance } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import { ZodError } from 'zod';
import { AppError, type ApiErrorBody } from '@enrp/shared';

/**
 * Einheitliches Fehlerformat. Interne Details (Stacktraces, SQL, Geheimnisse) werden nie ausgeliefert,
 * sondern nur mit Request-ID geloggt.
 */
export function registerErrorHandling(app: FastifyInstance) {
  app.setErrorHandler((error: FastifyError | AppError | ZodError, request, reply) => {
    const requestId = request.id;
    let status = 500;
    let body: ApiErrorBody;
    if (error instanceof AppError) {
      status = error.statusCode;
      body = { error: { code: error.code, message: error.message, requestId, details: error.details } };
    } else if (hasZodFastifySchemaValidationErrors(error)) {
      status = 400;
      body = {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Die Eingaben sind ungültig.',
          requestId,
          details: error.validation.map((v) => ({ path: v.instancePath || '', message: v.message })),
        },
      };
    } else if (error instanceof ZodError) {
      status = 400;
      body = {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Die Eingaben sind ungültig.',
          requestId,
          details: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      };
    } else if ((error as FastifyError).statusCode === 429) {
      status = 429;
      body = { error: { code: 'RATE_LIMITED', message: 'Zu viele Anfragen. Bitte kurz warten.', requestId } };
    } else if ((error as FastifyError).code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      status = 413;
      body = { error: { code: 'PAYLOAD_TOO_LARGE', message: 'Die Anfrage ist zu groß.', requestId } };
    } else if ((error as FastifyError).statusCode && (error as FastifyError).statusCode! < 500) {
      status = (error as FastifyError).statusCode!;
      body = { error: { code: 'BAD_REQUEST', message: 'Ungültige Anfrage.', requestId } };
    } else {
      body = { error: { code: 'INTERNAL', message: 'Interner Fehler. Bitte später erneut versuchen.', requestId } };
    }
    if (status >= 500 && !(error instanceof AppError)) request.log.error({ err: error }, 'Unbehandelter Fehler');
    else if (status >= 500) request.log.warn({ code: body.error.code, status }, body.error.message);
    else request.log.info({ code: body.error.code, status }, 'Anfrage abgelehnt');
    return reply.status(status).send(body);
  });

  app.setNotFoundHandler((request, reply) => {
    reply
      .status(404)
      .send({
        error: { code: 'NOT_FOUND', message: 'Endpunkt nicht gefunden.', requestId: request.id },
      } satisfies ApiErrorBody);
  });
}
