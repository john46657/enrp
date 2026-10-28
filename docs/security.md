# Sicherheit

## Grundschutz (seit Phase 1)

| Maßnahme                                | Umsetzung                                                                                                                           |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Keine Geheimnisse im Repository         | `.env` ist in `.gitignore`; `.env.example` enthält nur Platzhalter                                                                  |
| Konfiguration wird beim Start geprüft   | `apps/api/src/config.ts` (Zod); Fehlermeldungen nennen Variablen, nie Werte                                                         |
| Sicherheits-Header (API)                | `@fastify/helmet`, strikte CSP `default-src 'none'` für die reine JSON-API                                                          |
| Sicherheits-Header (Dashboard)          | `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `nosniff`, Referrer- und Permissions-Policy, kein `X-Powered-By`                 |
| CORS                                    | Nur ausdrücklich konfigurierte Ursprünge; `*` wird abgelehnt; in Produktion nur HTTPS                                               |
| Rate Limit                              | 100 Anfragen/Minute/IP (konfigurierbar); Health-Endpunkte ausgenommen                                                               |
| Fehlerantworten                         | Einheitlich, ohne Stacktraces oder interne Meldungen                                                                                |
| Logs                                    | Strukturiert (JSON); `authorization`, `cookie`, `x-api-key` werden geschwärzt                                                       |
| Request-IDs                             | Fremde IDs nur, wenn sie `^[A-Za-z0-9-]{8,64}$` entsprechen (Schutz vor Log-Injection)                                              |
| Body-Limit                              | 64 KB pro Anfrage                                                                                                                   |
| Proxy-Vertrauen                         | `TRUST_PROXY` standardmäßig aus, damit IP-Adressen nicht gefälscht werden können                                                    |
| Installationsskripte von Abhängigkeiten | npm 11: nur ausdrücklich freigegebene Skripte laufen (`allowScripts` in `package.json`); `esbuild` und `fsevents` bewusst abgelehnt |
| Entwicklungsserver                      | Backend und Dashboard lauschen lokal nur auf `127.0.0.1`, nicht im WLAN                                                             |

## Anmeldung, Sitzungen und Rechte (Phase 2)

| Maßnahme                      | Umsetzung                                                                                                                                                                                                              |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keine Passwörter              | Anmeldung ausschließlich über Discord (OAuth2 Authorization Code Grant), nur Scope `identify`, keine E-Mail-Adresse                                                                                                    |
| Zugang nur nach Freischaltung | Unbekannte Discord-Konten werden abgelehnt und im Audit-Log festgehalten (nur die Discord-ID des Versuchs)                                                                                                             |
| Schutz des Anmeldeablaufs     | `state` (256 Bit, Vergleich in konstanter Zeit, gilt einmal für 10 Minuten), PKCE mit S256 und Prüfung des Ausstellers `iss` (RFC 9207)                                                                                |
| Discord-Token                 | Wird nach dem Lesen des Profils sofort widerrufen und nie gespeichert                                                                                                                                                  |
| Sitzungs-Cookie               | Zufällig (256 Bit), `HttpOnly`, `SameSite=Lax`, `Path=/`, über HTTPS zusätzlich `Secure` und Präfix `__Host-`                                                                                                          |
| Sitzungen in der Datenbank    | Nur SHA-256-Hash des Tokens. Ende nach 4 Stunden ohne Aktivität oder spätestens nach 24 Stunden (einstellbar), sofort bei Sperrung                                                                                     |
| Rollen und Rechte             | Bei jeder Anfrage frisch aus der Datenbank, Prüfung immer auf dem Server (`requirePermission`). Der Owner hat alle Rechte                                                                                              |
| Keine Rechteausweitung        | Verwaltet wird nur, wer unter einem steht. Niemand ändert sich selbst. Vergeben oder entziehen kann man nur Rechte, die man selbst hat. Den Owner gibt es nur über die Ersteinrichtung (`apps/api/src/auth/policy.ts`) |
| Datensparsame Antworten       | Antworten werden über feste Schemas ausgegeben. Interne Felder (z. B. Sitzungs-Hashes) verlassen den Server nie                                                                                                        |
| Gesicherte Ersteinrichtung    | Kein Standardkonto und kein Standardpasswort. Der erste Owner kommt aus `OWNER_DISCORD_USER_ID`, das nur der Server-Betreiber setzen kann, und das nur, solange es noch keinen Owner gibt                              |
| CSRF                          | Verändernde Anfragen mit fremdem `Origin` oder `Sec-Fetch-Site: cross-site/same-site` werden abgelehnt (`CSRF_REJECTED`), zusätzlich `SameSite=Lax`                                                                    |
| Open Redirect                 | Nach der Anmeldung geht es nur zu Pfaden innerhalb des Dashboards (`safeReturnPath`)                                                                                                                                   |
| Rate Limit                    | Anmelde-Endpunkte: 20 Anfragen pro Minute und IP                                                                                                                                                                       |
| Audit-Log                     | Anmeldung, abgelehnte Anmeldung, Abmeldung und Ersteinrichtung. Die Datenbank verhindert nachträgliche Änderungen. Aufbewahrung 365 Tage (einstellbar), danach automatische Löschung                                   |
| Aufräumen                     | Abgelaufene Sitzungen und alte Audit-Einträge werden beim Start und dann stündlich gelöscht                                                                                                                            |

## Bekannte Einschränkungen

- Das Backend sieht alle Anfragen, die über das Dashboard kommen, von der Adresse des Dashboard-Servers.
  Angemeldete Personen werden deshalb **pro Sitzung** gezählt (600 Anfragen pro Minute; nur vom Backend
  ausgestellte Sitzungen zählen, gefälschte Cookies zählen wie Unbekannte). Nicht angemeldete Anfragen, also
  auch die Anmeldeseite, teilen sich bis Phase 7 ein gemeinsames Limit. Ein Angreifer könnte so Anmeldungen
  kurzzeitig blockieren, aber nicht umgehen. Die echte Besucher-IP (`TRUST_PROXY`) folgt mit dem Hosting.
- Ist Discord gestört, kann sich niemand anmelden. Bestehende Sitzungen laufen weiter.
- Das Rate Limit gilt pro API-Prozess. Bei mehreren Instanzen ist ein gemeinsamer Speicher (z. B. Redis) nötig.
- Die Dashboard-CSP enthält noch keine Skript-Einschränkung (Next.js benötigt dafür Nonces); geplant für Phase 7.

## Geplant

- Phase 3: signierte Roblox-Heartbeats mit Zeitstempel und Replay-Schutz, Geheimnis-Rotation.
- Phase 5: Dokumentation, was der Discord-Sicherheitsbot **nicht** zuverlässig erkennen kann.

## Sicherheitsprobleme melden

Bitte nicht öffentlich als Issue, sondern direkt an den Betreiber des Projekts.
