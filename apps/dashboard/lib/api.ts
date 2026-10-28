import 'server-only';
import {
  healthResponseSchema,
  readinessResponseSchema,
  type HealthResponse,
  type ReadinessResponse,
} from '@emden/shared';
import { apiBaseUrl } from './config';

export type BackendStatus =
  | { state: 'online'; health: HealthResponse; readiness: ReadinessResponse | null; checkedAt: string }
  | { state: 'degraded'; health: HealthResponse; readiness: ReadinessResponse | null; checkedAt: string }
  | { state: 'unreachable'; reason: string; checkedAt: string }
  | { state: 'invalid'; reason: string; checkedAt: string };

const TIMEOUT_MS = 3000;

async function getJson(path: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${apiBaseUrl()}${path}`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { accept: 'application/json' },
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

/**
 * Fragt /health und /ready des Backends ab. Gibt immer ein Ergebnis zurück (wirft nicht),
 * damit die Oberfläche jeden Zustand klar darstellen kann.
 */
export async function getBackendStatus(): Promise<BackendStatus> {
  const checkedAt = new Date().toISOString();
  let health;
  try {
    health = await getJson('/health');
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'TimeoutError';
    return {
      state: 'unreachable',
      reason: timedOut
        ? `Keine Antwort innerhalb von ${TIMEOUT_MS / 1000} Sekunden.`
        : 'Verbindung fehlgeschlagen. Läuft das Backend (npm run dev:api)?',
      checkedAt,
    };
  }

  const parsedHealth = healthResponseSchema.safeParse(health.body);
  if (health.status !== 200 || !parsedHealth.success) {
    return {
      state: 'invalid',
      reason: `Unerwartete Antwort von /health (HTTP ${health.status}).`,
      checkedAt,
    };
  }

  let readiness: ReadinessResponse | null = null;
  try {
    const ready = await getJson('/ready');
    const parsed = readinessResponseSchema.safeParse(ready.body);
    if (parsed.success) readiness = parsed.data;
  } catch {
    readiness = null;
  }

  const state = readiness?.status === 'ready' ? 'online' : 'degraded';
  return { state, health: parsedHealth.data, readiness, checkedAt };
}
