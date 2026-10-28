import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  healthResponseSchema,
  readinessResponseSchema,
  type HealthResponse,
  type ReadinessCheck,
  type ReadinessResponse,
} from '@emden/shared';

const SERVICE_NAME = 'emden-network-backend';

export interface HealthRouteOptions {
  version: string;
  /** Liefert die Ergebnisse der Bereitschaftsprüfungen (ab Phase 2: Datenbank). */
  readinessChecks: () => Promise<ReadinessCheck[]>;
}

// Health-Checks werden von Hostern sehr häufig abgefragt und sind billig – daher ohne Rate Limit.
const noRateLimit = { rateLimit: false } as const;

export async function healthRoutes(app: FastifyInstance, options: HealthRouteOptions): Promise<void> {
  app.get(
    '/health',
    {
      config: noRateLimit,
      schema: { response: { 200: z.toJSONSchema(healthResponseSchema, { target: 'draft-7' }) } },
    },
    async (): Promise<HealthResponse> => ({
      status: 'ok',
      service: SERVICE_NAME,
      version: options.version,
      uptimeSeconds: Math.round(process.uptime() * 10) / 10,
      timestamp: new Date().toISOString(),
    }),
  );

  const readinessJsonSchema = z.toJSONSchema(readinessResponseSchema, { target: 'draft-7' });
  app.get(
    '/ready',
    { config: noRateLimit, schema: { response: { 200: readinessJsonSchema, 503: readinessJsonSchema } } },
    async (_request, reply): Promise<ReadinessResponse> => {
      let checks: ReadinessCheck[];
      try {
        checks = await options.readinessChecks();
      } catch (err) {
        app.log.error({ err }, 'Readiness-Prüfung fehlgeschlagen');
        checks = [
          { name: 'readiness', status: 'failed', message: 'Prüfung konnte nicht ausgeführt werden.' },
        ];
      }
      const ready = checks.every((check) => check.status !== 'failed');
      void reply.status(ready ? 200 : 503);
      return { status: ready ? 'ready' : 'not_ready', checks, timestamp: new Date().toISOString() };
    },
  );
}
