# ENRP – GermanRP-Plattform

Discord-Bot, Backend-API, Hintergrund-Worker, Web-Dashboard und Roblox-Integration für einen deutschen
Roblox-Roleplay-Server (Polizei, Feuerwehr, Rettungsdienst, Zivilisten). Alle Teile nutzen dieselbe
Geschäftslogik, dieselbe Rechteprüfung und dasselbe unveränderliche Audit-Log.

```
apps/api         Fastify-REST-API (/api/v1, OpenAPI)          ─┐
apps/worker      BullMQ-Worker (Discord-Aktionen, Backups …)   ├─ nutzen packages/core
apps/bot         Discord-Bot (discord.js, spricht nur mit der API)
apps/dashboard   Next.js-Dashboard (spricht nur mit der API)
packages/core         Geschäftslogik (Audit, Rechte, Freigaben, alle Fachmodule)
packages/database     Drizzle-Schema, Migrationen, Seed
packages/permissions  Berechtigungskatalog, RBAC-Auswertung, Schutz gegen Rechteausweitung
packages/integrations Discord-REST, BullMQ, Echtzeit (Redis Pub/Sub)
packages/shared       Gemeinsame Typen, Enums, Fehlerformat, API-Client
packages/config       Validierte Umgebungsvariablen, Logger
roblox/          Luau-Skripte für den Spielserver
tests/integration Integrationstests gegen echtes PostgreSQL
docs/            Architektur, Sicherheit, Betrieb, Deployment, API
```

## Schnellstart (Entwicklung)

Voraussetzungen: Node.js 22, pnpm 10, Docker (oder lokales PostgreSQL 16 + Redis 7).

```bash
cp .env.example .env              # Werte eintragen, Geheimnisse mit: openssl rand -base64 48
docker compose up -d postgres redis
pnpm install
pnpm db:migrate && pnpm db:seed   # Schema + Grunddaten (Rollen, Fraktionen, Flags, Umgebungen)
pnpm --filter @enrp/api dev       # http://localhost:4000, API-Doku unter /api/docs
pnpm --filter @enrp/worker dev
pnpm --filter @enrp/dashboard dev # http://localhost:3000 (leitet /api an die API weiter)
pnpm --filter @enrp/bot dev       # braucht DISCORD_BOT_TOKEN und DISCORD_GUILD_ID
```

Erster Zugang: Die Discord-IDs in `OWNER_DISCORD_IDS` haben Vollzugriff. Im Dashboard unter
*Bot-Verwaltung → Rollen & Rechte* weitere Rollen an Discord-Rollen binden.

Prüfen: `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test` (Integrationstests brauchen
`TEST_DATABASE_URL`, Standard `postgres://enrp:enrp@localhost:5432/enrp_test`).

## Dokumentation

| Thema | Datei |
|---|---|
| Einrichtung, Umgebungsvariablen, Discord-/Roblox-Apps | [docs/setup.md](docs/setup.md) |
| Architektur und Entscheidungen | [docs/architecture.md](docs/architecture.md) |
| Datenmodell, Löschregeln, Aufbewahrung | [docs/data-model.md](docs/data-model.md) |
| Rollen, Rechte, Vier-Augen-Prinzip | [docs/permissions.md](docs/permissions.md) |
| Discord-Bot (Befehle, Altmodule) | [docs/bot.md](docs/bot.md) · Altmodule: [apps/bot/legacy/README.md](apps/bot/legacy/README.md) |
| API-Endpunkte (generiert) | [docs/api-endpunkte.md](docs/api-endpunkte.md) · [docs/openapi.json](docs/openapi.json) |
| Sicherheit | [docs/security.md](docs/security.md) |
| Betrieb, Backups, Notfallplan | [docs/operations.md](docs/operations.md) |
| Deployment (Docker, CI/CD, Staging/Produktion) | [docs/deployment.md](docs/deployment.md) |
| Roblox-Integration | [roblox/README.md](roblox/README.md) · Test auf dem eigenen PC: [docs/roblox-test.md](docs/roblox-test.md) |

## Stand der Umsetzung

Ehrliche Übersicht, was in dieser Umgebung tatsächlich geprüft wurde. „Getestet“ heißt: automatisierte Tests
gegen echtes PostgreSQL/Redis bzw. manueller Start der gebauten Dienste.

