# Tests und Qualität

```bash
npm run check        # alles, wie in der CI: Format, Lint, TypeScript, Tests, Build
npm test             # nur Tests (einmalig)
npm run test:watch   # Tests bei Änderungen neu ausführen
npx vitest run apps/api   # nur die Tests eines Ordners
```

## Was getestet wird (Phase 1)

| Datei                           | Inhalt                                                                                                                                                                              |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/test/health.test.ts`  | `/health`, `/ready` (inkl. 503 und Absturz der Prüfung), Sicherheits-Header, Request-ID-Prüfung, Rate Limit, CORS-Allowlist, Fehlerformat (404, 400, 429, 500 ohne interne Details) |
| `apps/api/test/config.test.ts`  | Standardwerte, Port-Vorrang, CORS-Validierung (kein `*`, HTTPS in Produktion), Fehlermeldungen ohne Werte                                                                           |
| `packages/shared/src/*.test.ts` | Schemas sowie Navigation: genau 13 Bereiche, kein Dispatch-/Personalbereich, nur Phase-1-Bereiche verfügbar                                                                         |
| `apps/dashboard/**/*.test.tsx`  | Formatierung der Laufzeit, Status-Badge mit Text und verstecktem Symbol                                                                                                             |

| `apps/api/test/database.test.ts` | Migrationen: Reihenfolge, Idempotenz, Rücknahme bei Fehlern, Prüfsummen, Schema-Abgleich SQL ↔ TypeScript, Startdaten, unveränderliches Audit-Log, Datenbank-Prüfregeln, Sperre der lokalen Datenbank |
| `apps/api/test/readiness.test.ts` | `/ready` mit Datenbank: aktuell, Migrationen ausstehend, nicht erreichbar |
| `apps/api/test/postgres.integration.test.ts` | Dieselben Migrationen gegen echtes PostgreSQL, inklusive gleichzeitiger Migration. Läuft nur mit `TEST_DATABASE_URL`, sonst „skipped“ |

API-Tests nutzen `app.inject()` von Fastify – es wird kein echter Port geöffnet. Datenbanktests nutzen PGlite
im Arbeitsspeicher (siehe [database.md](database.md)); der Start einer solchen Datenbank dauert einige
Sekunden, daher teilen sich die Tests einer Datei eine Datenbank.

## CI

`.github/workflows/ci.yml` führt dieselben Prüfungen bei jedem Pull Request aus – inklusive der Integrationstests gegen einen PostgreSQL-16-Container – (nicht bei jedem Push,
um Actions-Minuten zu sparen). Manuell startbar über „Run workflow“.
