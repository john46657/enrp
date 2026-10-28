# Produktion und Deployment

> **Noch nicht für den öffentlichen Betrieb gedacht.** Anmeldung und Rechte sind seit Phase 2 vorhanden, die
> Produktionsanleitung (Hosting, Backups, Monitoring, Rollback, Kostenkontrolle) folgt aber erst in Phase 7.
> Es werden keine Dienste angelegt und keine kostenpflichtigen Aktionen ausgelöst, ohne dass du zustimmst.

## Geplante Zielumgebung

| Dienst      | Build                                                          | Start                     | Health Check                                       |
| ----------- | -------------------------------------------------------------- | ------------------------- | -------------------------------------------------- |
| Backend     | `npm ci && npm run build -w @emden/shared -w @emden/api`       | `npm run start:api`       | `GET /health` (Liveness), `GET /ready` (Readiness) |
| Dashboard   | `npm ci && npm run build -w @emden/shared -w @emden/dashboard` | `npm run start:dashboard` | `GET /`                                            |
| PostgreSQL  | verwalteter Dienst (Phase 2)                                   | –                         | –                                                  |
| Discord-Bot | Phase 4                                                        | –                         | –                                                  |

Railway ist eine mögliche Plattform (setzt `PORT` automatisch, was das Backend berücksichtigt), aber keine
Voraussetzung. Jeder Anbieter mit Node.js 22 funktioniert.

## Umgebungsvariablen in Produktion

- `NODE_ENV=production`, `API_HOST=0.0.0.0`
- `CORS_ORIGINS` nur mit `https://`-Ursprüngen (oder leer, da das Dashboard serverseitig zugreift)
- `TRUST_PROXY=true` nur hinter dem Proxy des Hosters
- `API_INTERNAL_URL` im Dashboard auf die interne Adresse des Backends setzen
- Geheimnisse ausschließlich im Secret-Manager des Hosters, nie im Repository
- `DATABASE_URL` (Pflicht), `DASHBOARD_PUBLIC_URL` (Pflicht, HTTPS), `DISCORD_CLIENT_ID`/`DISCORD_CLIENT_SECRET`,
  einmalig `OWNER_DISCORD_USER_ID`
- Im Discord Developer Portal die Redirect-Adresse `https://<dashboard-domain>/api/auth/discord/callback` ergänzen
- **Achtung:** `API_INTERNAL_URL` muss schon beim **Build** des Dashboards gesetzt sein, weil Next.js die
  Weiterleitung `/api/auth/…` beim Bauen festschreibt
- Migrationen vor dem Start der neuen Version: `npm run db:migrate:dist -w @emden/api`
- Rate Limit und Besucher-IP: `TRUST_PROXY` passend zum Proxy des Hosters einstellen (Phase 7)

## Vorgesehen für Phase 7

Datenbank-Backups und Wiederherstellungstest, Migrationen vor dem Start der neuen Version,
Log-Aufbewahrung und Fehlerüberwachung, Secret-Rotation, Rollback auf die vorherige Version,
Budget-Grenzen beim Hoster, Produktionscheckliste.
