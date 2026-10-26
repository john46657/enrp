import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** Kryptografisch sicheres, URL-taugliches Zufallstoken (base64url). 32 Byte = 256 Bit. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(input: string): Buffer {
  return createHash('sha256').update(input, 'utf8').digest();
}

/**
 * PKCE-code_verifier nach RFC 7636: 43–128 Zeichen aus [A-Za-z0-9-._~].
 * 48 Zufallsbytes ergeben 64 base64url-Zeichen.
 */
export function createCodeVerifier(): string {
  return randomBytes(48).toString('base64url');
}

/** code_challenge = BASE64URL(SHA256(ASCII(code_verifier))), Methode S256. */
export function codeChallengeS256(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

export function safeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}
