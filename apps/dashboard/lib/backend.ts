import 'server-only';
import { apiErrorSchema, meResponseSchema, type CurrentUser } from '@emden/shared';
import { cookies } from 'next/headers';
import { cache } from 'react';
import type { z } from 'zod';
import { apiBaseUrl } from './config';

const TIMEOUT_MS = 5_000;

export class BackendUnavailableError extends Error {
  override name = 'BackendUnavailableError';
}

export type FieldError = { path: string; message: string };

export type ApiResult<T> =
  { ok: true; data: T } | { ok: false; status: number; code: string; message: string; fields?: FieldError[] };

/**
 * Ruft das Backend vom Dashboard-Server aus auf und reicht die Cookies der angemeldeten Person weiter.
 * Antworten werden gegen das gemeinsame Schema geprüft. Wirft nur, wenn das Backend nicht erreichbar ist
 * oder Unerwartetes antwortet; fachliche Fehler (401, 403, 400 …) kommen als Ergebnis zurück.
 */
export async function callBackend<T>(
  path: string,
  schema: z.ZodType<T> | null,
  init: { method?: 'GET' | 'POST' | 'PATCH' | 'PUT'; body?: unknown } = {},
): Promise<ApiResult<T>> {
  const cookieHeader = (await cookies()).toString();
  let res: Response;
  try {
    res = await fetch(`${apiBaseUrl()}${path}`, {
      method: init.method ?? 'GET',
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        accept: 'application/json',
        ...(cookieHeader ? { cookie: cookieHeader } : {}),
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new BackendUnavailableError('Das Backend ist nicht erreichbar.');
  }

  if (res.status === 204) return { ok: true, data: undefined as T };
  const json: unknown = await res.json().catch(() => null);
  if (res.ok) {
    if (!schema) return { ok: true, data: json as T };
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new Error(`Unerwartete Antwort des Backends auf ${path}`);
    return { ok: true, data: parsed.data };
  }
  const error = apiErrorSchema.safeParse(json);
  return error.success
    ? {
        ok: false,
        status: res.status,
        code: error.data.error.code,
        message: error.data.error.message,
        ...(error.data.error.fields ? { fields: error.data.error.fields } : {}),
      }
    : {
        ok: false,
        status: res.status,
        code: 'UNKNOWN',
        message: `Unerwartete Antwort (HTTP ${res.status}).`,
      };
}

export type SessionState =
  { state: 'authenticated'; user: CurrentUser } | { state: 'anonymous' } | { state: 'unreachable' };

/** Wer ist angemeldet? Pro Seitenaufruf nur einmal abgefragt (React cache). */
export const getSession = cache(async (): Promise<SessionState> => {
  try {
    const result = await callBackend('/auth/me', meResponseSchema);
    return result.ok ? { state: 'authenticated', user: result.data.user } : { state: 'anonymous' };
  } catch (err) {
    if (err instanceof BackendUnavailableError) return { state: 'unreachable' };
    throw err;
  }
});

export function hasPermission(user: CurrentUser, permission: string): boolean {
  return user.permissions.includes(permission);
}