| Bereich | Stand |
|---|---|
| Datenbank, Migrationen, Seed | ✅ implementiert, getestet (inkl. Audit-Schutz-Trigger) |
| Rechte (RBAC, Fraktionsbeschränkung, Schutz gegen Rechteausweitung, Befehls-Overrides) | ✅ Unit- und Integrationstests |
| Audit-Log mit Hash-Kette, Manipulationserkennung | ✅ getestet |
| Vier-Augen-Freigaben (Selbstfreigabe, Ablauf, einmalige Ausführung) | ✅ getestet |
| Verifizierung (Discord-Bestätigung + Roblox-OAuth mit PKCE, nur Rolle „Verifiziert“) | ✅ Ende-zu-Ende gegen OAuth-Attrappen getestet; mit echten Discord-/Roblox-Apps **nicht** getestet (keine Zugangsdaten) |
| Dashboard-Login, Sitzungen, CSRF | ✅ getestet (OAuth-Attrappe) |
| Fraktionen, Dienstsystem, Spielzeit, Korrekturen | ✅ getestet |
| Fahrzeuge, Tickets (inkl. Spiegelung des Discord-Ticketpanels), Reports, Fallberichte | ✅ Kernlogik getestet |
| Moderation, Einsprüche, Roblox-Banns über Spielserver | ✅ Logik getestet; Discord-Ausführung gegen Discord-Attrappe |
| Community (Vorschläge, Umfragen, Giveaways, Ankündigungen, Regelwerk, Codes) | ✅ getestet (inkl. paralleler Code-Einlösung) |
| Roblox-API (Heartbeat, Ereignisse, Replay-Schutz, Idempotenz) | ✅ API-seitig getestet |
| Servertyp (öffentlich/privat/reserviert), Server-Befehle (Nachricht, Herunterfahren), Open-Cloud-Weckruf | ✅ API- und Integrationstests; Weckruf gegen Attrappe, mit echtem Open-Cloud-Schlüssel **nicht** getestet |
| Statistiken (Spieler pro Stunde, Spitzenzeiten, Moderation, Ticket-Bearbeitungszeiten) | ✅ Integrationstest; Dashboard-Seite gebaut, im Browser **nicht** durchgeklickt |
| Discord-Sicherheit: Schutz vor Massenlöschung, Lockdown (Altmodule) | ✅ Tests mit nachgebauten Discord-Objekten; mit echtem Discord-Server **nicht** getestet |
| Roblox-Luau-Skripte | ⚠️ geschrieben, **nicht** in Roblox Studio ausgeführt – Testcheckliste in roblox/README.md |
| Worker: Backups (pg_dump/pg_restore, Prüfsumme, Test-Wiederherstellung), Watchdogs, Aufbewahrung | ✅ gegen echtes PostgreSQL/Redis getestet |
| Discord-Bot | ✅ Build, Befehlsregistrierung und Rechtekatalog geprüft, Start bis zum Login geprüft; mit echtem Discord-Server **nicht** getestet |
| Dashboard | ✅ Build, alle Seiten kompiliert, Oberfläche im Browser (Desktop/Mobil) gegen laufende API geprüft |
| Caddy (HTTPS) in `docker-compose.prod.yml` | ⚠️ Compose-Datei geprüft (`docker compose config`), Caddyfile mangels Caddy-Binary **nicht** validiert |
| Docker-Images | ⚠️ Dockerfile geschrieben; Build-Schritte (Bundles, `pnpm deploy`, Next standalone) einzeln geprüft, `docker build` selbst mangels Docker-Daemon **nicht** ausgeführt |
| CI/CD (GitHub Actions) | ⚠️ Workflows geschrieben, noch nicht auf GitHub gelaufen |
| Release-Pipeline-Anbindung | ⚠️ Anstoß per `workflow_dispatch` implementiert, braucht `GITHUB_DEPLOY_*` und einen Zielserver |

Externe Voraussetzungen, die noch fehlen: Discord-Anwendung (Bot-Token, OAuth-Client), Roblox-OAuth-App
und Secret im Roblox Creator Hub, Produktionsserver mit TLS, GitHub-Environments `staging`/`production`.
