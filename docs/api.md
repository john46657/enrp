# API-Vertrag – Emden Network

Basis-URL: `PUBLIC_BASE_URL` (Produktion ausschließlich HTTPS). Alle JSON-Antworten im Fehlerfall:

```json
{ "error": "CODE", "message": "Verständliche Meldung ohne interne Details" }
```

Allgemein: Body max. 64 KiB, globales Rate-Limit 300 Anfragen/min je IP (zusätzliche Limits je Route),
Sicherheits-Header über Helmet (CSP `default-src 'none'`, HSTS, `Referrer-Policy: no-referrer`).
Schemas: `packages/shared/src/game.ts` (Zod), Routen: `apps/api/src/routes/`.

| Fehlercode | HTTP | Bedeutung |
|---|---|---|
| `VALIDATION` | 400 | Schema-Validierung fehlgeschlagen |
| `UNAUTHORIZED` | 401 | Bearer-Token fehlt/falsch |
| `FORBIDDEN` | 403 | z. B. Place-ID nicht freigegeben |
| `NOT_FOUND` / `NOT_LINKED` | 404 | Ressource bzw. Verknüpfung nicht vorhanden |
| `CONFLICT` | 409 | Zustand passt nicht (z. B. Server unbekannt, Auftrag nicht reserviert) |
| `SESSION_EXPIRED` | 410 | Auftrag bzw. Session abgelaufen |
| `TOO_MANY_ATTEMPTS` | 429 | Rate-Limit |
| `INTERNAL` | 500 | Interner Fehler (Details nur im Log) |

---

## Verifizierung (Browser)

### `GET /auth/roblox/start?t=<start-token>`

- **Auth:** einmaliges Start-Token aus dem `/verify`-Button (256 Bit, nur als SHA-256-Hash gespeichert, 10 min gültig).
- **Ablauf:** Session `created → started` (atomar, nur einmal). Erzeugt `state` (256 Bit) und PKCE-`code_verifier`
  (64 Zeichen), setzt das Cookie `__Host-en_oauth` (HttpOnly, Secure, SameSite=Lax, Path=/, 10 min) mit einem
  Bindungswert und leitet weiter zu `https://apis.roblox.com/oauth/v1/authorize` mit
  `client_id`, `redirect_uri`, `scope=openid profile`, `response_type=code`, `state`, `code_challenge`,
  `code_challenge_method=S256`.
- **Antworten:** `302` (Weiterleitung) · `400` ungültiger Link · `409` bereits verwendet/ersetzt · `410` abgelaufen
  (jeweils HTML-Seite). Rate-Limit 20/min je IP.

### `GET /auth/roblox/callback?state=…&code=…` bzw. `?state=…&error=access_denied`

- **Auth:** `state` + Cookie `__Host-en_oauth` müssen zur selben Session gehören (Schutz vor Login-CSRF).
- **Ablauf:** Session atomar `started → exchanging` (genau ein Request gewinnt) → Prüfung Ablaufzeit und
  Browser-Bindung → Token-Austausch `POST https://apis.roblox.com/oauth/v1/token` (`grant_type=authorization_code`,
  `code`, `code_verifier`, `redirect_uri`, Client-Credentials im Body) → `GET …/oauth/v1/userinfo` → `sub` ist die
  Roblox-ID → Refresh-Token wird widerrufen (`…/token/revoke`), Tokens werden nicht gespeichert → in einer
  Transaktion: Verknüpfung, Session `completed` (Verifier gelöscht), Outbox „Rolle Verifiziert“, Audit.
- **Antworten (HTML):**

| Status | Fall |
|---|---|
| 200 | Erfolgreich verknüpft (oder dieselbe Kombination erneut) |
| 400 | `state` fehlt/ungültig/manipuliert, anderer Browser, Abbruch bei Roblox (`OAUTH_DENIED`) |
| 409 | Session bereits verwendet (Replay), Roblox-ID schon mit anderem Discord-Account verknüpft, Discord-Account schon mit anderer Roblox-ID verknüpft |
| 410 | Session abgelaufen |
| 502 | Token-Austausch fehlgeschlagen, ungültige userinfo-Antwort |
| 500 | Interner Fehler |

