/** Einheitliches Fehlerformat aller API-Antworten. */
export const ERROR_CODES = {
  BAD_REQUEST: 400,
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  SESSION_EXPIRED: 401,
  INVALID_SIGNATURE: 401,
  FORBIDDEN: 403,
  CSRF_FAILED: 403,
  APPROVAL_REQUIRED: 403,
  SELF_ACTION_FORBIDDEN: 403,
  ESCALATION_DENIED: 403,
  FEATURE_DISABLED: 403,
  KILL_SWITCH_ACTIVE: 503,
  NOT_FOUND: 404,
  CONFLICT: 409,
  DUPLICATE_REQUEST: 409,
  REPLAY_DETECTED: 409,
  INVALID_STATE: 409,
  GONE: 410,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  UPSTREAM_UNAVAILABLE: 502,
  NOT_CONFIGURED: 503,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    requestId?: string;
    details?: unknown;
  };
}

export class AppError extends Error {
  readonly statusCode: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = ERROR_CODES[code];
  }
}

export const errors = {
  notFound: (what = 'Eintrag') => new AppError('NOT_FOUND', `${what} wurde nicht gefunden.`),
  forbidden: (message = 'Dir fehlt die Berechtigung für diese Aktion.', details?: unknown) =>
    new AppError('FORBIDDEN', message, details),
  conflict: (message: string, details?: unknown) => new AppError('CONFLICT', message, details),
  invalidState: (message: string) => new AppError('INVALID_STATE', message),
  badRequest: (message: string, details?: unknown) => new AppError('BAD_REQUEST', message, details),
  unauthenticated: (message = 'Anmeldung erforderlich.') => new AppError('UNAUTHENTICATED', message),
  notConfigured: (what: string) => new AppError('NOT_CONFIGURED', `${what} ist noch nicht konfiguriert.`),
};
