# Architektur

```
            Browser                 Discord                Roblox-Spielserver (Luau, HttpService)
               │                       │                                │
        ┌──────▼──────┐         ┌──────▼──────┐                         │ HTTPS, Bearer-Schlüssel
        │  Dashboard  │         │  Discord-   │                         │ + Zeitstempel + Nonce
        │  (Next.js)  │         │  Bot        │                         │
        └──────┬──────┘         └──────┬──────┘                         │
   /api-Proxy  │ Cookie+CSRF           │ Service-Token + X-Actor-Id     │
               └──────────────┬────────┴────────────────────────────────┘
                       ┌──────▼──────┐   Discord-REST (Rollen, Banns, DMs)
                       │ Fastify-API │──────────────────────────────►  Discord
                       │  /api/v1    │
                       └──┬───────┬──┘
              packages/core│       │BullMQ-Jobs / Redis Pub/Sub (SSE)
                     ┌─────▼──┐ ┌──▼────┐      ┌────────────┐
                     │Postgres│ │ Redis │◄─────│   Worker   │── pg_dump → Backup-Volume
                     └────────┘ └───────┘      └────────────┘
```

## Grundsätze

- **Eine Geschäftslogik** (`packages/core`): API und Worker rufen dieselben Funktionen auf. Der Bot und das
  Dashboard greifen nie direkt auf die Datenbank zu, sondern nur über die API. Dadurch gibt es genau eine Stelle
  für Validierung, Rechteprüfung und Audit.
- **Serverseitige Autorisierung**: Jede Kernfunktion prüft selbst (`requirePermission`), unabhängig davon, ob
  der Aufruf vom Dashboard, Bot oder Worker kommt. Das Dashboard blendet Aktionen nur zur Bequemlichkeit aus.
- **Audit in derselben Transaktion** wie die Änderung; Hash-Kette über alle Einträge.
- **Idempotenz** für wiederholbare Schreibvorgänge (HTTP `Idempotency-Key`, Spielereignis-IDs, Code-Einlösungen).
- **Nur echte Werte**: Monitoring zeigt gemessene Daten; fehlende Quellen erscheinen als „Nicht verbunden“.

## Entscheidungen (ADR-Kurzform)

| # | Entscheidung | Begründung |
|---|---|---|
| 1 | pnpm-Monorepo, TypeScript strict, ESM | Gemeinsame Typen und Logik ohne Veröffentlichung von Paketen |
| 2 | **Drizzle ORM** statt Prisma | Keine nativen Engine-Binärdateien, SQL-nahe Abfragen, generierte SQL-Migrationen im Repository, eigene SQL-Migrationen (Audit-Trigger) möglich |
| 3 | Fastify + Zod (`fastify-type-provider-zod`) | Validierung und OpenAPI aus denselben Schemas |
| 4 | Bot spricht nur mit der API | Keine doppelte Logik, Rechte/Audit identisch zu Dashboard; Bot ist austauschbar |
| 5 | Discord-Aktionen der API über REST (Bot-Token) | Moderationsergebnisse synchron sichtbar; Rollenvergaben asynchron über die Worker-Queue mit Wiederholungen |
| 6 | Verifizierung: Discord-OAuth **und** Roblox-OAuth im selben Browser | Verhindert, dass untergeschobene `/verify`-Links ein fremdes Roblox-Konto mit dem eigenen Discord verknüpfen |
| 7 | Roblox-Server: Bearer-Schlüssel aus dem Secrets Store + Zeitstempel + Nonce | Luau kann mit `Secret`-Objekten kein HMAC berechnen; eigene Kryptografie wird vermieden |
| 8 | Roblox-Sanktionen über `Players:BanAsync` auf dem Spielserver | Offiziell unterstützter Weg; Durchsetzung zusätzlich bei jedem Betreten |
| 9 | BullMQ + Redis für Jobs, Redis Pub/Sub für SSE | Wiederholungen/Backoff, geplante Jobs, horizontale Skalierung der API |
| 10 | SSE statt WebSockets | Nur Server→Client nötig, funktioniert über den Next-Proxy, automatische Wiederverbindung |
| 11 | Dashboard leitet `/api` per Laufzeit-Proxy weiter | Eine Origin (Cookies, CSRF, OAuth), API-Adresse zur Laufzeit konfigurierbar |
| 12 | Releases nur über CI/CD (`workflow_dispatch`) | Discord/Dashboard können niemals Shell-Befehle ausführen |
| 13 | Bisheriger JS-Bot als Altmodule weiterbetrieben | Funktionierende Bewerbungs-/Ticket-/Levelsysteme bleiben erhalten; Ticketpanel spiegelt in die Datenbank |

## Ablauf: Verifizierung

1. `/verify start` → API legt einen einmaligen `verify_start`-State an (15 Min.) und liefert einen persönlichen Link.
2. Link im Browser → Bindungs-Cookie + Discord-OAuth (Scope `identify`, PKCE). Stimmt die Discord-ID nicht mit
   der des Links überein, wird abgebrochen und ein Sicherheitsereignis protokolliert.
3. Roblox-OAuth (`openid profile`, PKCE S256, state, Bindungs-Cookie) → `userinfo` → Token wird widerrufen.
4. Verknüpfung in einer Transaktion (eindeutig je Discord- und Roblox-Konto), Audit, Profilhistorie.
5. Worker vergibt **nur** die Rolle „Verifiziert“. Fraktionsrollen vergibt ausschließlich das Team.

## Ablauf: Dienstsystem

Client → RemoteFunction → Spielserver prüft Fraktion/Abstand → Ereignis `duty_start` (GUID) → API prüft
Mitgliedschaft, setzt Beginn auf **Backend-Serverzeit**, markiert Zeitabweichungen, schließt Doppelstarts.
Ende über `duty_end`, Verlassen, Fraktionswechsel, Server-Herunterfahren oder Watchdog (Server-Timeout →
Ende = letzter Heartbeat; Höchstdauer). Korrekturen nur mit `duty:edit` (fraktionsbezogen) und Begründung.
