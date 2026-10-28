# Architektur

## Überblick

```
 Browser ──HTTPS──▶ Control Center (Next.js) ──serverseitig──▶ Backend (Fastify) ──▶ PostgreSQL (lokal: PGlite)
                                                                   ▲
 Roblox-Spielserver (Luau, HttpService) ──HTTPS + Signatur─────────┘  (Phase 3)
 Discord-Bot (discord.js) ──────────────────────────────────────────┘  (Phase 4)
```

## Komponenten

| Komponente                   | Ordner               | Status                                        | Aufgabe                                                          |
| ---------------------------- | -------------------- | --------------------------------------------- | ---------------------------------------------------------------- |
| Emden Network Backend        | `apps/api`           | Phase 1                                       | REST-API, einzige Stelle mit Datenbankzugriff und Geschäftslogik |
| Emden Network Control Center | `apps/dashboard`     | Phase 1                                       | Weboberfläche; holt Daten serverseitig vom Backend               |
| Gemeinsame Bibliothek        | `packages/shared`    | Phase 1                                       | Zod-Schemas und Typen, die Backend und Dashboard teilen          |
| Discord-Bot                  | `apps/bot`           | geplant (Phase 4), Ordner mit README angelegt | Slash-Commands, Benachrichtigungen, Security Center              |
| Worker                       | `apps/worker`        | optional, Ordner mit README angelegt          | Hintergrundjobs, nur wenn ein konkreter Bedarf entsteht          |
| Roblox-Skripte               | `roblox/`            | geplant (Phase 3), Ordner mit README angelegt | Serverseitige Luau-Beispielskripte                               |
| Legacy-Bot                   | `legacy/discord-bot` | bestehend                                     | Bisheriger Bot, unverändert verschoben                           |

## Entscheidungen (und warum)

- **npm Workspaces statt pnpm/Turborepo:** npm ist bei Node.js dabei – ein Werkzeug weniger zu lernen.
- **Ein gemeinsames Schema-Paket (`@emden/shared`, Zod):** Backend und Dashboard prüfen Daten gegen
  dieselben Schemas. Ändert sich ein Format, meldet TypeScript die betroffenen Stellen.
- **Dashboard ruft das Backend serverseitig auf:** Die Backend-Adresse (`API_INTERNAL_URL`) gelangt nicht
  in den Browser, und CORS muss für das eigene Dashboard nicht geöffnet werden.
- **`/health` und `/ready` getrennt:** `/health` sagt „Prozess läuft“ (für Neustarts durch den Hoster),
  `/ready` sagt „kann Anfragen bedienen“ (inkl. Datenbank und Migrationsstand). Nicht konfigurierte Abhängigkeiten
  werden ehrlich als `not_configured` gemeldet.
- **TypeScript 6.0 statt 7.0:** typescript-eslint unterstützt TypeScript 7 noch nicht (Stand Oktober 2026).
- **Drizzle ORM mit eigenen SQL-Migrationen:** Drizzle liefert typgeprüfte, parametrisierte Abfragen. Die
  Migrationen sind lesbare SQL-Dateien. Das Zusatzwerkzeug `drizzle-kit` bleibt bewusst draußen, weil es
  veraltete Unterpakete mit Sicherheitswarnungen mitbringt. Details: [database.md](database.md).
- **PGlite für Entwicklung und Tests:** PostgreSQL als WebAssembly im selben Prozess. Auf dem Mac ist keine
  Datenbankinstallation nötig. In Produktion ist echtes PostgreSQL Pflicht, die CI testet zusätzlich dagegen.
- **Kein Redis in Phase 1:** Erst einführen, wenn z. B. verteilte Rate Limits bei mehreren API-Instanzen
  nötig werden. Das eingebaute Rate Limit arbeitet pro Prozess im Speicher.
- **Kein separates `packages/config`:** Die gemeinsame Konfiguration (`tsconfig.base.json`,
  `eslint.config.js`, `.prettierrc.json`) liegt im Wurzelordner; ein eigenes Paket lohnt sich erst bei mehr Apps.
- **Bestehender Bot nach `legacy/` verschoben:** Nichts wurde gelöscht oder überschrieben; der Bot bleibt
  lauffähig, ist aber vom neuen Monorepo getrennt.
