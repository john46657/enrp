# Emden Network

Roblox-Servermanagement-Plattform für das Emden Network GermanRP-Spiel: Web-Dashboard
(**Emden Network Control Center**), REST-Backend (**Emden Network Backend**), Discord-Bot und
TikTok-LIVE-Modul.

> **Stand: Phase 1 – Grundgerüst.** Backend mit Health-/Readiness-Endpunkten und Dashboard-Grundlayout
> sind umgesetzt und getestet. Alles Weitere ist **geplant** und im Dashboard als „Geplant“ markiert.
> Es gibt noch **keine Anmeldung** – das Dashboard daher nur lokal betreiben, nicht öffentlich.

## Umfang und Ausbaustand

| Phase | Inhalt                                                                         | Status       |
| ----- | ------------------------------------------------------------------------------ | ------------ |
| 1     | Projektstruktur, Fastify-Health-Endpunkte, Dashboard-Grundlayout, Tests, CI    | ✅ umgesetzt |
| 2     | PostgreSQL, Migrationen, Anmeldung, Rollen (Owner bis Viewer), Audit-Logs      | 🕓 geplant   |
| 3     | Roblox-Integration: authentifizierte Heartbeats, Serverübersicht, Luau-Skripte | 🕓 geplant   |
| 4     | Discord-Bot (`apps/bot`) mit Slash-Commands und Benachrichtigungen             | 🕓 geplant   |
| 5     | Discord Security Center                                                        | 🕓 geplant   |
| 6     | TikTok LIVE Center (Provider-Schnittstelle, manuelle Fallbacks)                | 🕓 geplant   |
| 7     | Deployment, Backups, Monitoring, Produktionscheckliste                         | 🕓 geplant   |

Nicht im Umfang: Dispatch-/Leitstellensystem sowie Personal- oder Ausbildungssystem.

## Projektstruktur

```
apps/
  api/          Emden Network Backend (Fastify, TypeScript)
  dashboard/    Emden Network Control Center (Next.js, React, TypeScript)
packages/
  shared/       Gemeinsame Typen, Zod-Schemas, Navigationsdefinition
docs/           Architektur, Einrichtung, Tests, Sicherheit, Deployment
legacy/
  discord-bot/  Bisheriger ENRP-Discord-Bot (unverändert verschoben, siehe legacy/README.md)
```

Geplant, aber noch nicht angelegt: `apps/bot` (Phase 4), `apps/worker` (bei Bedarf), `roblox/` (Phase 3).

## Schnellstart

Voraussetzung: **Node.js 22.12 oder neuer** (`node -v`).

```bash
npm install                 # Abhängigkeiten aller Workspaces installieren
cp .env.example .env        # Konfiguration anlegen (enthält nur Platzhalter)
npm run dev:api             # Terminal 1: Backend auf http://127.0.0.1:4000
npm run dev:dashboard       # Terminal 2: Dashboard auf http://localhost:3000
```

Ausführlich: [docs/local-setup.md](docs/local-setup.md).

## Wichtige Befehle

| Befehl              | Zweck                                                      |
| ------------------- | ---------------------------------------------------------- |
| `npm run check`     | Alles prüfen: Formatierung, Lint, TypeScript, Tests, Build |
| `npm test`          | Tests (Vitest)                                             |
| `npm run lint`      | ESLint                                                     |
| `npm run typecheck` | TypeScript-Prüfung aller Workspaces                        |
| `npm run format`    | Code mit Prettier formatieren                              |
| `npm run build`     | Produktions-Build aller Workspaces                         |

## Dokumentation

- [Architektur](docs/architecture.md)
- [Lokale Einrichtung](docs/local-setup.md)
- [API](docs/api.md)
- [Datenbank & Migrationen](docs/database.md) (Phase 2)
- [Tests](docs/testing.md)
- [Sicherheit](docs/security.md)
- [Produktion & Deployment](docs/deployment.md)
