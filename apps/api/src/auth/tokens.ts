import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** Zufälliger, URL-sicherer Wert (Standard: 256 Bit) für Sitzungen, state und PKCE. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** PKCE-Challenge nach RFC 7636 (Methode S256). */
export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/** Vergleich in konstanter Zeit, damit sich Werte nicht über die Antwortzeit erraten lassen. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
