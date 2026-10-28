# Sicherheit

## Stand Phase 1

| Maßnahme                              | Umsetzung                                                                                                           |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Keine Geheimnisse im Repository       | `.env` ist in `.gitignore`; `.env.example` enthält nur Platzhalter                                                  |
| Konfiguration wird beim Start geprüft | `apps/api/src/config.ts` (Zod); Fehlermeldungen nennen Variablen, nie Werte                                         |
| Sicherheits-Header (API)              | `@fastify/helmet`, strikte CSP `default-src 'none'` für die reine JSON-API                                          |
| Sicherheits-Header (Dashboard)        | `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `nosniff`, Referrer- und Permissions-Policy, kein `X-Powered-By` |
| CORS                                  | Nur ausdrücklich konfigurierte Ursprünge; `*` wird abgelehnt; in Produktion nur HTTPS                               |
| Rate Limit                            | 100 Anfragen/Minute/IP (konfigurierbar); Health-Endpunkte ausgenommen                                               |
| Fehlerantworten                       | Einheitlich, ohne Stacktraces oder interne Meldungen                                                                |
| Logs                                  | Strukturiert (JSON); `authorization`, `cookie`, `x-api-key` werden geschwärzt                                       |
| Request-IDs                           | Fremde IDs nur, wenn sie `^[A-Za-z0-9-]{8,64}$` entsprechen (Schutz vor Log-Injection)                              |
| Body-Limit                            | 64 KB pro Anfrage                                                                                                   |
| Proxy-Vertrauen                       | `TRUST_PROXY` standardmäßig aus, damit IP-Adressen nicht gefälscht werden können                                    |

## Bekannte Einschränkungen

- **Keine Anmeldung bis Phase 2.** Das Dashboard darf bis dahin nicht öffentlich erreichbar sein.
- Das Rate Limit gilt pro API-Prozess. Bei mehreren Instanzen ist ein gemeinsamer Speicher (z. B. Redis) nötig.
- Die Dashboard-CSP enthält noch keine Skript-Einschränkung (Next.js benötigt dafür Nonces); geplant für Phase 7.

## Geplant

- Phase 2: sichere Anmeldung, Sitzungen mit `HttpOnly`/`Secure`/`SameSite`-Cookies, CSRF-Schutz,
  serverseitige Rollen- und Berechtigungsprüfung, Audit-Log, sichere Owner-Ersteinrichtung ohne
  Standardpasswort.
- Phase 3: signierte Roblox-Heartbeats mit Zeitstempel und Replay-Schutz, Geheimnis-Rotation.
- Phase 5: Dokumentation, was der Discord-Sicherheitsbot **nicht** zuverlässig erkennen kann.

## Sicherheitsprobleme melden

Bitte nicht öffentlich als Issue, sondern direkt an den Betreiber des Projekts.
