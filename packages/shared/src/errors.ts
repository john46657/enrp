/** Fachliche Fehlercodes. Nachrichten sind für Endnutzer gedacht und enthalten nie interne Details. */
export const ERROR_MESSAGES = {
  INVALID_STATE: 'Der Anmeldelink ist ungültig. Bitte starte die Verifizierung mit /verify neu.',
  SESSION_EXPIRED: 'Der Anmeldelink ist abgelaufen. Bitte starte die Verifizierung mit /verify neu.',
  SESSION_ALREADY_USED: 'Dieser Anmeldelink wurde bereits verwendet. Bitte starte die Verifizierung mit /verify neu.',
  BROWSER_MISMATCH: 'Die Anmeldung wurde in einem anderen Browser gestartet. Öffne den Link aus Discord und schließe die Anmeldung im selben Browser ab.',
  OAUTH_DENIED: 'Du hast die Anmeldung bei Roblox abgebrochen. Du kannst es jederzeit mit /verify erneut versuchen.',
  OAUTH_ERROR: 'Roblox hat die Anmeldung abgelehnt. Bitte versuche es mit /verify erneut.',
  TOKEN_EXCHANGE_FAILED: 'Die Anmeldung bei Roblox konnte nicht abgeschlossen werden. Bitte versuche es mit /verify erneut.',
  USERINFO_INVALID: 'Roblox hat keine gültigen Kontodaten geliefert. Bitte versuche es später erneut.',
  ROBLOX_ALREADY_LINKED: 'Dieser Roblox-Account ist bereits mit einem anderen Discord-Account verknüpft. Wende dich bei Fragen an den Support.',
  DISCORD_ALREADY_LINKED: 'Dein Discord-Account ist bereits mit einem anderen Roblox-Account verknüpft. Hebe die Verknüpfung zuerst mit /unlink auf.',
  TOO_MANY_ATTEMPTS: 'Zu viele Versuche. Bitte warte ein paar Minuten.',
  NOT_LINKED: 'Es besteht keine Verknüpfung.',
  FORBIDDEN: 'Dafür fehlt dir die Berechtigung.',
  NOT_FOUND: 'Nicht gefunden.',
  VALIDATION: 'Ungültige Eingabe.',
  CONFLICT: 'Die Aktion steht im Konflikt mit dem aktuellen Zustand.',
  INTERNAL: 'Ein interner Fehler ist aufgetreten. Bitte versuche es später erneut.',
} as const;

export type ErrorCode = keyof typeof ERROR_MESSAGES;

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly httpStatus = 400,
    /** Nur für Logs; wird nie an Nutzer ausgegeben. */
    readonly internalDetail?: string,
  ) {
    super(code);
    this.name = 'AppError';
  }

  get userMessage(): string {
    return ERROR_MESSAGES[this.code];
  }
}
