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

## Fehlerformat

Alle Fehler haben dasselbe Format. Interne Details (Stacktraces, Datenbankfehler) werden nie ausgeliefert.

```json
{ "error": { "code": "NOT_FOUND", "message": "Diese Route existiert nicht.", "requestId": "…" } }
```

| HTTP | `code`             | Bedeutung                                           |
| ---- | ------------------ | --------------------------------------------------- |
| 400  | `VALIDATION_ERROR` | Anfrage passt nicht zum Schema                      |
| 400  | `BAD_REQUEST`      | z. B. ungültiges JSON                               |
| 404  | `NOT_FOUND`        | Route existiert nicht                               |
| 429  | `RATE_LIMITED`     | Zu viele Anfragen (Standard: 100 pro Minute und IP) |
| 500  | `INTERNAL_ERROR`   | Unerwarteter Fehler, Details nur im Server-Log      |
