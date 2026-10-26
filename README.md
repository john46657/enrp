# Emden Network

Discord-Bot, Backend-API und Roblox-Integration für das deutsche Roleplay-Spiel **Emden Network**
mit den Fraktionen Polizei, Feuerwehr, Rettungsdienst und Zivilisten.

Kern ist eine **Roblox-Account-Verifizierung über OAuth 2.0 (Authorization Code Flow mit PKCE)**. Nach
erfolgreicher Verknüpfung vergibt der Bot automatisch die Discord-Rolle **Verifiziert** und sonst nichts.
Fraktionsrollen bleiben manuell.

> Der frühere FiveM-Bot liegt unverändert unter [`legacy/discord-bot-v1`](legacy/discord-bot-v1/README.md).
> Er ist nicht Teil des neuen Systems und wird nicht weiterentwickelt.

## Funktionsumfang (Stand dieses Commits)

| Bereich | Status |
|---|---|
| Roblox-OAuth-Verifizierung (PKCE S256, state, Browser-Bindung, Einmal-Sessions), Rolle „Verifiziert“ mit Wiederholungen | ✅ umgesetzt und getestet |
| Zentrale Berechtigungen, Audit-Log, Datenbankmigrationen für alle Tabellen | ✅ |
| Spielerprofile, Spiel-/Dienstzeit, `/unlink`, `/privacy` | ✅ |
| Fraktionen & Ränge (`/faction …`) | ✅ |
| Dienstsystem (`/duty …`, Spiel und Discord, Korrektur, CSV-Export) | ✅ |
| Moderation: `/warn`, `/timeout`, `/case view`, `/gamekick`, `/gameban` | ✅ |
| Game-API: Heartbeat, idempotente Spielereignisse, kontrollierte Admin-Aufträge, Wartungsmodus | ✅ |
| Serverseitige Luau-Integration (Heartbeat, Join/Leave, Dienst, Ankündigungen, Kick/Ban) | ✅ geschrieben, ⚠️ **nicht in Roblox Studio getestet** |
| Bewerbungen, Ausbildungen, Tickets, `/report`, `/case appeal`, Spielevents | 🗂️ Tabellen und Rechte vorhanden, Commands offen |
| Web-Dashboard, Redis-Queue | 🗂️ vorbereitet (Phase 6) |

Details und offene Punkte: [docs/roadmap.md](docs/roadmap.md).

## Schnellstart (lokal)

Voraussetzungen: Node.js ≥ 22.12 (empfohlen 24 LTS), pnpm 10, Docker (oder lokales PostgreSQL ≥ 16).

```bash
cp .env.example .env            # Werte eintragen, siehe unten
pnpm install
docker compose up -d postgres   # oder eigenes PostgreSQL
pnpm db:migrate                 # DATABASE_URL aus .env
pnpm bot:register               # Slash-Commands auf deinem Server registrieren
pnpm dev:api                    # API auf http://localhost:3000
pnpm dev:bot                    # Discord-Bot
```

Komplett in Docker: `docker compose up -d --build` (führt Migrationen automatisch aus).

Welche Werte du selbst erzeugen musst:

| Wert | Wo | Anleitung |
|---|---|---|
| `DISCORD_TOKEN`, `DISCORD_APPLICATION_ID`, `DISCORD_GUILD_ID` | Discord Developer Portal | [docs/einrichtung-discord.md](docs/einrichtung-discord.md) |
| `ROBLOX_OAUTH_CLIENT_ID`, `ROBLOX_OAUTH_CLIENT_SECRET`, Redirect-URI | Roblox Creator Hub → OAuth 2.0 Apps | [docs/einrichtung-roblox-oauth.md](docs/einrichtung-roblox-oauth.md) |
| `GAME_API_KEY` (+ Roblox-Secret), `ALLOWED_PLACE_IDS` | selbst erzeugen / Creator Hub | [docs/roblox-integration.md](docs/roblox-integration.md) |
| `INTERNAL_API_TOKEN`, `POSTGRES_PASSWORD`, `APP_DB_PASSWORD` | selbst erzeugen (`openssl rand -hex 32`) | – |

