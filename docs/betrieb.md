# Betrieb: Umgebungen, Deployment, Backups, Monitoring, Fehlerbehebung

## Umgebungen

| Umgebung | Zweck | Trennung |
|---|---|---|
| Entwicklung | lokal, `NODE_ENV=development`, eigene Discord-Test-App + Test-Server, Roblox-App im privaten Modus | eigene `.env`, eigene DB |
| Test (CI) | `pnpm test` gegen eine Datenbank mit `test` im Namen (Sicherheitsabbruch sonst) | DB wird bei jedem Lauf neu aufgebaut |
| Staging | Produktions-Image, eigene Domain (`staging-api.…`), eigener Discord-Server, eigene Roblox-Test-Place | eigene Secrets, eigene Roblox-OAuth-App bzw. eigene Redirect-URL |
| Produktion | `NODE_ENV=production` | eigene Secrets, Start verweigert bei unsicherer Konfiguration |

Niemals Produktions-Secrets in Entwicklung oder Staging verwenden.

## Deployment (Docker Compose, ein Server)

```bash
git pull
cp .env.example .env   # einmalig, Werte setzen (NODE_ENV=production, HTTPS-URL, COOKIE_SECURE=true, TRUST_PROXY=1)
docker compose -f docker-compose.yml -f infra/docker-compose.prod.yml up -d --build
docker compose run --rm bot node apps/bot/dist/register-commands.js   # nach Command-Änderungen
```

- `migrate` läuft vor API und Bot mit dem Schema-Eigentümer (`emden_owner`). API und Bot verbinden sich als
  `emden_app` (nur SELECT/INSERT/UPDATE/DELETE, kein DDL), angelegt durch `infra/postgres/init/01-roles.sh`.
- Migrationen sind versioniert und per Prüfsumme gegen nachträgliche Änderung geschützt. Jede Migration läuft in
  einer Transaktion, parallele Läufe sind per Advisory-Lock ausgeschlossen. Änderungen immer als neue Datei
  `000N_name.sql`.
- Nur **eine** Bot-Instanz betreiben (Discord-Gateway). Die Outbox wäre zwar mehrinstanzfähig, Interaktionen
  aber nicht doppelt sinnvoll. Die API kann mehrfach laufen. Rate-Limits gelten dann je Instanz (für
  gemeinsame Limits später Redis).
- Container laufen als Benutzer `node`, Postgres ist in Produktion nicht nach außen veröffentlicht.

## Backups und Wiederherstellung

```bash
# täglich per Cron (UTC): 15 3 * * *
infra/scripts/backup.sh                       # pg_dump (custom format), Aufbewahrung 14 Tage (RETENTION_DAYS)
infra/scripts/restore-test.sh /var/backups/emden-network/emden-<zeit>.dump
```

- `restore-test.sh` stellt in eine **temporäre** Datenbank wieder her, zählt Migrationen, Nutzer und
  Verknüpfungen und löscht die Testdatenbank wieder. Die Produktionsdatenbank bleibt unberührt.
- Empfehlung: Backups zusätzlich verschlüsselt außer Haus kopieren (z. B. `restic`/`borg`) und den
  Restore-Test **monatlich** ausführen und protokollieren.
- Echte Wiederherstellung (nur nach ausdrücklicher Entscheidung, überschreibt Daten): API und Bot stoppen,
  `pg_restore --clean --if-exists -d emden <datei>`, danach `migrate` und Dienste starten.

> Hinweis: Die Skripte wurden in dieser Umgebung nicht gegen einen laufenden Docker-Daemon ausgeführt.
> Bitte beim ersten Einrichten einmal manuell durchspielen.

## Monitoring

- **Health:** `GET /healthz` (Prozess), `GET /readyz` (inkl. Datenbank) für Uptime-Checks/Load-Balancer.
- **Discord:** `/system health` zeigt DB-Latenz, Gateway-Ping, offene/fehlgeschlagene Rollenvergaben und aktive
  Roblox-Server.
- **Logs:** strukturiert (JSON, pino). Authorization-Header, Cookies und Query-Strings werden entfernt
  (keine Tokens, `state` oder Codes in Logs). Fehler-Referenzen im Bot (`Referenz: abcd1234`) finden sich im Log.
- **Alarme (empfohlen):** `/readyz` ≠ 200, Log-Level `error`, `outbox_events` mit `status='failed'`,
  keine Heartbeats während der Spielzeiten.

```sql
-- Fehlgeschlagene Rollenvergaben der letzten 24 h
SELECT id, payload->>'discordId' AS discord_id, attempts, last_error FROM outbox_events
WHERE status = 'failed' AND created_at > now() - interval '1 day';
-- Erneut versuchen (z. B. nach Korrektur der Rollenhierarchie)
UPDATE outbox_events SET status = 'pending', attempts = 0, available_at = now() WHERE id = '<id>';
```

## Fehlerbehebung

| Symptom | Ursache / Lösung |
|---|---|
| API startet nicht: „Ungültige Konfiguration …“ | Die Meldung nennt das Feld. In Produktion sind HTTPS, `COOKIE_SECURE=true`, `ALLOWED_PLACE_IDS` und 32+ Zeichen lange Schlüssel Pflicht. |
| Roblox zeigt „invalid redirect_uri“ | Redirect-URL in der Roblox-App muss exakt `<PUBLIC_BASE_URL>/auth/roblox/callback` sein (Schema, Host, Port, Pfad). |
| Ergebnisseite „in einem anderen Browser gestartet“ | Link aus Discord in einem anderen Browser/In-App-Browser geöffnet als die Roblox-Anmeldung abgeschlossen wurde, oder Cookies blockiert. Link im Standardbrowser öffnen. |
| „Link abgelaufen / bereits verwendet“ | `/verify` erneut ausführen (jeder Link ist einmalig, 10 min). |
| Verifiziert, aber keine Rolle | `/system health` → fehlgeschlagene Rollenvergaben. Häufig: Rolle nicht konfiguriert (`/system config role schluessel:Verifiziert`) oder Bot-Rolle steht unter „Verifiziert“. Danach Event erneut einreihen (SQL oben). |
| Mehr als 10 Nutzer können sich nicht verifizieren | Roblox-App ist im privaten Modus → zur Prüfung einreichen. |
| Spielserver erscheinen nicht | HTTP-Requests aktiviert? Secret-Name und Domain korrekt? Place-ID in `ALLOWED_PLACE_IDS`? API-Log zeigt 401/403. |
| `duty.start` wird abgelehnt (`NOT_LINKED` / „kein Mitglied“) | Spieler nicht verifiziert bzw. nicht per `/faction invite` in dieser Fraktion. |
| Commands fehlen in Discord | `pnpm bot:register` (bzw. Compose-Befehl oben) mit korrekter `DISCORD_GUILD_ID`. |
