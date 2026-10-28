import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvConfig } from '@next/env';
import type { NextConfig } from 'next';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');

// Eine gemeinsame .env im Projektwurzelverzeichnis für alle Apps.
loadEnvConfig(repoRoot);

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'" },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const config: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  turbopack: { root: repoRoot },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  // Der Browser erreicht vom Backend nur die Anmeldung (Discord-Weiterleitung, Cookies). Alle anderen
  // Daten holt der Dashboard-Server selbst – das Backend muss dafür nicht öffentlich erreichbar sein.
  async rewrites() {
    const api = (process.env.API_INTERNAL_URL || 'http://127.0.0.1:4000').replace(/\/+$/, '');
    return [{ source: '/api/auth/:path*', destination: `${api}/auth/:path*` }];
  },
};

export default config;