Alle Seiten: `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, keine Skripte. Query-Strings werden nicht
geloggt.

---

## Interne Dienste

Auth: `Authorization: Bearer <INTERNAL_API_TOKEN>`. Gedacht für vertrauenswürdige Dienste (z. B. späteres
Dashboard), die den Auslöser **selbst** authentifiziert und autorisiert haben. Der Bot nutzt die Services direkt.

### `POST /v1/verification/revoke`

Request: `{ "discordId": "<snowflake>", "guildId": "<snowflake>", "actorDiscordId": "<snowflake>", "reason": "3–300 Zeichen" }`
Response `200`: `{ "ok": true, "robloxUserId": "123" }` · `404 NOT_LINKED` · `401`.
Wirkung: Verknüpfung aufgehoben (Historie bleibt), Outbox „Rolle entziehen“, Audit `verification.revoked`.

### `GET /v1/players/:id/profile`

`:id` = `discord:<snowflake>` oder `roblox:<id>`. Auth: `INTERNAL_API_TOKEN` **oder** `GAME_API_KEY`.

```json
{
  "discordId": "…",
  "roblox": { "id": "123", "username": "Name", "displayName": "Anzeige", "linkedAt": "…" },
  "faction": { "key": "polizei", "name": "Polizei", "rank": { "key": "kommissar", "name": "Polizeikommissar", "level": 10 }, "joinedAt": "…" },
  "dutyTime": { "totalSeconds": 0, "last30DaysSeconds": 0 },
  "playTime": { "totalSeconds": 0, "last30DaysSeconds": 0 },
  "onDuty": false
}
```

`404 NOT_LINKED`, wenn keine aktive Verknüpfung besteht. Enthält keine Moderationsdaten, E-Mails oder Tokens.

---

## Game-API (Roblox-Server)

Auth: `Authorization: Bearer <GAME_API_KEY>` (in Roblox als Secret, siehe
[roblox-integration.md](roblox-integration.md)). Header `Roblox-Job-Id` wird für Rate-Limits (240/min je
Server und IP) verwendet.

### `POST /v1/game/heartbeat`

Request: `{ "jobId": "…", "placeId": 123, "placeVersion": 5, "maxPlayers": 30, "players": ["123", "456"], "shuttingDown": false }`
Response: `{ "ok": true, "settings": { "maintenance": { "enabled": false, "message": null } }, "nextHeartbeatSeconds": 30 }`
`403`, wenn `placeId` nicht in `ALLOWED_PLACE_IDS`. Bei `shuttingDown: true` werden Spiel-Dienste dieses Servers beendet.
Server ohne Heartbeat seit 270 s gelten als abgestürzt; ihre Spiel-Dienste werden automatisch beendet.

### `POST /v1/game/events`

Request: `{ "jobId": "…", "events": [ … ] }` (1–50 Ereignisse). Ereignistypen:

| `type` | Felder |
|---|---|
| `player.join` / `player.leave` | `eventId`, `occurredAt` (ISO 8601), `robloxUserId` |
| `duty.start` | + `faction` (`polizei` \| `feuerwehr` \| `rettungsdienst`) |
| `duty.end` | `eventId`, `occurredAt`, `robloxUserId` |

Response: `{ "results": [{ "eventId": "…", "status": "processed" | "duplicate" | "rejected", "reason": "…" }] }`

- `eventId` ist global eindeutig, ein wiederholtes Senden liefert `duplicate` ohne Wirkung.
- Zeitstempel > 60 s in der Zukunft oder > 24 h alt → `rejected: TIMESTAMP_OUT_OF_RANGE`.
- `duty.start` nur für verifizierte Mitglieder genau dieser Fraktion; Dienstende vor Dienstbeginn wird abgelehnt;
  Sitzungen > 24 h werden gekappt und markiert.
- `409`, wenn der Server noch keinen Heartbeat gesendet hat. `500` bei technischen Fehlern; das Ereignis wird
  dann nicht als verarbeitet gespeichert und kann erneut gesendet werden.

### `GET /v1/game/actions?jobId=…`

Response: `{ "actions": [{ "id": "<uuid>", "type": "announce", "payload": { … }, "expiresAt": "…" }] }`

| Typ | Payload | Verteilung |
|---|---|---|
| `announce` | `{ message (1–200) }` | jeder Server einmal |
| `restart_announce` | `{ minutes (1–60) }` | jeder Server einmal |
| `kick` | `{ robloxUserId, reason }` | jeder Server einmal; erledigt, sobald ein Server kickt |
| `ban` | `{ robloxUserId, reason, durationSeconds \| null }` | genau ein Server (Lease 60 s) |
| `unban` | `{ robloxUserId }` | genau ein Server |

Abgelaufene Aufträge werden nicht ausgeliefert. Erfolgt nach einer Reservierung kein Ergebnis, wird der Auftrag
nach Ablauf des Leases erneut vergeben.

### `POST /v1/game/actions/:id/result`

Request: `{ "jobId": "…", "success": true, "message": "kicked" }`
Response: `{ "ok": true, "status": "succeeded", "duplicate": false }`. Wiederholte Meldung desselben Servers →
`duplicate: true`. `409`, wenn der Auftrag einem anderen Server gehört, `410`, wenn er abgelaufen ist.

---

## Öffentlich

### `GET /v1/servers/status`

Response: `{ "servers": 2, "players": 37, "maintenance": false }` (ohne Personendaten, `Cache-Control: max-age=15`,
60/min je IP).

### `GET /healthz` · `GET /readyz`

Liveness (`{ "status": "ok" }`) bzw. Readiness inkl. Datenbank (`503 { "status": "unavailable" }`).
