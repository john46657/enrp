# Tests

```bash
# PostgreSQL bereitstellen (Datenbankname MUSS "test" enthalten – sie wird bei jedem Lauf geleert)
createdb enrp_test
export TEST_DATABASE_URL=postgres://user:pass@localhost:5432/enrp_test   # Standard: postgres://enrp:enrp_dev@localhost:5432/enrp_test
pnpm test
```

Externe Dienste werden nie echt aufgerufen: Roblox-OAuth läuft gegen einen lokalen Mock-Server
(`tests/helpers/roblox-mock.ts`), der Einmal-Codes, PKCE-S256 und Client-Credentials wie dokumentiert prüft.
Discord wird über ein Fake-Gateway ersetzt (`tests/helpers/fake-discord.ts`). Es werden keine echten
Spieleraktionen ausgeführt.

## Abdeckung der geforderten Fälle

| Anforderung | Test |
|---|---|
| Erfolgreiche OAuth-Verifizierung | `oauth-verification` › verknüpft erfolgreich … |
| Ungültiger/manipulierter/fehlender `state` | › lehnt manipulierten state ab, › lehnt fehlenden state ab |
| Login-CSRF (fremder Browser) | › lehnt Callback ohne passendes Browser-Cookie ab |
| Abgelaufene OAuth-Session / Start-Link | › lehnt abgelaufene Session ab, › abgelaufenen Start-Link |
| Wiederverwendeter Autorisierungscode / Replay / parallele Callbacks | › verhindert die Wiederverwendung …, › parallele Callbacks |
| Fehlgeschlagener Token-Austausch, falscher PKCE-Verifier, Roblox nicht erreichbar | › fehlgeschlagener Token-Austausch, › falscher PKCE-Verifier, › Netzwerkausfall |
| Ungültige Userinfo-Antwort | › lehnt ungültige Userinfo-Antwort ab (3 Varianten) |
| Bereits verknüpfte Roblox-ID / Discord-ID | › … anderem Discord-Account …, › /verify abgelehnt, › Race zwischen zwei Sessions |
| OAuth-Abbruch und Neustart | › Abbruch bei Roblox (access_denied) |
| Fehlgeschlagene Rollenvergabe | `role-sync` › nicht konfiguriert, › Backoff + max_attempts, › Mitglied weg, › Erholung |
| Fehlende Berechtigungen | `permissions` (Unit), `factions-duty`, `game-api` › prüft Berechtigungen (inkl. Audit `permission.denied`) |
| Doppelte Spielereignisse | `game-api` › verarbeitet doppelte Ereignisse genau einmal, › doppeltes Dienstende |
| Backend-/Datenbankausfälle | `database` › Datenbankausfälle, › API meldet Datenbankausfall (/readyz, keine Interna) |
| Abgelaufene Admin-Aufträge | `game-api` › abgelaufene Aufträge …, › Lease-Freigabe |
| Inkonsistente Dienst-Zeitstempel | `game-api` › Dienstende vor Dienstbeginn, › unplausible Zeitstempel; `factions-duty` › > 24 h, › Zukunft |
| Datenbankfehler und Rollback | `database` › rollt Transaktionen zurück, › fehlerhafte Migration, › Prüfsumme |
| DB-Constraints | `database` › eindeutige aktive Verknüpfungen, › CHECK |
| Command-Definitionen | `bot-commands` › serialisierbar, Pflichtoptionen zuerst, nur Guild-Kontext |
| Doku aktuell | `docs` › Berechtigungsmatrix |

## Nicht automatisiert getestet

- Echte Discord-Interaktionen (Slash-Commands gegen die Discord-API, Rollenhierarchie, DMs). Die Command-Logik
  ist über die Services getestet, die Discord-Schicht nur strukturell.
- Echte Roblox-OAuth-Anmeldung (benötigt eine registrierte App und einen Browser). Der Start-Redirect zur echten
  Autorisierungs-URL wurde manuell gegen den gebauten Server geprüft.
- Luau-Skripte (siehe [roblox-integration.md](roblox-integration.md), Checkliste).
- Docker-Image-Build und Compose-Stack (in dieser Umgebung kein Docker-Daemon). Das Produktionslayout
  (`pnpm build` + `pnpm install --prod`) wurde lokal nachgestellt und gestartet.
