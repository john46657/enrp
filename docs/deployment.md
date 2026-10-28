# Deployment

## Umgebungen

| Umgebung | Zweck | Daten |
|---|---|---|
| development | lokal | Testdaten |
| staging | Abnahme vor Produktion | eigene Datenbank, **keine** ungeschützten Produktionsdaten, eigene Discord-Testanwendung und eigener Roblox-Schlüssel |
| production | Livebetrieb | eigene Geheimnisse; Releases nur nach Vier-Augen-Freigabe |

Jede API-Instanz meldet beim Start Version und nicht geheime Konfiguration ihrer Umgebung
(`/env status`, `/env compare`). Produktionsgeheimnisse gehören ausschließlich in die Produktionsumgebung
(GitHub-Environment-Secrets bzw. `.env` auf dem Zielserver).

## Container

```bash
docker build --target api -t enrp-api .        # ebenso: worker, bot, dashboard
docker compose --profile app up -d             # komplette lokale Umgebung
```

- API führt mit `RUN_MIGRATIONS=true` beim Start Migrationen und den (idempotenten) Seed aus.
- Nur das Dashboard (Port 3000) wird veröffentlicht; davor ein Reverse Proxy mit TLS (Caddy, Traefik, nginx).
  `PUBLIC_URL` und `DASHBOARD_URL` = öffentliche HTTPS-Adresse; `TRUST_PROXY=true`.
- Worker-Image enthält `pg_dump`/`pg_restore` 16; Backups auf ein eigenes Volume (`BACKUP_HOST_DIR`).
- Bot-Volume `legacy/data` enthält die Daten der Altmodule.

## CI/CD

- **CI** (`.github/workflows/ci.yml`): Lint, Format, Typecheck, Prüfung der Altmodule, `pnpm audit`,
  Unit- und Integrationstests gegen PostgreSQL-Service, Build aller Dienste und Container.
- **Deploy** (`.github/workflows/deploy.yml`): nur per `workflow_dispatch` – angestoßen vom Worker nach
  freigegebenem Release (`/deploy approve`) oder manuell. Baut und veröffentlicht Images (GHCR), rollt per SSH
  mit `docker-compose.prod.yml` aus, prüft `/api/v1/status` und meldet das Ergebnis an die Plattform.

Einrichtung auf GitHub:
1. Environments `staging` und `production` anlegen; für `production` erforderliche Reviewer aktivieren.
2. Je Environment: Secrets `DEPLOY_SSH_KEY`, `RELEASE_WEBHOOK_SECRET`; Variablen `DEPLOY_HOST`, `DEPLOY_USER`, `PLATFORM_URL`.
3. Im Worker: `GITHUB_DEPLOY_REPO`, `GITHUB_DEPLOY_TOKEN` (fein granular, nur „Actions: write“ für dieses Repo).
4. Auf dem Zielserver: `/opt/enrp/docker-compose.prod.yml` und `.env` (inkl. `GHCR_OWNER`, `POSTGRES_PASSWORD`).

## Release-Ablauf

1. `/deploy prepare version:1.4.0 umgebung:staging` (oder Dashboard).
2. Eine **andere** Person: `/deploy approve id:<nr>`.
3. Worker stößt die Pipeline an; Status „wird ausgerollt“ → „ausgerollt“/„fehlgeschlagen“.
4. Automatisierung `release_deployed` kann einen Health-Check anstoßen.
5. Promotion: `/env promote` bereitet die Staging-Version für Produktion vor (wieder mit Freigabe).
6. Rollback: `/deploy rollback version:<alte version>` – baut den Git-Tag `v<version>` neu und rollt ihn aus.
   Datenbankmigrationen sind vorwärtsgerichtet; vor riskanten Migrationen ein geprüftes Backup erstellen.

## Upgrade vom bisherigen Bot

1. Neue Plattform aufsetzen (Datenbank, API, Worker, Dashboard).
2. Alte `config.json` → `apps/bot/legacy/config.json`, alte `data/db.json` → `apps/bot/legacy/data/db.json`.
3. Alten Bot stoppen, neuen Bot mit demselben Token starten (registriert alle Befehle neu).
