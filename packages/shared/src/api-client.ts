import { type ApiErrorBody, type ErrorCode } from './errors';

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'NETWORK_ERROR' | 'TIMEOUT',
    message: string,
    readonly details?: unknown,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  /** Header, die bei jeder Anfrage gesendet werden (z. B. Service-Token). */
  headers?: () => Record<string, string> | Promise<Record<string, string>>;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  credentials?: 'include' | 'omit' | 'same-origin';
}

export interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  headers?: Record<string, string>;
  idempotencyKey?: string;
  signal?: AbortSignal;
}

/** Schlanker, fehlertoleranter HTTP-Client für Bot und Dashboard. */
export function createApiClient(options: ApiClientOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;

  async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    const url = new URL(
      path.replace(/^\//, ''),
      options.baseUrl.endsWith('/') ? options.baseUrl : `${options.baseUrl}/`,
    );
    for (const [key, value] of Object.entries(opts.query ?? {})) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
    const headers: Record<string, string> = {
      accept: 'application/json',
      ...(await options.headers?.()),
      ...opts.headers,
    };
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    if (opts.idempotencyKey) headers['idempotency-key'] = opts.idempotencyKey;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    opts.signal?.addEventListener('abort', () => controller.abort());
    let res: Response;
    try {
      res = await fetchImpl(url, {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: controller.signal,
        credentials: options.credentials,
      });
    } catch (err) {
      const aborted = (err as Error).name === 'AbortError';
      throw new ApiClientError(
        0,
        aborted ? 'TIMEOUT' : 'NETWORK_ERROR',
        aborted ? 'Zeitüberschreitung bei der API-Anfrage.' : 'API nicht erreichbar.',
      );
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    const data = text ? safeJson(text) : undefined;
    if (!res.ok) {
      const body = data as ApiErrorBody | undefined;
      throw new ApiClientError(
        res.status,
        body?.error?.code ?? 'INTERNAL',
        body?.error?.message ?? `Anfrage fehlgeschlagen (${res.status}).`,
        body?.error?.details,
        body?.error?.requestId,
      );
    }
    return data as T;
  }

  return {
    request,
    get: <T>(path: string, opts?: RequestOptions) => request<T>('GET', path, opts),
    post: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
      request<T>('POST', path, { ...opts, body: body ?? {} }),
    patch: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
      request<T>('PATCH', path, { ...opts, body: body ?? {} }),
    put: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
      request<T>('PUT', path, { ...opts, body: body ?? {} }),
    delete: <T>(path: string, opts?: RequestOptions) => request<T>('DELETE', path, opts),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
