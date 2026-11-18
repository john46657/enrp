# Betrieb

## Monitoring

- **Lagebild** im Dashboard: Roblox, Backend, Bot, Worker, Datenbank, Redis mit gemessenen Werten.
- `/ops health|metrics|dependencies|queue|alerts` im Discord.
- Health-Checks: API `GET /health` (Prozess), `GET /health/ready` (DB + Redis), Dashboard `GET /healthz`.
- Prometheus: `GET /metrics` mit `METRICS_TOKEN` (Anfragen, Fehler, Latenz-Perzentile, Laufzeit je Instanz).
- Lebenszeichen: API, Bot und Worker melden sich alle 30 s; älter als 90 s gilt als ausgefallen.
- Strukturierte JSON-Logs (Pino) mit Request-ID; die Request-ID steht auch in Fehlerantworten und im Audit-Log.

## Hintergrundjobs (Worker)

| Job | Takt |
|---|---|
| Dienst-Watchdog (Server-Timeout, Höchstdauer), Offline-Server, Ablauf von Timeouts/Banns, abgelaufene Freigaben, Automatisierungs-Watchdog | jede Minute |
| Aufbewahrungsfristen, Bereinigung alter Backups | täglich 03:30 UTC |
| Backup | `BACKUP_CRON` (Standard 02:00 UTC) |
| Discord-Aktionen (Rollen, Nachrichten), geplante Veröffentlichungen, Giveaway-Ziehung, Umfrageende | ereignisgesteuert, mit Wiederholung (5 Versuche, exponentiell) |

Fehlgeschlagene Jobs: Dashboard → *Warteschlangen & Jobs* (erneut ausführen).

## Backups

1. `pg_dump --format=custom` in `BACKUP_DIR` (Datei `0600`, Verzeichnis `0700`).
2. SHA-256 berechnen, Datei erneut lesen und vergleichen.
3. `pg_restore --list` muss das Archiv lesen und Tabellendaten finden.
4. Optional (`RESTORE_TEST_DATABASE_URL`): vollständige Wiederherstellung in eine Testdatenbank.
5. Erst dann Status „erfolgreich“. Fehler → Status „fehlgeschlagen“, Datei gelöscht, Automatisierung
   `backup_failed`, Warnung im Lagebild.

**Getrennte Aufbewahrung:** `BACKUP_DIR` muss auf einem eigenen Datenträger/Mount liegen. Zusätzlich eine
Kopie außerhalb des Servers vorhalten (z. B. `rclone`/`restic` per Cron auf verschlüsselten Objektspeicher) –
das ist nicht Teil der Anwendung.

**Wiederherstellungstests** regelmäßig (mind. monatlich) über *Backups → Wiederherstellen → Testdatenbank*.

## Wiederherstellung

- Antrag im Dashboard (Vorschau: Zeitpunkt, Größe, Prüfsumme, Tabellen) mit Bestätigungswort und Begründung.
- Zweite Person genehmigt im Freigabezentrum (4 h gültig). Der Worker prüft erneut die Prüfsumme.
- Automatisch nur in konfigurierte Ziele (`RESTORE_TARGET_*_URL`); Produktion zusätzlich nur mit
  `ALLOW_PRODUCTION_RESTORE=true`. Sonst Status „manuell erforderlich“.

**Manueller Produktionsablauf:**
1. Kill-Switch aktivieren und Wartungsmodus einschalten; Vorfall eröffnen.
2. Bot, Worker und API stoppen (`docker compose stop bot worker api`).
3. Aktuellen Zustand zusätzlich sichern: `pg_dump -Fc -f vor-wiederherstellung.dump`.
4. Prüfsumme der Backup-Datei mit dem Wert im Dashboard vergleichen (`sha256sum`).
5. `pg_restore --clean --if-exists --no-owner --single-transaction -d <DATABASE_URL> <datei>`.
6. API starten (führt ggf. neuere Migrationen aus), `/audit verify` ausführen, Stichproben prüfen.
7. Worker und Bot starten, Kill-Switch/Wartung beenden, Vorfall mit Ergebnis abschließen.

## Notfallplan

| Lage | Sofortmaßnahme |
|---|---|
| Missbrauch/Kompromittierung eines Kontos | Kill-Switch, Sitzungen beenden (*Sicherheitsereignisse*), Rollenzuweisung entfernen, Audit-Log des Kontos prüfen, Vorfall eröffnen |
| Roblox-Schlüssel geleakt | Schlüssel im Dashboard widerrufen, neuen erzeugen, Secret im Creator Hub ersetzen |
| Bot-Token/Service-Token geleakt | Token im Developer Portal neu erzeugen bzw. `BOT_API_TOKEN` rotieren, Dienste neu starten |
| `HASH_SECRET` geleakt | Rotation macht bestehende Codes ungültig – neue Codes ausgeben; IP-Hashes werden neu |
| Datenbankausfall | API meldet `not_ready`; Bot antwortet mit Hinweis; nach Wiederanlauf laufen Jobs weiter (Redis) |
| Audit-Verifikation schlägt fehl | Vorfall SEV1, betroffenen Bereich sichern, Datenbankrechte prüfen |

## Sicherer Shutdown

Alle Dienste behandeln `SIGTERM`: keine neuen Anfragen/Jobs, laufende abschließen (API 15 s, Worker 30 s),
Verbindungen schließen. Der Bot schreibt Daten der Altmodule vor dem Beenden.

## Datenschutzprozesse

- Auskunft: *Datenschutz → Datenauskunft* bzw. `/data export` – JSON-Download, nach 7 Tagen automatisch geleert.
- Löschung: Antrag mit Vorschau → Vier-Augen-Freigabe → Löschung/Pseudonymisierung (siehe
  [data-model.md](data-model.md)). Jeder Schritt wird protokolliert.
- Massenlöschungen erfolgen nur über Aufbewahrungsfristen; Vorschau mit `/data cleanup-preview`.
