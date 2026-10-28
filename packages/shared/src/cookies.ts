/**
 * Namen der Cookies, die Backend und Dashboard gemeinsam kennen müssen.
 * Über HTTPS mit Präfix "__Host-": Der Browser nimmt sie dann nur mit Secure, ohne Domain und mit Path=/ an.
 */
export function isSecureOrigin(origin: string): boolean {
  return origin.startsWith('https://');
}

export function sessionCookieName(dashboardOrigin: string): string {
  return isSecureOrigin(dashboardOrigin) ? '__Host-en_session' : 'en_session';
}

export function oauthCookieName(dashboardOrigin: string): string {
  return isSecureOrigin(dashboardOrigin) ? '__Host-en_oauth' : 'en_oauth';
}
