# Emden Network

Roblox-Servermanagement-Plattform für das Emden Network GermanRP-Spiel: Web-Dashboard
(**Emden Network Control Center**), REST-Backend (**Emden Network Backend**), Discord-Bot und
TikTok-LIVE-Modul.

> **Stand: Phase 2 abgeschlossen.** Grundgerüst, PostgreSQL mit Migrationen, Anmeldung mit Discord,
> Rollen (Owner bis Viewer) mit Berechtigungen und Audit-Log sind umgesetzt und getestet. Alles Weitere ist
> **geplant** und im Dashboard als „Geplant“ markiert. Für den Betrieb im Internet fehlt noch Phase 7
> (Hosting, Backups, Monitoring) – bis dahin nur lokal betreiben.

## Umfang und Ausbaustand

| Phase | Inhalt                                                                               | Status       |
| ----- | ------------------------------------------------------------------------------------ | ------------ |
| 1     | Projektstruktur, Fastify-Health-Endpunkte, Dashboard-Grundlayout, Tests, CI          | ✅ umgesetzt |
| 2     | PostgreSQL, Migrationen, Anmeldung mit Discord, Rollen (Owner bis Viewer), Audit-Log | ✅ umgesetzt |
| 3     | Roblox-Integration: authentifizierte Heartbeats, Serverübersicht, Luau-Skripte       | 🕓 geplant   |
| 4     | Discord-Bot (`apps/bot`) mit Slash-Commands und Benachrichtigungen                   | 🕓 geplant   |
| 5     | Discord Security Center                                                              | 🕓 geplant   |
| 6     | TikTok LIVE Center (Provider-Schnittstelle, manuelle Fallbacks)                      | 🕓 geplant   |
| 7     | Deployment, Backups, Monitoring, Produktionscheckliste                               | 🕓 geplant   |

Nicht im Umfang: Dispatch-/Leitstellensystem sowie Personal- oder Ausbildungssystem.

## Projektstruktur

```
apps/
  api/          Emden Network Backend (Fastify, TypeScript)
  dashboard/    Emden Network Control Center (Next.js, React, TypeScript)
  bot/          Discord-Bot – Platzhalter, geplant für Phase 4/5
  worker/       Hintergrundjobs – Platzhalter, optional
packages/
  shared/       Gemeinsame Typen, Zod-Schemas, Navigationsdefinition
roblox/         Serverseitige Luau-Skripte – Platzhalter, geplant für Phase 3
docs/           Architektur, Einrichtung, Tests, Sicherheit, Deployment
legacy/
  discord-bot/  Bisheriger ENRP-Discord-Bot (unverändert verschoben, siehe legacy/README.md)
```

Die Platzhalter-Ordner enthalten bisher nur eine README mit dem geplanten Umfang, noch keinen Code.

## Schnellstart

> **Neu dabei oder auf einem Mac?** Die Schritt-für-Schritt-Anleitung von der Installation der Werkzeuge
> bis zum ersten Start steht in [docs/mac-setup.md](docs/mac-setup.md).

Voraussetzung: **Node.js 22.12 oder neuer** (getestet mit Node.js 22 und 24 LTS, prüfen mit `node -v`).

```bash
npm install                 # Abhängigkeiten aller Workspaces installieren
cp -n .env.example .env     # Konfiguration anlegen (überschreibt keine vorhandene .env)
npm run dev:api             # Terminal 1: Backend auf http://127.0.0.1:4000
npm run dev:dashboard       # Terminal 2: Dashboard auf http://127.0.0.1:3000
```

Beide Entwicklungsserver sind absichtlich nur auf dem eigenen Rechner erreichbar (`127.0.0.1`).
Eine Datenbank musst du nicht installieren: Lokal läuft automatisch PGlite (echtes PostgreSQL als WebAssembly).

**Anmeldung einrichten:** Einmalig eine Discord-Anwendung anlegen und drei Werte in die `.env` eintragen –
Schritt für Schritt in [docs/discord-login.md](docs/discord-login.md).
Ausführlich: [docs/local-setup.md](docs/local-setup.md).

## Wichtige Befehle

| Befehl               | Zweck                                                      |
| -------------------- | ---------------------------------------------------------- |
| `npm run check`      | Alles prüfen: Formatierung, Lint, TypeScript, Tests, Build |
| `npm test`           | Tests (Vitest)                                             |
| `npm run lint`       | ESLint                                                     |
| `npm run typecheck`  | TypeScript-Prüfung aller Workspaces                        |
| `npm run format`     | Code mit Prettier formatieren                              |
| `npm run build`      | Produktions-Build aller Workspaces                         |
| `npm run db:migrate` | Datenbankmigrationen anwenden (siehe docs/database.md)     |

## Dokumentation

- [Architektur](docs/architecture.md)
- [Einrichtung auf dem Mac (für Einsteiger)](docs/mac-setup.md)
- [Anmeldung mit Discord einrichten](docs/discord-login.md)
- [Lokale Einrichtung](docs/local-setup.md)
- [API](docs/api.md)
- [Datenbank & Migrationen](docs/database.md)
- [Tests](docs/testing.md)
- [Sicherheit](docs/security.md)
- [Produktion & Deployment](docs/deployment.md)
