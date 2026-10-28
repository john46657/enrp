# Emden Network – Analyse & Implementierungsplan

Stand: 28.10.2026 · Status: **Phase 0 abgeschlossen ✅ – als Nächstes Phase 1**

---

## 1. Analyse des vorhandenen Projekts

| Was           | Befund                                                                                                                                                                                                                               |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sprache       | JavaScript (CommonJS), **kein TypeScript**                                                                                                                                                                                           |
| Umfang        | ca. 4 900 Zeilen, ein einzelner Discord-Bot (`index.js`, `src/`)                                                                                                                                                                     |
| Bibliotheken  | `discord.js` 14, `dotenv` – sonst nichts                                                                                                                                                                                             |
| Datenspeicher | `data/db.json` (eine JSON-Datei, gesammeltes Schreiben). Kein PostgreSQL, keine Migrationen                                                                                                                                          |
| Funktionen    | Bewerbungen (inkl. Roblox-Konto-Suche über die öffentliche `users.roblox.com`-API), Tickets mit Öffnungszeiten/Transkripten, Moderation (`/kick` `/ban` `/warn` …), Level, Umfragen, Rollenpanel, `/einstellungen` je Discord-Server |
| Altlast       | `/serverstatus` und Bot-Status fragen einen **FiveM**-Server ab (`src/lib/fivem.js`) – passt nicht zu einem Roblox-Spiel                                                                                                             |
| Tests         | `npm run check` (Offline-Selbstprüfung) läuft grün ✅ – aber keine echten Unit-Tests, keine Typprüfung                                                                                                                               |
| Sicherheit    | Token nur in `.env` ✅. Keine Audit-Logs außer Discord-Mod-Log, keine zentrale Berechtigungsverwaltung                                                                                                                               |

**Fazit:** Der Bot ist funktional und wertvoll (besonders Tickets und Bewerbungen) und wird **nicht weggeworfen**.
Er wird in Phase 5 in das Monorepo übernommen, schrittweise auf TypeScript umgestellt und von `db.json` auf PostgreSQL migriert
(mit Import-Skript für bestehende Daten). Bis dahin läuft er unverändert weiter.

---

## 2. Zielarchitektur

```
                 ┌─────────────────────┐   HTTPS (HttpService:RequestAsync)
  Roblox-Server ─┤ Luau-Modul "ENC"    ├──────────────────────────────┐
  (öffentlich /  │ Heartbeat, Events,  │◄──── Befehle abholen ────────┤
   privat /      │ Befehle ausführen   │                              ▼
   reserviert)   └─────────────────────┘                     ┌──────────────────┐
                                                             │  apps/api        │
  Browser ─── apps/dashboard (Next.js) ── HTTPS + Cookie ───►│  Fastify REST    │──► PostgreSQL
                                                             │  Auth, Rechte,   │
  Discord ─── apps/bot (discord.js) ───── interne API ──────►│  Audit, Limits   │
                                                             └────────┬─────────┘
                                                                      │ Job-Queue (pg-boss, liegt in PostgreSQL)
                                                             ┌────────▼─────────┐
                                                             │  apps/worker     │──► Roblox Open Cloud,
                                                             │  Hintergrundjobs │    Discord-Webhooks
                                                             └──────────────────┘
```

**Grundsatz:** Nur die **API** spricht mit der Datenbank und entscheidet über Berechtigungen.
Dashboard und Bot sind „Clients“ der API. So gibt es genau **eine** Stelle, an der Rechte geprüft werden.

### Monorepo-Struktur

```
apps/
  api/          Fastify-REST-API (TypeScript)
  dashboard/    Next.js „Emden Network Control Center“ (TypeScript)
  bot/          Discord-Bot (discord.js, TypeScript; Übernahme des bestehenden Bots)
  worker/       Hintergrundjobs (pg-boss)
packages/
  db/           Datenbankschema + SQL-Migrationen (Drizzle ORM)
  shared/       Gemeinsame Typen und Zod-Validierungsschemas
  config/       Gemeinsame tsconfig / ESLint-Einstellungen
roblox/
  src/          Luau-Skripte für dein Spiel (Rojo-Projekt, alternativ per Kopieren in Studio)
docs/           Anleitungen (Einrichtung, Deployment, Sicherheit)
docker-compose.yml   PostgreSQL für die Entwicklung (+ Produktions-Variante)
```

### Technologie-Entscheidungen (mit Begründung)

