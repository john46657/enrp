# Emden Network

Verwaltungssystem für das Roblox-GermanRP-Spiel **Emden Network**: Discord-Bot, REST-API, Web-Dashboard
(„Emden Network Control Center“), Hintergrund-Worker und Roblox-Integration in einem Repository (Monorepo).

Der Fahrplan steht in [docs/IMPLEMENTIERUNGSPLAN.md](docs/IMPLEMENTIERUNGSPLAN.md).

## Aufbau

| Ordner            | Inhalt                                                                                                        | Stand                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `apps/bot`        | Discord-Bot (Bewerbungen, Tickets, Moderation, Level) – Anleitung in [apps/bot/README.md](apps/bot/README.md) | ✅ läuft (JavaScript, Umstellung auf TypeScript in Phase 5) |
| `apps/api`        | Fastify-REST-API                                                                                              | Phase 1                                                     |
| `apps/dashboard`  | Next.js-Dashboard                                                                                             | Phase 1                                                     |
| `apps/worker`     | Hintergrundjobs                                                                                               | Phase 2                                                     |
| `packages/config` | Gemeinsame TypeScript-Einstellungen                                                                           | ✅                                                          |
| `packages/shared` | Gemeinsamer Code (z. B. Prüfung der Umgebungsvariablen)                                                       | ✅                                                          |
| `roblox/`         | Luau-Skripte für das Spiel                                                                                    | Phase 1                                                     |

## Einmalige Einrichtung auf deinem Rechner

Du brauchst:

1. **Node.js 22.18 oder neuer** – [nodejs.org](https://nodejs.org) (die „LTS“-Version). Prüfen: `node -v`
2. **pnpm** – wird mit Node.js mitgeliefert, du musst es nur einschalten: `corepack enable`. Prüfen: `pnpm -v`
3. **Docker** – für die Datenbank. Windows/Mac: [Docker Desktop](https://www.docker.com/products/docker-desktop/),
   Linux: [Docker Engine](https://docs.docker.com/engine/install/). Prüfen: `docker compose version`
4. **Git** – [git-scm.com](https://git-scm.com)

Dann im Projektordner:

```bash
pnpm install              # lädt alle Abhängigkeiten
cp .env.example .env      # Windows (PowerShell): Copy-Item .env.example .env
pnpm db:up                # startet PostgreSQL im Hintergrund und wartet, bis es bereit ist
pnpm verify               # Lint + Formatierung + Typprüfung + Tests – muss grün sein
```

## Wichtige Befehle

| Befehl                                       | Was er tut                                               |
| -------------------------------------------- | -------------------------------------------------------- |
| `pnpm bot`                                   | Startet den Discord-Bot (braucht `apps/bot/.env`)        |
| `pnpm verify`                                | Alle Prüfungen auf einmal – vor jedem Commit ausführen   |
| `pnpm lint` / `pnpm typecheck` / `pnpm test` | Einzelne Prüfungen                                       |
| `pnpm format`                                | Code automatisch einheitlich formatieren                 |
| `pnpm db:up` / `pnpm db:down`                | Datenbank starten / stoppen (die Daten bleiben erhalten) |
| `pnpm db:psql`                               | SQL-Konsole der Datenbank öffnen (beenden mit `\q`)      |

## Geheimnisse

- Echte Tokens und Passwörter gehören **nur** in `.env`-Dateien. Diese sind in `.gitignore` und landen nie im Git.
- Jede App hat eine `.env.example` als Vorlage, in der jede Variable erklärt ist.
- Das Datenbank-Passwort in `.env.example` ist nur für die Entwicklung auf deinem Rechner gedacht.

## Automatische Prüfung (CI)

Bei jedem Push führt GitHub Actions `pnpm verify` aus ([.github/workflows/ci.yml](.github/workflows/ci.yml)).
Das Ergebnis siehst du auf GitHub im Reiter **Actions** bzw. als ✅/❌ neben dem Commit.
