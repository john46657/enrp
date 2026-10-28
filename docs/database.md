# Datenbank und Migrationen

## Überblick

| Umgebung               | Datenbank                                                                   | Einrichtung                              |
| ---------------------- | --------------------------------------------------------------------------- | ---------------------------------------- |
| Entwicklung (dein Mac) | **PGlite**, ein echtes PostgreSQL als WebAssembly, läuft im Backend-Prozess | keine, Daten liegen in `apps/api/.data/` |
| Tests                  | PGlite im Arbeitsspeicher, je Testdatei eine frische Datenbank              | keine                                    |
| Integrationstests / CI | echtes **PostgreSQL 16** über `TEST_DATABASE_URL`                           | in der CI automatisch                    |
| Produktion             | echtes **PostgreSQL** über `DATABASE_URL` (Pflicht)                         | Phase 7                                  |

Warum so? Du musst auf dem Mac nichts zusätzlich installieren, und trotzdem läuft überall dieselbe
PostgreSQL-Sprache. PGlite basiert auf PostgreSQL 18, die CI prüft zusätzlich gegen PostgreSQL 16.

**Datenzugriff:** [Drizzle ORM](https://orm.drizzle.team/) erzeugt typgeprüfte, parametrisierte Abfragen
und schützt so vor SQL-Injection. Das Werkzeug `drizzle-kit` wird bewusst **nicht** verwendet: Es bringt
veraltete, nicht mehr gepflegte Unterpakete mit, die `npm audit` als Sicherheitswarnung meldet.
Die Migrationen sind deshalb schlichte SQL-Dateien mit einem kleinen, getesteten Migrationsprogramm
(`apps/api/src/db/migrate.ts`).

## Tabellen (Migration 0001)

| Tabelle             | Inhalt                                                                                  |
| ------------------- | --------------------------------------------------------------------------------------- |
| `roles`             | Systemrollen Owner, Administrator, Moderator, Support und Viewer mit Rang               |
| `permissions`       | Alle Berechtigungen, die es gibt (Liste in `packages/shared/src/permissions.ts`)        |
| `role_permissions`  | Welche Rolle welche Berechtigung hat. Im Dashboard änderbar, der Owner hat immer alles  |
| `users`             | Benutzer des Control Centers: Discord-ID, Anzeigename, Rolle, Status. **Kein Passwort** |
| `sessions`          | Anmeldesitzungen, gespeichert wird nur ein SHA-256-Hash des Tokens                      |
| `audit_log`         | Protokoll kritischer Aktionen. Die Datenbank selbst verhindert nachträgliche Änderungen |
| `schema_migrations` | Welche Migrationen mit welcher Prüfsumme angewendet wurden (vom Migrationsprogramm)     |

Absicherungen direkt in der Datenbank: Fremdschlüssel, eindeutige Werte (z. B. eine Discord-ID nur einmal),
Prüfregeln (z. B. Discord-IDs bestehen aus 17 bis 20 Ziffern, Status nur `active` oder `disabled`) und ein
Trigger, der `UPDATE` auf `audit_log` ablehnt. Benutzer mit Audit-Einträgen können nicht gelöscht, nur
gesperrt werden. So bleibt die Nachvollziehbarkeit erhalten.

## Befehle

| Befehl                                  | Wirkung                                                                                         |
| --------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `npm run dev:api`                       | Wendet in der **Entwicklung** ausstehende Migrationen automatisch an und startet das Backend    |
| `npm run db:migrate`                    | Wendet ausstehende Migrationen an. Nutzt `DATABASE_URL`, sonst die lokale Entwicklungsdatenbank |
| `npm run db:migrate:dist -w @emden/api` | Dasselbe mit dem gebauten Code, für die Produktion ohne Entwicklungswerkzeuge                   |

In **Produktion** wendet das Backend Migrationen nie selbst an. `db:migrate` ist dort ein eigener Schritt
vor dem Start der neuen Version. Bis dahin meldet `/ready` den Status `not_ready`.

## Eine neue Migration anlegen

1. Neue Datei `apps/api/migrations/NNNN_beschreibung.sql` mit der nächsten freien Nummer anlegen
   (lückenlos, nur Kleinbuchstaben, Ziffern und `_`).
2. Die Tabellenbeschreibung in `apps/api/src/db/schema.ts` passend ergänzen.
3. `npm test` ausführen. Der **Schema-Abgleich** schlägt fehl, wenn SQL und TypeScript nicht zusammenpassen.

**Regeln:**

- Eine bereits angewendete Migration wird **nie** geändert. Das Migrationsprogramm vergleicht Prüfsummen und
  bricht sonst mit einer klaren Meldung ab.
- Jede Datei läuft in einer eigenen Transaktion, also vollständig oder gar nicht.
- Auf PostgreSQL verhindert eine Sperre, dass zwei Instanzen gleichzeitig migrieren.
- Es gibt keine „Rückwärts-Migrationen“. Ein Fehler wird mit einer neuen Migration korrigiert. Vor Migrationen
  in Produktion wird ein Backup erstellt (Phase 7).

## Echtes PostgreSQL lokal nutzen (optional)

Nicht nötig für die normale Entwicklung. Wer es möchte, trägt in der `.env` eine `DATABASE_URL` ein,
zum Beispiel `postgres://BENUTZER:PASSWORT@localhost:5432/emden_network`, und führt `npm run db:migrate` aus.

Für die Integrationstests gegen echtes PostgreSQL:

```bash
TEST_DATABASE_URL=postgres://BENUTZER:PASSWORT@localhost:5432/postgres npm test
```

Die Tests legen dafür eine eigene, zufällig benannte Datenbank an und löschen sie danach wieder. Die Rolle
braucht das Recht `CREATEDB`. Ohne `TEST_DATABASE_URL` werden diese Tests als „skipped“ angezeigt.

## Häufige Meldungen

| Meldung                                                                           | Bedeutung                                                                                                              |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| „Die lokale Entwicklungsdatenbank wird gerade von einem anderen Programm benutzt“ | Das Backend läuft schon in einem anderen Tab. Dort mit Control + C beenden.                                            |
| „… wurde nach dem Anwenden verändert“                                             | Eine bereits angewendete Migrationsdatei wurde bearbeitet. Änderung rückgängig machen und eine neue Migration anlegen. |
| „… Migration(en) ausstehend“ (im Systemstatus)                                    | `npm run db:migrate` ausführen.                                                                                        |
| „Die Datenbank kennt Migration N, die im Code fehlt“                              | Es läuft eine ältere Programmversion als zuletzt. Aktuellen Stand holen (`git pull`).                                  |

Die lokale Entwicklungsdatenbank enthält nur Testdaten. Ist sie kaputt, kann der Ordner `apps/api/.data`
gelöscht werden, wenn das Backend gestoppt ist. Beim nächsten Start wird er neu angelegt. **Achtung:** Alle
lokalen Testdaten, zum Beispiel angelegte Benutzer, sind dann weg.
