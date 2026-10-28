import { isSecureOrigin, oauthCookieName, sessionCookieName } from '@emden/shared';
import type { CookieSerializeOptions } from '@fastify/cookie';

export interface CookieSettings {
  secure: boolean;
  session: string;
  oauth: string;
}

/**
 * Über HTTPS (Produktion) bekommen die Cookies das Präfix "__Host-": Der Browser akzeptiert sie dann nur
 * mit Secure, ohne Domain und mit Path=/ – sie können also weder von Subdomains gesetzt noch über
 * unverschlüsseltes HTTP mitgelesen werden. Lokal über http://127.0.0.1 geht das nicht, daher ohne Präfix.
 */
export function cookieSettings(dashboardOrigin: string): CookieSettings {
  return {
    secure: isSecureOrigin(dashboardOrigin),
    session: sessionCookieName(dashboardOrigin),
    oauth: oauthCookieName(dashboardOrigin),
  };
}

export function cookieOptions(settings: CookieSettings, maxAgeSeconds?: number): CookieSerializeOptions {
  return {
    httpOnly: true,
    secure: settings.secure,
    sameSite: 'lax',
    path: '/',
    ...(maxAgeSeconds === undefined ? {} : { maxAge: maxAgeSeconds }),
  };
}
