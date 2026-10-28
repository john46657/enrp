import 'server-only';

/** Öffentliche Adresse des Control Centers (gleiche Variable wie im Backend). */
export function dashboardOrigin(): string {
  return new URL(process.env.DASHBOARD_PUBLIC_URL || 'http://127.0.0.1:3000').origin;
}

/** Adresse, unter der der Dashboard-Server das Backend erreicht. Gelangt nie in den Browser. */
export function apiBaseUrl(): string {
  return (process.env.API_INTERNAL_URL || 'http://127.0.0.1:4000').replace(/\/+$/, '');
}
