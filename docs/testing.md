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

API-Tests nutzen `app.inject()` von Fastify – es wird kein echter Port geöffnet.

## CI

`.github/workflows/ci.yml` führt dieselben Prüfungen bei jedem Pull Request aus (nicht bei jedem Push,
um Actions-Minuten zu sparen). Manuell startbar über „Run workflow“.
