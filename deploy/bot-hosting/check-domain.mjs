#!/usr/bin/env node
// Prüft, ob unter der öffentlichen Domain wirklich die ENRP-Plattform antwortet (und nicht z. B. das alte
// Express-Dashboard der Altmodule). Sendet keine Schlüssel.
//   node deploy/bot-hosting/check-domain.mjs https://2pgwy073wo.apps.bot-hosting.cloud
import { checkDomain } from './domain-check.mjs';

const base = (process.argv[2] ?? process.env.PUBLIC_URL ?? '').replace(/\/+$/, '');
if (!base.startsWith('https://')) {
  console.error('Aufruf: node deploy/bot-hosting/check-domain.mjs https://deine-domain');
  process.exit(2);
}
const results = await checkDomain(base, fetch);
for (const r of results) process.stdout.write(`${r.ok ? '✅' : '❌'} ${r.name}: ${r.detail}\n`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
