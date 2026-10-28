# API – Emden Network Backend

Basis-URL lokal: `http://127.0.0.1:4000`. Alle Antworten sind JSON. Jede Antwort enthält den Header
`x-request-id`; diese ID steht auch im Server-Log und hilft bei der Fehlersuche.

Eine maschinenlesbare OpenAPI-Beschreibung ist **geplant** (sobald es mehr als die Health-Endpunkte gibt).
Die Schemas liegen schon jetzt als Zod-Schemas in `packages/shared/src/health.ts`.

## `GET /health` – Liveness

„Läuft der Prozess?“ Ohne Rate Limit, ohne Authentifizierung, ohne Details zu Abhängigkeiten.

```json
{
  "status": "ok",
  "service": "emden-network-backend",
  "version": "0.1.0",
  "uptimeSeconds": 12.3,
  "timestamp": "2026-10-28T11:42:45.792Z"
}
```

## `GET /ready` – Readiness

„Kann der Dienst Anfragen bedienen?“ `200` bei `ready`, `503` bei `not_ready`.
Check-Status: `ok`, `failed` oder `not_configured` (noch nicht angebunden – macht nicht unbereit).

```json
{
  "status": "ready",
  "timestamp": "…",
  "checks": [
    { "name": "database", "status": "not_configured", "message": "PostgreSQL wird in Phase 2 angebunden." }
  ]
}
```

## Anmeldung (`/auth/…`)

Das Dashboard leitet `/api/auth/…` an diese Endpunkte weiter. Der Browser spricht also immer nur mit dem
Dashboard. Ablauf und Schutzmaßnahmen stehen in [security.md](security.md).

| Methode und Pfad                         | Zweck                                              | Antwort                                                |
| ---------------------------------------- | -------------------------------------------------- | ------------------------------------------------------ |
| `GET /auth/status`                       | Ist die Discord-Anmeldung eingerichtet?            | `{ "discordLogin": "configured" \| "not_configured" }` |
| `GET /auth/discord/login?returnTo=/pfad` | Startet die Anmeldung                              | `302` zu Discord                                       |
| `GET /auth/discord/callback`             | Rückkehr von Discord                               | `302` zum Dashboard (Erfolg) oder zu `/login?error=…`  |
| `GET /auth/me`                           | Angemeldeter Benutzer mit Rolle und Berechtigungen | `200` oder `401 UNAUTHENTICATED`                       |
| `POST /auth/logout`                      | Abmelden                                           | `204`                                                  |

Fehlercodes für `/login?error=`: `not_configured`, `cancelled`, `state_mismatch`, `discord_unavailable`,
`login_failed`, `not_registered`, `account_disabled`.

## Fehlerformat

Alle Fehler haben dasselbe Format. Interne Details (Stacktraces, Datenbankfehler) werden nie ausgeliefert.

```json
{ "error": { "code": "NOT_FOUND", "message": "Diese Route existiert nicht.", "requestId": "…" } }
```

| HTTP | `code`             | Bedeutung                                           |
| ---- | ------------------ | --------------------------------------------------- |
| 400  | `VALIDATION_ERROR` | Anfrage passt nicht zum Schema                      |
| 400  | `BAD_REQUEST`      | z. B. ungültiges JSON                               |
| 401  | `UNAUTHENTICATED`  | Nicht angemeldet oder Sitzung abgelaufen            |
| 403  | `FORBIDDEN`        | Angemeldet, aber ohne die nötige Berechtigung       |
| 403  | `CSRF_REJECTED`    | Verändernde Anfrage von einer fremden Webseite      |
| 404  | `NOT_FOUND`        | Route existiert nicht                               |
| 429  | `RATE_LIMITED`     | Zu viele Anfragen (Standard: 100 pro Minute und IP) |
| 500  | `INTERNAL_ERROR`   | Unerwarteter Fehler, Details nur im Server-Log      |