| Thema                    | Wahl                                                                                       | Warum                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| Paketmanager             | **pnpm Workspaces**                                                                        | Standard für Monorepos, schnell, auf deinem System vorhanden               |
| Sprache                  | **TypeScript (strict)**                                                                    | Fehler werden vor dem Start gefunden                                       |
| API                      | **Fastify** + `@fastify/rate-limit`, `@fastify/helmet`, `@fastify/cookie`, `@fastify/cors` | Von dir gewünscht; offizielle Plugins für Limits/Sicherheit                |
| Validierung              | **Zod**                                                                                    | Jede Eingabe wird geprüft; dieselben Schemas nutzen API, Bot und Dashboard |
| Datenbank                | **PostgreSQL 16** + **Drizzle ORM / drizzle-kit**                                          | Typsicher, erzeugt lesbare SQL-Migrationsdateien, die ins Repo kommen      |
| Hintergrundjobs          | **pg-boss**                                                                                | Queue direkt in PostgreSQL → kein zusätzlicher Redis-Server nötig          |
| Dashboard-Login          | **Discord OAuth2** (Scopes `identify`, `guilds.members.read`), Session-Cookie von der API  | Dein Team hat sowieso Discord; Rollen dort = Rechte im Dashboard           |
| Roblox-Konten verknüpfen | später **Roblox OAuth 2.0** (offiziell, `openid profile`)                                  | Echter Nachweis statt „Name eintippen“                                     |
| Tests                    | **Vitest**; API-Tests gegen echte Test-Datenbank                                           | Schnell, TypeScript-nativ                                                  |
| Deployment               | **Docker Compose** auf einem Linux-VPS + Caddy (automatisches HTTPS)                       | Einfachste vollständige Lösung für Anfänger                                |

---

## 3. Verwendete reale Schnittstellen (keine erfundenen Endpunkte)

### Roblox

| Zweck                                        | Offizielle Schnittstelle                                                                                                                                                                                 |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spielserver → Backend                        | `HttpService:RequestAsync` (in den Spieleinstellungen **„Allow HTTP Requests“** aktivieren; Limit: 500 Anfragen/Minute pro Server)                                                                       |
| API-Schlüssel sicher im Spiel                | **Secrets Store** (Creator Hub → Experience → Secrets) + `HttpService:GetSecret()` – der Schlüssel steht nie im Spielcode                                                                                |
| Servertyp erkennen                           | `game.JobId`, `game.PlaceId`, `game.PrivateServerId`, `game.PrivateServerOwnerId` → öffentlich (`PrivateServerId == ""`), privat (`OwnerId ≠ 0`), reserviert (`PrivateServerId ≠ ""` und `OwnerId == 0`) |
| Reservierte Server erstellen                 | `TeleportService:TeleportAsync` mit `TeleportOptions.ShouldReserveServer` bzw. `TeleportService:ReserveServer`                                                                                           |
| Backend → alle Server sofort benachrichtigen | **Open Cloud Messaging**: `POST https://apis.roblox.com/cloud/v2/universes/{universeId}:publishMessage` (API-Key mit `universe-messaging-service:publish`), im Spiel `MessagingService:SubscribeAsync`   |
| Dauerhafte Spielbans                         | In-Game `Players:BanAsync` bzw. Open Cloud **User Restrictions** (`cloud/v2/universes/{universe}/user-restrictions/{user}`)                                                                              |
| Nutzernamen/Avatare                          | `users.roblox.com/v1/usernames/users`, `thumbnails.roblox.com/v1/users/avatar-headshot` (wird schon genutzt)                                                                                             |

**Befehlszustellung an Spielserver:** Die Server **holen** offene Befehle regelmäßig ab (alle ~5 s) und bestätigen die Ausführung.
Open Cloud Messaging dient nur als „Weckruf“ für schnellere Reaktion. Grund: Messaging garantiert keine Zustellung, Abholen + Bestätigen schon.

### Discord

discord.js 14 (Gateway + Slash-Commands), Discord OAuth2 für das Dashboard. Nichts Inoffizielles.

### TikTok LIVE – ehrliche Einschätzung

Nach meiner Recherche gibt es **keine offizielle TikTok-API**, die meldet, wann ein Konto live geht.
Die verbreiteten Bibliotheken (z. B. „TikTok-Live-Connector“) und Dienste wie EulerStream/TikTool sind **inoffiziell**
und werten interne TikTok-Schnittstellen aus – das kann jederzeit brechen und verstößt möglicherweise gegen die TikTok-Nutzungsbedingungen.
Darum ist geplant (Phase 9):

