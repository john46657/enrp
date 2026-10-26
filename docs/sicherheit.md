# Sicherheit – Emden Network

| Anforderung | Umsetzung | Ort |
|---|---|---|
| HTTPS | Produktion erzwingt `https://` und `Secure`-Cookies, HSTS-Header, Caddy-Beispiel | `apps/api/src/config.ts`, `infra/` |
| Secret-Verwaltung | Nur Umgebungsvariablen/Secret-Manager, `.env` in `.gitignore`, keine Secrets im Roblox-Client, Roblox-Secret nur in der API | `.env.example`, `docs/roblox-integration.md` |
| Zentrale Berechtigungen | `authorize()` vor jeder kritischen Änderung im Service, Matrix aus Code generiert | `packages/core/src/authz.ts`, `packages/shared/src/permissions.ts` |
| Request-/Schema-Validierung | Zod für alle Eingaben (API und Payloads), Discord-Optionen mit Längen/Choices | `packages/shared/src/game.ts`, Routen |
| Rate-Limits | global 300/min/IP; OAuth 20/min/IP; Game-API 240/min je Server; `/verify` max. 5 Links/15 min je Nutzer | `apps/api/src/app.ts`, `VerificationService` |
| OAuth-CSRF | `state` (256 Bit, gehasht), Browser-Bindungs-Cookie (`__Host-`, HttpOnly, SameSite=Lax) | `packages/core/src/verification.ts` |
| Code-Replay | atomarer Statuswechsel, Session nur einmal einlösbar, Roblox-Codes nur einmal gültig | dto. |
| Transaktionen | Verknüpfung + Outbox + Audit in einer Transaktion; Rangänderungen, Korrekturen, Aufträge transaktional | `withTransaction` |
| Idempotenz | Event-GUIDs, eindeutige Dienst-Event-IDs, Broadcast-Ergebnis-PK, Dedupe-Keys der Outbox | Migrationen |
| Audit-Logs | Verifizierung, Rang-/Mitgliedschaftsänderungen, Dienstkorrekturen, Moderation, Bans, Konfiguration, verweigerte Zugriffe. Schlüssel mit token/secret/verifier werden entfernt | `packages/core/src/audit.ts` |
| Sichere Fehlerbehandlung | Nutzer sehen nur feste deutsche Meldungen; Details nur im Log; Fehler-Referenz im Bot | `packages/shared/src/errors.ts` |
| Minimale Rechte | DB-App-Rolle ohne DDL (getestet: `42501`), Bot ohne privilegierte Intents und ohne Administrator, Container als `node` | `infra/postgres/init/01-roles.sh` |
| Backups | `backup.sh` + getesteter Restore in temporäre DB | `infra/scripts/` |
| Umgebungstrennung | eigene Secrets/Apps je Umgebung, Test-DB-Schutz (`test` im Namen) | `docs/betrieb.md`, `tests/helpers/global-setup.ts` |
| Logs ohne Secrets | Redaction von Authorization/Cookie, Query-Strings entfernt | `apps/api/src/main.ts` |
| Datenaufbewahrung | automatische Bereinigung (siehe Datenschutz) | `packages/core/src/retention.ts` |
| Ausgabe-Sicherheit | HTML-Ergebnisseiten escaped, ohne Skripte, CSP `default-src 'none'`; Discord-Antworten ohne Massen-Pings (`allowedMentions`) | `apps/api/src/html.ts`, Bot |

## Bekannte Restrisiken / Hinweise

- **Spielserver-Authentifizierung** beruht auf einem gemeinsamen Schlüssel. Wer ihn kennt, kann Ereignisse für
  beliebige Server senden. Schutz: Secret nur im Roblox-Secret-Store (Domain-gebunden), Place-ID-Allowlist,
  Plausibilitätsprüfungen, Rotation bei Verdacht (neuen Schlüssel in API und Roblox setzen).
- **Interner Token** (`INTERNAL_API_TOKEN`) gewährt Zugriff auf Profil- und Revoke-Routen. Nur an vertrauenswürdige
  Dienste geben.
- **Rate-Limits** sind je API-Instanz (In-Memory). Bei mehreren Instanzen Redis-Store ergänzen.
- **ID-Token** wird nicht ausgewertet (siehe OAuth-Doku); Identität kommt ausschließlich aus userinfo.
- Eine **externe Sicherheitsprüfung** (Penetrationstest) wurde nicht durchgeführt.
