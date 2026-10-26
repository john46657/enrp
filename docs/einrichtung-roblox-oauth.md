# Roblox OAuth 2.0 einrichten (inkl. HTTPS und Redirect-URI)

Geprüft gegen die offizielle Dokumentation (Stand 10/2026):
[OAuth 2.0 implementieren](https://create.roblox.com/docs/cloud/auth/oauth2-develop),
[OAuth 2.0 Referenz](https://create.roblox.com/docs/cloud/auth/oauth2-reference),
[App registrieren](https://create.roblox.com/docs/cloud/auth/oauth2-registration) sowie das Discovery-Dokument
`https://apis.roblox.com/oauth/.well-known/openid-configuration`.

## Verwendete Endpunkte und Parameter

| Zweck | Endpunkt | Hinweis |
|---|---|---|
| Autorisierung | `GET https://apis.roblox.com/oauth/v1/authorize` | `client_id`, `redirect_uri`, `scope`, `response_type=code`, `state`, `code_challenge`, `code_challenge_method=S256` |
| Token | `POST https://apis.roblox.com/oauth/v1/token` | `grant_type=authorization_code`, `code`, `code_verifier`, Client-Credentials im Body (`client_secret_post`, laut Discovery unterstützt) |
| Nutzerinfo | `GET https://apis.roblox.com/oauth/v1/userinfo` | `Authorization: Bearer <access_token>`; `sub` = Roblox-User-ID |
| Widerruf | `POST https://apis.roblox.com/oauth/v1/token/revoke` | Refresh-Token wird nach der Prüfung widerrufen |

**Scopes:** nur `openid` und `profile`. Beide stehen in `scopes_supported` des Discovery-Dokuments. Ohne `profile`
liefert userinfo nur `sub`. Mit `profile` kommen zusätzlich `preferred_username` (Benutzername) und
`name`/`nickname` (Anzeigename). Gespeichert werden nur `sub`, der Benutzername und der Anzeigename. Der
Identifikator ist ausschließlich `sub`.

**Laut Doku:** Autorisierungscodes sind 1 Minute gültig und einmalig. Access-Tokens gelten 15 Minuten,
Refresh-Tokens 90 Tage. Wir verwenden das Access-Token genau einmal (userinfo) und speichern keine Tokens.

**Einschränkungen von Roblox, die du kennen musst:**
- Nicht geprüfte Apps laufen im **privaten Modus mit maximal 10 verschiedenen Nutzern**. Für den Livebetrieb musst
  du die App zur Prüfung einreichen (Demo-Video ≤ 1 min vom ausgeloggten Zustand an, Begründung für Kategorie und
  Scopes). Während einer laufenden Prüfung ist keine Bearbeitung möglich. Eine veröffentlichte App kann nicht in
  den privaten Modus zurück.
- Pro App bis zu 10 Redirect-URLs (je ≤ 256 Zeichen). HTTPS ist erlaubt, `localhost` auch per HTTP (zum Testen).
- Die Doku gibt keine Hinweise zur Validierung des ID-Tokens. Wir verwenden deshalb den offiziellen
  userinfo-Endpunkt (TLS, Access-Token) als Quelle der Identität und werten das ID-Token nicht aus.

## Schritt für Schritt

1. [Creator Hub](https://create.roblox.com/dashboard/credentials) → **OAuth 2.0 Apps** → **Create App**.
   Global eindeutigen Namen wählen (z. B. „Emden Network Verifizierung“), Nutzungsbedingungen akzeptieren.
2. **Client ID** und **Client Secret** kopieren. Das Secret wird nur einmal angezeigt.
   → `ROBLOX_OAUTH_CLIENT_ID`, `ROBLOX_OAUTH_CLIENT_SECRET` (nur in der `.env` der **API**).
3. App bearbeiten:
   - **Redirect URLs:**
     - Produktion: `https://api.deine-domain.de/auth/roblox/callback` (muss exakt `PUBLIC_BASE_URL` +
       `/auth/roblox/callback` sein)
     - Lokal (optional): `http://localhost:3000/auth/roblox/callback`
   - **Scopes/Berechtigungen:** nur `openid` und `profile`. Keine API-Scopes.
   - Beschreibung, Datenschutz-URL und Nutzungsbedingungen-URL eintragen (für die Prüfung erforderlich).
4. Für mehr als 10 Nutzer: **Edit and Publish → Review and Publish → Submit for Review**.

## HTTPS für die Callback-URL

Produktion **muss** HTTPS verwenden. Die API startet mit `NODE_ENV=production` nicht, wenn `PUBLIC_BASE_URL` nicht
mit `https://` beginnt oder `COOKIE_SECURE` nicht `true` ist.

Empfohlen: Caddy als Reverse-Proxy (holt automatisch Let's-Encrypt-Zertifikate):

1. DNS: `api.deine-domain.de` → A/AAAA-Eintrag auf deinen Server.
2. `infra/Caddyfile`: Domain eintragen.
3. `.env`: `PUBLIC_BASE_URL=https://api.deine-domain.de`, `COOKIE_SECURE=true`, `TRUST_PROXY=1`, `NODE_ENV=production`.
4. `docker compose -f docker-compose.yml -f infra/docker-compose.prod.yml up -d --build`.
5. Prüfen: `curl https://api.deine-domain.de/healthz` → `{"status":"ok"}`.

Lokal ohne HTTPS: `PUBLIC_BASE_URL=http://localhost:3000`, `COOKIE_SECURE=false` und die
`localhost`-Redirect-URL in der Roblox-App eintragen.

## Sicherheitsmerkmale des Flows

- `state`: 256 Bit Zufall. Gespeichert wird nur der SHA-256-Hash, Abgleich per eindeutigem Index.
- PKCE `S256`, `code_verifier` 64 Zeichen. Nach Abschluss/Fehler wird er gelöscht (per DB-Constraint erzwungen).
- Browser-Bindung: HttpOnly-Cookie (`__Host-` mit `Secure`), ohne passendes Cookie wird der Callback abgelehnt
  (Schutz vor Login-CSRF / untergeschobenen Codes).
- Einmaligkeit: Statuswechsel `started → exchanging` atomar. Replays und parallele Callbacks scheitern
  mit 409, Roblox wird nur einmal aufgerufen.
- Ablauf: Start-Link 10 min, Autorisierung 10 min. Abgelaufene Sessions werden alle 10 min geschlossen und nach
  24 h gelöscht.
- Die Discord-ID kommt ausschließlich aus der serverseitigen Session.
- Das Client-Secret liegt nur in der API, nicht im Bot und nicht im Roblox-Spiel.
- Doppelte Verknüpfungen verhindern partielle Unique-Indizes in der Datenbank.
