'use client';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Array<{ path: string; message: string }> | unknown,
    readonly requestId?: string,
  ) {
    super(message);
  }
}

let csrfToken: string | null = null;
export function setCsrfToken(token: string | null) {
  csrfToken = token;
}

type Query = Record<string, string | number | boolean | undefined | null>;

export function buildPath(path: string, query?: Query) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {}))
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  const qs = params.toString();
  return `/api/v1${path}${qs ? `?${qs}` : ''}`;
}

/** Fetch-Wrapper: Cookies der Sitzung, CSRF-Token für Schreibzugriffe, einheitliche Fehler. */
export async function api<T>(
  method: string,
  path: string,
  options: { query?: Query; body?: unknown; idempotencyKey?: string } = {},
): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers['x-csrf-token'] = csrfToken;
  if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;
  let res: Response;
  try {
    res = await fetch(buildPath(path, options.query), {
      method,
      headers,
      credentials: 'same-origin',
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Die API ist nicht erreichbar. Prüfe die Verbindung.');
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    throw new ApiError(
      res.status,
      data?.error?.code ?? 'INTERNAL',
      data?.error?.message ?? `Fehler ${res.status}`,
      data?.error?.details,
      data?.error?.requestId,
    );
  }
  return data as T;
}

export const get = <T>(path: string, query?: Query) => api<T>('GET', path, { query });
export const post = <T>(path: string, body: unknown = {}, idempotencyKey?: string) =>
  api<T>('POST', path, { body, idempotencyKey });
export const patch = <T>(path: string, body: unknown) => api<T>('PATCH', path, { body });
export const put = <T>(path: string, body: unknown) => api<T>('PUT', path, { body });

export function newIdempotencyKey() {
  return crypto.randomUUID();
}
