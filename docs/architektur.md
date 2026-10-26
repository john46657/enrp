# Architektur – Emden Network

```
 Discord-Nutzer ──/verify──▶ Discord-Bot ──(DB: Session anlegen)──▶ PostgreSQL
       │                        ▲   │                                  ▲
       │  Link-Button           │   └── Outbox-Worker: Rolle „Verifiziert“ vergeben, DM
       ▼                        │                                      │
   Browser ──GET /auth/roblox/start──▶ Backend-API (Fastify) ──────────┤
       │  302 + HttpOnly-Cookie            │  ▲                         │
       ▼                                   │  │ Token-Austausch (PKCE)  │
  apis.roblox.com (Login + Zustimmung)     │  │ userinfo (sub)          │
       │  302 code+state                   ▼  │                         │
       └──GET /auth/roblox/callback──▶ Backend-API ─── Verknüpfung + Outbox-Event (eine Transaktion)

 Roblox-Spielserver (Luau, HttpService) ──Bearer GAME_API_KEY──▶ /v1/game/* ──▶ PostgreSQL
                           ◀── freigegebene Aufträge (Allowlist, Ablaufzeit, Lease) ──
```

## Komponenten

| Komponente | Verantwortung | Geheimnisse |
|---|---|---|
| `apps/bot` | Slash-Commands, Buttons, Rollen-Outbox, DMs. Erzeugt OAuth-Sessions, führt **keinen** Token-Austausch aus. | `DISCORD_TOKEN`, DB-Zugang |
| `apps/api` | OAuth-Start/Callback, Game-API, Profil-API, Hintergrundaufgaben (Bereinigung, Ablauf von Aufträgen, abgestürzte Server). | Roblox-Client-Secret, `GAME_API_KEY`, `INTERNAL_API_TOKEN`, DB-Zugang |
| `packages/core` | Gesamte Geschäftslogik inkl. Berechtigungsprüfung. Bot und API rufen dieselben Services auf. | – |
| `packages/database` | Pool, Transaktionen, versionierte SQL-Migrationen (Prüfsummen, Advisory-Lock). | – |
| `roblox/server` | Heartbeat, Ereignisse, Dienst-Anfragen, Ausführung erlaubter Aufträge. | `GAME_API_KEY` nur als Experience-Secret |
| PostgreSQL | Einzige Quelle der Wahrheit. App-Rolle ohne DDL-Rechte. | – |

## Wichtige Entscheidungen

1. **Bot ohne Roblox-Secret.** Das Client-Secret liegt nur in der API (`VerificationService` mit OAuth-Client).
   Der Bot instanziiert den Service ohne Client und kann nur Sessions anlegen.
2. **Discord-ID stammt aus der Session.** Die Discord-ID wird beim `/verify` aus der Discord-Interaktion in die
   Session geschrieben. Der Callback akzeptiert keine Discord-ID-Parameter.
3. **Transaktionale Outbox statt direkter Discord-Aufrufe aus der API.** Die Verknüpfung und der Auftrag „Rolle
   vergeben“ werden in **einer** Transaktion gespeichert. Der Bot arbeitet die Outbox ab: mit Sperren
   (`FOR UPDATE SKIP LOCKED`), exponentiellem Backoff, endgültigem Fehlerstatus und Audit-Eintrag. Fällt Discord
   aus, geht keine Rollenvergabe verloren.
4. **Discord löst keine Spielaktionen direkt aus.** Commands legen `command_jobs` an. Typ und Payload werden
   gegen eine Allowlist (Zod) geprüft, die Berechtigung wird im Service geprüft, jeder Auftrag hat eine Ablaufzeit
   (max. 1 h). Spielserver holen Aufträge ab (Pull), führen nur bekannte Typen aus und melden das Ergebnis
   idempotent.
5. **Spielberechtigungen kommen aus dem Backend.** Der Spielserver fragt Fraktion und Rang über
   `/v1/players/roblox:<id>/profile` ab. Der Client kann nur „Dienst starten/beenden“ anfragen.
6. **Idempotenz überall:** `game_events.event_id` (GUID vom Server) ist eindeutig, Dienstsitzungen haben
   eindeutige Start/End-Event-IDs und höchstens eine offene Sitzung je Nutzer (partieller Unique-Index),
   Broadcast-Ergebnisse haben `(job, server)` als Primärschlüssel.
7. **Redis ist vorbereitet, aber nicht nötig.** Outbox und Aufträge laufen über PostgreSQL. Redis kommt erst, wenn
   Last oder Features (Caching, verteilte Rate-Limits mit mehreren API-Instanzen) es erfordern.

## Datenmodell (Kurzfassung)

Vollständig in `packages/database/migrations/*.sql`, kommentiert.

| Tabelle | Zweck | Wichtige Constraints |
|---|---|---|
| `users` | Person, identifiziert über Discord-ID | `discord_id` unique + Format-Check |
| `discord_links` | Verknüpfung Discord ↔ Roblox, mit Historie | Partielle Unique-Indizes: je Roblox-ID und je Nutzer max. eine **aktive** Verknüpfung |
| `oauth_verification_sessions` | Kurzlebige OAuth-Sessions | Hashes von Start-Token/state/Bindung unique; Verifier nach Abschluss NULL (Check-Constraint) |
| `factions`, `faction_ranks`, `faction_members` | Fraktionen, Ränge, Mitgliedschaften | Rang muss zur Fraktion gehören (zusammengesetzter FK), max. eine aktive Mitgliedschaft |
| `duty_sessions` | Dienstzeiten | Ende ≥ Beginn, ≤ 24 h, eine offene Sitzung je Nutzer, eindeutige Event-IDs, Korrekturen mit Originalwerten |
| `trainings`, `training_attendance` | Ausbildungen | |
| `applications`, `application_answers` | Bewerbungen | eine offene Bewerbung je Nutzer/Fraktion |
| `tickets`, `ticket_messages` | Support/Meldungen | |
| `moderation_cases` | Verwarnungen, Timeouts, Kicks, Bans | Ziel erforderlich |
| `game_servers`, `game_server_players`, `game_events`, `game_settings` | Spielintegration | `event_id` unique |
| `command_jobs`, `command_job_results` | Admin-Aufträge | Typ-Allowlist (CHECK), Ablauf ≤ 1 h |
| `outbox_events` | Nebenwirkungen mit Wiederholung | Dedupe-Key für offene Events |
| `audit_logs` | Append-only-Protokoll | Aktionsformat-Check |
| `guild_config` | Rollen-Zuordnung, Audit-Kanal | |

Löschregeln: Personenbezogene Kinddaten hängen per `ON DELETE CASCADE` an `users` (Löschung einer Person
entfernt Verknüpfungen, Mitgliedschaften, Dienstzeiten, Bewerbungen). Referenzen auf Moderatoren/Prüfer
werden auf `NULL` gesetzt, damit Fälle erhalten bleiben. Stammdaten (Fraktionen, Ränge) sind per `RESTRICT`
gegen versehentliches Löschen geschützt.