1. **Sofort machbar & offiziell:** Streamer melden sich per `/live start <link>` im Discord oder per Knopf im Dashboard, der Bot postet eine schöne Ankündigung.
2. Vor der Umsetzung prüfe ich die aktuelle Dokumentation auf developers.tiktok.com erneut. Gibt es dann eine offizielle Schnittstelle, wird sie angebunden.
3. Ein inoffizieller Anbieter wird nur eingebaut, wenn **du** dich ausdrücklich dafür entscheidest – klar als inoffiziell gekennzeichnet und abschaltbar.

---

## 4. Sicherheitskonzept (gilt für alle Phasen)

- **Autorisierung serverseitig:** Rollen/Rechte (z. B. `servers.view`, `players.kick`, `players.ban`, `audit.view`) liegen in der DB. Jede API-Route deklariert, welches Recht sie braucht. Das Dashboard blendet Knöpfe nur aus – entscheiden tut immer die API.
- **Spielserver-Authentifizierung:** Pro Spiel (Universe) ein zufälliger API-Schlüssel; in der DB nur als **SHA-256-Hash** gespeichert, im Spiel im Roblox Secrets Store. Rotation über das Dashboard.
- **Eingabevalidierung:** Zod-Schemas für jeden Body/Query/Parameter; unbekannte Felder werden abgelehnt.
- **Rate-Limits:** pro Spielschlüssel, pro eingeloggtem Nutzer und pro IP (Login).
- **Audit-Log:** Jede schreibende Admin-Aktion (wer, was, Ziel, Grund, Zeit, IP, Ergebnis) – nur anhängen, nie bearbeiten.
- **Kontrollierte Admin-Aktionen:** Grund ist Pflicht; gefährliche Aktionen (Bann, Server schließen) mit Bestätigung; optional Vier-Augen-Prinzip für permanente Banns.
- **Sessions:** httpOnly-, Secure-, SameSite-Cookies; CSRF-Schutz; Sessions in der DB, widerrufbar.
- **Geheimnisse:** nur in `.env` (nie im Git). `.env.example` erklärt jede Variable. Beim Start prüft jede App ihre Variablen und bricht mit klarer Meldung ab, wenn etwas fehlt.

---

## 5. Phasenplan

Jede Phase endet erst, wenn **Typprüfung, Lint und Tests grün** sind und du eine Anleitung zum Ausprobieren hast.

### Phase 0 – Fundament (Monorepo) ✅

- pnpm-Workspace, gemeinsame TypeScript-/ESLint-/Vitest-Konfiguration
- `docker-compose.yml` mit PostgreSQL für die Entwicklung
- Bestehender Bot zieht **unverändert** nach `apps/bot` um (läuft weiter wie bisher)
- Root-Befehle: `pnpm dev`, `pnpm typecheck`, `pnpm test`, `pnpm lint`
- GitHub Actions: Typprüfung + Tests bei jedem Push

### Phase 1 – Vertikaler Durchstich: Live-Server ✨ (dein Punkt 13)

**Roblox-Testserver → Backend → Datenbank → Dashboard**

1. **DB:** Tabellen `games`, `game_api_keys`, `game_servers`, `players`, `player_sessions`, `audit_log` + erste Migration
2. **API:** `POST /v1/game/servers/heartbeat` (Server meldet Typ, Spieler, Version), `POST /v1/game/players/join|leave`, Spielschlüssel-Prüfung, Rate-Limit, Validierung; Server ohne Heartbeat > 90 s gelten als offline
3. **Roblox:** Luau-Modul, das beim Start, alle 30 s und bei `PlayerAdded`/`PlayerRemoving` meldet; Schlüssel aus dem Secrets Store; Wiederholung bei Fehlern mit Backoff
4. **Dashboard:** Discord-Login, Seite „Server“ (öffentlich/privat/reserviert, Spielerzahl, Laufzeit) und Server-Detailseite mit Spielerliste
5. **Tests:** API-Tests (falscher Schlüssel → 401, ungültige Daten → 400, Rate-Limit → 429), Servertyp-Erkennung als Unit-Test

### Phase 2 – Kontrollierte Admin-Aktionen

