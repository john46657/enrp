# Tests und Qualität

```bash
npm run check        # alles, wie in der CI: Format, Lint, TypeScript, Tests, Build
npm test             # nur Tests (einmalig)
npm run test:watch   # Tests bei Änderungen neu ausführen
npx vitest run apps/api   # nur die Tests eines Ordners
```

## Was automatisch getestet wird

| Datei                           | Inhalt                                                                                                                                                                              |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/test/health.test.ts`  | `/health`, `/ready` (inkl. 503 und Absturz der Prüfung), Sicherheits-Header, Request-ID-Prüfung, Rate Limit, CORS-Allowlist, Fehlerformat (404, 400, 429, 500 ohne interne Details) |
| `apps/api/test/config.test.ts`  | Standardwerte, Port-Vorrang, CORS-Validierung (kein `*`, HTTPS in Produktion), Fehlermeldungen ohne Werte                                                                           |
| `packages/shared/src/*.test.ts` | Schemas sowie Navigation: genau 13 Bereiche, kein Dispatch-/Personalbereich, nur Phase-1-Bereiche verfügbar                                                                         |
| `apps/dashboard/**/*.test.tsx`  | Formatierung der Laufzeit, Status-Badge mit Text und verstecktem Symbol                                                                                                             |

| `apps/api/test/database.test.ts` | Migrationen: Reihenfolge, Idempotenz, Rücknahme bei Fehlern, Prüfsummen, Schema-Abgleich SQL ↔ TypeScript, Startdaten, unveränderliches Audit-Log, Datenbank-Prüfregeln, Sperre der lokalen Datenbank |
| `apps/api/test/readiness.test.ts` | `/ready` mit Datenbank: aktuell, Migrationen ausstehend, nicht erreichbar |
| `apps/api/test/auth.test.ts` | Discord-Login: state, PKCE, Aussteller, Ablauf nach 10 Minuten, abgelehnte und gesperrte Konten, Fehler von Discord, Open-Redirect-Schutz, Sitzungsdauer (untätig/maximal/Sperrung), Abmelden, CSRF, Rate Limits |
| `apps/api/test/discord.test.ts` | Exakte Anfragen an die dokumentierten Discord-Endpunkte (URL, Formular, Basic-Auth, PKCE) und Einordnung aller Fehlerfälle |
| `apps/api/test/admin.test.ts` | Rechteprüfung für Benutzer, Rollen und Audit-Log: wer was darf, Rangregeln, keine Rechteausweitung, Protokollierung abgelehnter Versuche, feldgenaue Fehler |
| `apps/api/test/bootstrap.test.ts` | Gesicherte Owner-Ersteinrichtung und Aufräumen nach Aufbewahrungsregeln |
| `apps/dashboard/lib/navigation.test.ts` | Menüpunkte nach Berechtigung, Anmelde-Fehlermeldungen |
| `apps/api/test/postgres.integration.test.ts` | Dieselben Migrationen gegen echtes PostgreSQL, inklusive gleichzeitiger Migration. Läuft nur mit `TEST_DATABASE_URL`, sonst „skipped“ |

API-Tests nutzen `app.inject()` von Fastify – es wird kein echter Port geöffnet. Datenbanktests nutzen PGlite
im Arbeitsspeicher (siehe [database.md](database.md)); der Start einer solchen Datenbank dauert einige
Sekunden, daher teilen sich die Tests einer Datei eine Datenbank.

## Manueller End-to-End-Test (Browser)

Für Phase 2 wurde der komplette Ablauf zusätzlich im echten Browser (Chromium über Playwright) geprüft: mit
laufendem Backend, Dashboard und einer Discord-Attrappe, die PKCE, Client-Secret und Redirect-Adresse wie
Discord prüft. Getestet wurden Anmeldung, Freischalten (inkl. Feldfehler), Rollen- und Rechteänderung, Sperren
mit Rückfrage, Entsperren, Audit-Log, Abmelden, abgelehnte und gesperrte Konten sowie die Darstellung auf dem
Handy. Ein automatischer Browser-Test in der CI ist für Phase 7 geplant.

## CI

`.github/workflows/ci.yml` führt dieselben Prüfungen bei jedem Pull Request aus – inklusive der Integrationstests gegen einen PostgreSQL-16-Container – (nicht bei jedem Push,
um Actions-Minuten zu sparen). Manuell startbar über „Run workflow“.
