# Einrichtung

## 1. Discord-Anwendung

1. [Developer Portal](https://discord.com/developers/applications) → *New Application*.
2. **Bot**: Token erzeugen → `DISCORD_BOT_TOKEN`. Privileged Intents **Server Members** und **Message Content**
   aktivieren (Message Content nur für die Altmodule Ticket-Transkripte und Bewerbungen per DM).
3. **OAuth2**: Client-ID/-Secret → `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`. Redirects eintragen:
   - `<PUBLIC_URL>/api/v1/auth/discord/callback` (Dashboard-Login)
   - `<PUBLIC_URL>/api/v1/verification/discord/callback` (Identitätsbestätigung bei /verify)
4. Bot einladen: Scopes `bot applications.commands`. Benötigte Rechte: Rollen verwalten, Mitglieder kicken,
   Mitglieder bannen, Mitglieder im Timeout, Nachrichten senden/verwalten, Kanäle verwalten (Ticketpanel).
   Die Bot-Rolle muss **über** „Verifiziert“, den Fraktionsrollen und allen moderierten Rollen stehen.

## 2. Roblox-OAuth-App

[Creator Hub → OAuth 2.0 Apps](https://create.roblox.com/dashboard/credentials) → App anlegen:
- Redirect-URL: `<PUBLIC_URL>/api/v1/verification/roblox/callback`
- Scopes: **openid**, **profile** (mehr wird nicht benötigt)
- Client-ID/-Secret → `ROBLOX_CLIENT_ID`, `ROBLOX_CLIENT_SECRET`

## 3. Umgebungsvariablen

Vollständige Vorlage: [`.env.example`](../.env.example). Alle Dienste validieren ihre Variablen beim Start und
nennen bei Fehlern nur die Variablennamen (nie die Werte).

| Variable | Dienst | Bedeutung |
|---|---|---|
| `APP_ENV` | alle | `development`, `staging`, `production` (Produktion erzwingt HTTPS, Redis, sichere Cookies) |
| `DATABASE_URL` | API, Worker | PostgreSQL-Verbindung |
| `REDIS_URL` | API, Worker | Rate-Limits, Warteschlangen, Echtzeit (in Produktion Pflicht) |
| `PUBLIC_URL` | API | Öffentliche Adresse, unter der `/api` erreichbar ist (OAuth-Redirects) |
| `DASHBOARD_URL` | API | Adresse des Dashboards (Weiterleitung nach Login, CORS/Origin-Prüfung) |
| `BOT_API_TOKEN` | API, Bot | Gemeinsames Service-Token (≥ 32 Zeichen) |
| `HASH_SECRET` | API, Worker | HMAC-Geheimnis für Code- und IP-Hashes (≥ 32 Zeichen, nie ändern ohne Plan) |
| `OWNER_DISCORD_IDS` | API, Worker | Notfall-/Erstzugang mit Vollrechten |
| `DISCORD_*` | API, Worker, Bot | siehe oben; `DISCORD_GUILD_ID` = Server-ID |
| `VERIFIED_ROLE_ID` | API, Worker | Rolle „Verifiziert“ (alternativ im Dashboard → Konfiguration) |
| `ROBLOX_CLIENT_*` | API | Roblox-OAuth |
| `API_URL` | Bot, Dashboard | Interne API-Adresse (z. B. `http://api:4000`) |
| `TRUST_PROXY` | API | `true` hinter Reverse Proxy (korrekte Client-IPs für Rate-Limits) |
| `METRICS_TOKEN` | API | Bearer-Token für `/metrics` (Prometheus); ohne Token ist der Endpunkt aus |
| `RELEASE_WEBHOOK_SECRET` | API | Geheimnis für Rückmeldungen der Deploy-Pipeline |
| `BACKUP_DIR`, `BACKUP_CRON`, `BACKUP_RETENTION_DAYS` | Worker | Backup-Ziel (eigenes Volume), Zeitplan (UTC), Aufbewahrung |
| `RESTORE_TEST_DATABASE_URL` | Worker | Scratch-Datenbank für automatische Wiederherstellungstests |
| `RESTORE_TARGET_*_URL`, `ALLOW_PRODUCTION_RESTORE` | Worker | Ziele für freigegebene Wiederherstellungen |
| `GITHUB_DEPLOY_REPO/TOKEN/WORKFLOW/REF` | Worker | Anstoß der Deploy-Pipeline nach Freigabe |
| `LEGACY_MODULES` | Bot | Altmodule laden (Standard `true`) |

## 4. Erste Schritte nach dem Start

1. Mit einem Owner-Konto im Dashboard anmelden.
2. *Rollen & Rechte*: Plattform-Rollen an Discord-Rollen binden (z. B. Moderation → Rolle „Mod-Team“).
   Für die Fraktionsverwaltung Rechte mit Fraktionsbeschränkung vergeben (`factions:edit@<fraktions-id>`).
3. *Konfiguration*: Benachrichtigungskanäle, Rolle „Verifiziert“, Dienst-Parameter, Aufbewahrungsfristen.
4. *Fraktionen*: optional Discord-Rollen je Fraktion hinterlegen.
5. *Roblox-Server*: API-Schlüssel erzeugen und gemäß [roblox/README.md](../roblox/README.md) einrichten.
6. *Regelwerk*, *Begrüßung*, *Automatisierungen* nach Bedarf.

## Altmodule des bisherigen Bots

Bewerbungen, Ticketpanel, Level-System, Rollenpanel, `/einstellungen` und `/clear` laufen unverändert weiter
(Konfiguration in `apps/bot/legacy/config.json`, Daten in `apps/bot/legacy/data/db.json`). Bestehende
`data/db.json` aus der alten Installation nach `apps/bot/legacy/data/` kopieren. Details: [docs/bot.md](bot.md).