- Befehlswarteschlange `server_commands` (Kick, Nachricht an Server/Spieler, Server herunterfahren)
- Spielserver holen Befehle ab, führen sie aus, bestätigen → Ergebnis im Dashboard
- Rollen & Rechte im Dashboard verwalten, Audit-Log-Ansicht mit Filtern
- Optionaler Weckruf per Open Cloud Messaging

### Phase 3 – Spielerprofile & Moderation im Spiel

- Spielerprofil: Roblox-Daten, Spielzeit, Sitzungen, Notizen, Verwarnungen, Banns
- Banns zeitlich/permanent über `Players:BanAsync` bzw. Open Cloud User Restrictions
- Verknüpfung Discord ↔ Roblox über Roblox OAuth 2.0

### Phase 4 – Roleplay-Systeme

- **Fraktionen** (Polizei, Rettungsdienst, …) mit Rängen, Mitgliedern, Rechten
- **Dienstzeiten:** Ein-/Ausstempeln im Spiel, Auswertung pro Fraktion/Woche
- **Fahrzeuge:** Fahrzeugregister (Kennzeichen, Halter, Fraktion), Zuweisungen
- **Reports:** Spieler melden im Spiel → Bearbeitung im Dashboard/Discord

### Phase 5 – Discord-Bot ins System integrieren

- Bot nach TypeScript migrieren (Modul für Modul, Funktionen bleiben gleich)
- `data/db.json` → PostgreSQL mit **Import-Skript** für deine bestehenden Daten
- `/serverstatus` zeigt die Roblox-Server statt FiveM; neue Befehle wie `/spieler`, `/dienst`
- Discord-Moderation wird ins Audit-Log geschrieben

### Phase 6 – Discord-Server-Sicherheit

- Anti-Raid (Beitrittswellen), Anti-Spam, Link-/Einladungsfilter, Schutz vor Massen-Kanal-/Rollenlöschung (über Audit-Log-Events), Notfall-„Lockdown“

### Phase 7 – Statistiken

- Dashboard-Auswertungen: Spieler pro Stunde, Spitzenzeiten, Dienstzeiten, Moderationszahlen, Ticket-Bearbeitungszeiten

### Phase 8 – Produktion & Deployment

- Docker-Images für alle Apps, `docker-compose.prod.yml`, Caddy mit HTTPS, Backups der DB, Logs, Healthchecks
- Vollständige Deployment-Anleitung (VPS mieten → Domain → Server einrichten → starten → aktualisieren → Backup wiederherstellen)

### Phase 9 – TikTok-LIVE-Benachrichtigungen

- siehe Abschnitt 3: manuelle/Dashboard-Ankündigung, offizielle API nur falls vorhanden

---

## 6. Was du später einrichten musst (wird in jeder Phase genau erklärt)

| Wann    | Was                                                                                                                                                                                                                                                                                                           |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 0 | Docker Desktop (Windows/Mac) oder Docker (Linux), Node.js 22, pnpm (`corepack enable`)                                                                                                                                                                                                                        |
| Phase 1 | Discord-Anwendung: OAuth2-Redirect-URL eintragen, Client-ID + Client-Secret in `.env` · Roblox: „Allow HTTP Requests“ an, Secret im Secrets Store anlegen · Für Tests aus Roblox Studio brauchst du eine öffentlich erreichbare URL (z. B. Cloudflare Tunnel), weil Roblox-Server `localhost` nicht erreichen |
| Phase 2 | Roblox Open Cloud API-Key mit `universe-messaging-service:publish`                                                                                                                                                                                                                                            |
| Phase 3 | Roblox OAuth-App (Creator Hub) und ggf. API-Key mit User-Restrictions-Rechten                                                                                                                                                                                                                                 |
| Phase 8 | VPS (z. B. Hetzner, Netcup), eine Domain                                                                                                                                                                                                                                                                      |

---

## 7. Annahmen (bitte widersprechen, falls falsch)

1. Die **FiveM-Funktion** wird in Phase 5 durch Roblox-Serverstatus **ersetzt**.
2. Ziel-Hosting ist ein **Linux-VPS mit Docker**. Der aktuelle Pterodactyl-Bot-Hoster eignet sich nicht für API + Datenbank + Dashboard.
3. Ein Spiel (eine Universe) mit evtl. mehreren Places. Mehrere Spiele werden im Datenmodell trotzdem unterstützt.
4. Dashboard und Bot-Texte bleiben auf **Deutsch**.
