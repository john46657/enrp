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
  const secure = dashboardOrigin.startsWith('https://');
  return {
    secure,
    session: secure ? '__Host-en_session' : 'en_session',
    oauth: secure ? '__Host-en_oauth' : 'en_oauth',
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
