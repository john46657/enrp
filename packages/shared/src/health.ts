import { z } from 'zod';

/**
 * Antwort von GET /health (Liveness): "Läuft der Prozess?"
 * Enthält bewusst keine Details über Abhängigkeiten oder die Umgebung.
 */
export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.string(),
  version: z.string(),
  uptimeSeconds: z.number().nonnegative(),
  timestamp: z.iso.datetime(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const readinessCheckStatusSchema = z.enum(['ok', 'failed', 'not_configured']);
export type ReadinessCheckStatus = z.infer<typeof readinessCheckStatusSchema>;

export const readinessCheckSchema = z.object({
  name: z.string(),
  status: readinessCheckStatusSchema,
  /** Kurze, für Menschen lesbare Erklärung – niemals Geheimnisse oder Stacktraces. */
  message: z.string().optional(),
});
export type ReadinessCheck = z.infer<typeof readinessCheckSchema>;

/**
 * Antwort von GET /ready (Readiness): "Kann der Dienst Anfragen bedienen?"
 * Ein Check mit `not_configured` macht den Dienst nicht unbereit, wenn er (noch) optional ist.
 */
export const readinessResponseSchema = z.object({
  status: z.enum(['ready', 'not_ready']),
  checks: z.array(readinessCheckSchema),
  timestamp: z.iso.datetime(),
});
export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;

/** Einheitliches Fehlerformat aller API-Endpunkte. */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string().optional(),
    /** Bei VALIDATION_ERROR: welches Feld warum ungültig ist (ohne den eingegebenen Wert). */
    fields: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