Nach dem ersten Start auf dem Discord-Server (als Server-Eigentümer):

```
/system config role schluessel:Verifiziert rolle:@Verifiziert
/system config role schluessel:Owner rolle:@Owner
/system config role schluessel:Management rolle:@Management
… (Polizeileitung, Feuerwehrleitung, Rettungsdienstleitung, Moderator, Fraktionsmitglied, Unverified)
```

Die Bot-Rolle muss in der Rollenliste **über** „Verifiziert“ und „Unverified“ stehen und die Berechtigung
„Rollen verwalten“ besitzen (für `/timeout` zusätzlich „Mitglieder moderieren“).

## Projektstruktur

```
apps/api            Fastify-Backend: OAuth-Callback, Game-API, Profile, Hintergrundaufgaben
apps/bot            discord.js-Bot: Slash-Commands, Buttons, Outbox-Worker (Rollenvergabe)
apps/dashboard      Platzhalter für das spätere Next.js-Dashboard (Phase 6)
packages/shared     Gemeinsame Typen, Zod-Schemas, Berechtigungsmatrix, Fehlercodes
packages/database   PostgreSQL-Pool, Transaktionen, Migrationsrunner, SQL-Migrationen
packages/core       Geschäftslogik: Verifizierung, Fraktionen, Dienst, Spiel, Moderation, Audit, Outbox
roblox/             Serverseitige Luau-Skripte (+ eine reine Anzeige-LocalScript), Rojo-Projekt
tests/              Unit- und Integrationstests (Vitest) inkl. Roblox-OAuth-Mock-Server
infra/              Postgres-Init, Caddy (HTTPS), Produktions-Compose, Backup-/Restore-Skripte
docs/               Architektur, API, Rechte, Einrichtung, Betrieb, Datenschutz, Tests
legacy/             Alter FiveM-Bot (unverändert)
```

## Dokumentation

- [Architektur](docs/architektur.md)
- [API-Vertrag](docs/api.md)
- [Rollen & Berechtigungen](docs/berechtigungen.md)
- [Discord-App einrichten](docs/einrichtung-discord.md)
- [Roblox OAuth einrichten (inkl. HTTPS & Redirect-URI)](docs/einrichtung-roblox-oauth.md)
- [Roblox-Spielintegration](docs/roblox-integration.md)
- [Betrieb: Deployment, Backups, Monitoring, Fehlerbehebung](docs/betrieb.md)
- [Sicherheit](docs/sicherheit.md)
- [Datenschutz & Aufbewahrung](docs/datenschutz.md)
- [Tests](docs/tests.md)
- [Roadmap & offene Punkte](docs/roadmap.md)

## Verwendete Versionen

| Komponente | Version |
|---|---|
| Node.js | ≥ 22.12 (lokal getestet mit 22.22; Docker-Image `node:24-alpine`) |
| pnpm | 10.28 |
| TypeScript | 7.0.2 |
| discord.js | 14.27.0 |
| Fastify | 5.12.7 (`@fastify/helmet` 13.2, `@fastify/rate-limit` 11.2, `@fastify/cookie` 11.1) |
| Zod | 4.6.7 |
| pg (node-postgres) | 8.23.1 |
| PostgreSQL | 16 (Tests), 17 (Docker Compose) |
| pino | 10.4.0 |
| Vitest | 5.0.5 |
| Redis | 7 (optional, Profil `redis`, derzeit ungenutzt) |

## Befehle

| Befehl | Zweck |
|---|---|
| `pnpm test` | Alle Tests (benötigt PostgreSQL, siehe [docs/tests.md](docs/tests.md)) |
| `pnpm typecheck` / `pnpm build` | TypeScript prüfen / nach `dist/` bauen |
| `pnpm db:migrate` / `pnpm db:status` | Migrationen anwenden / Status |
| `pnpm bot:register` | Slash-Commands registrieren |
| `pnpm docs:permissions` | Berechtigungsmatrix in der Doku aktualisieren |
