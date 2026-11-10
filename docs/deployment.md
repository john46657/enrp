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
- Nur das Dashboard (Port 3000) wird veröffentlicht; davor ein Reverse Proxy mit TLS – eingebaut als Caddy
  (`--profile caddy`, `deploy/Caddyfile`) oder ein eigener (Traefik, nginx).
  `PUBLIC_URL` und `DASHBOARD_URL` = öffentliche HTTPS-Adresse; `TRUST_PROXY=true`.
- Worker-Image enthält `pg_dump`/`pg_restore` 16; Backups auf ein eigenes Volume (`BACKUP_HOST_DIR`).
- Bot-Volume `legacy/data` enthält die Daten der Altmodule.

## Erstinstallation auf einem VPS (Schritt für Schritt)

Für Einsteiger: ein Linux-Server (z. B. Hetzner CX22 oder Netcup, Ubuntu 24.04, 2 vCPU / 4 GB RAM) und eine
eigene Domain.

1. **Domain:** Beim Domain-Anbieter einen A-Eintrag (und ggf. AAAA) für z. B. `panel.deine-domain.de` auf die
   IP-Adresse des Servers setzen.
2. **Server vorbereiten** (als root per SSH):
   ```bash
   apt update && apt upgrade -y
   curl -fsSL https://get.docker.com | sh
   ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443 && ufw enable
   mkdir -p /opt/enrp/deploy /srv/enrp-backups && cd /opt/enrp
   ```
3. **Dateien kopieren:** `docker-compose.prod.yml`, `deploy/Caddyfile` und `.env.example` (als `.env`) nach
   `/opt/enrp`. In `.env` mindestens eintragen: `ENRP_DOMAIN=panel.deine-domain.de`,
   `PUBLIC_URL`/`DASHBOARD_URL=https://panel.deine-domain.de`, `POSTGRES_PASSWORD`,
   `DATABASE_URL=postgres://enrp:<POSTGRES_PASSWORD>@postgres:5432/enrp`, `REDIS_URL=redis://redis:6379`,
   `GHCR_OWNER`, alle Geheimnisse (`openssl rand -base64 48`), Discord-/Roblox-Zugangsdaten (siehe
   [setup.md](setup.md)).
4. **Starten** (Version = veröffentlichter Image-Tag):
   ```bash
   ENRP_VERSION=1.0.0 docker compose -f docker-compose.prod.yml --profile caddy up -d
   ```
   Caddy holt automatisch ein Let's-Encrypt-Zertifikat. Prüfen: `https://panel.deine-domain.de/api/v1/status`.
5. **Roblox:** In `roblox/src/ServerScriptService/ENRP/Config.lua` `ApiBaseUrl = "https://panel.deine-domain.de"`,
   Secret-Domain im Creator Hub ebenfalls auf diese Domain.
6. **Aktualisieren:**
   ```bash
   ENRP_VERSION=1.1.0 docker compose -f docker-compose.prod.yml --profile caddy pull
   ENRP_VERSION=1.1.0 docker compose -f docker-compose.prod.yml --profile caddy up -d
   ```
   Die API führt Migrationen beim Start aus. Vorher ein Backup erstellen (Dashboard → Backups).
7. **Backups:** Der Worker sichert täglich nach `/srv/enrp-backups` und prüft jede Sicherung durch eine
   Test-Wiederherstellung. Dieses Verzeichnis zusätzlich auf einen anderen Speicher kopieren (z. B. Storage Box).
   Wiederherstellen: siehe [operations.md](operations.md#wiederherstellung).
8. **Logs:** `docker compose -f docker-compose.prod.yml logs -f api` (ebenso `worker`, `bot`, `dashboard`, `caddy`).

Wer bereits einen eigenen Reverse Proxy (Traefik, nginx) betreibt, lässt `--profile caddy` weg und leitet auf
`127.0.0.1:3000` weiter. Der Deploy-Workflow startet ohne Profil; ein laufender Caddy bleibt dabei unverändert.

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
