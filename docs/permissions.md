# Rollen, Rechte und Freigaben

Katalog: [`packages/permissions/src/catalog.ts`](../packages/permissions/src/catalog.ts). Ein Recht hat die Form
`ressource:aktion` (Aktionen: anzeigen, erstellen, bearbeiten, löschen, genehmigen, exportieren,
veröffentlichen, Systemkonfiguration ändern). Rollen können Muster wie `tickets:*` oder `*` enthalten.

## Startrollen

| Rolle | Zweck |
|---|---|
| Owner | Vollzugriff (`*`) |
| Technische Administration | Betrieb, Monitoring, Releases, Backups, Flags, Automatisierungen |
| Community-Management | Community-Tools, Ankündigungen, Regelwerk, Codes |
| Moderation | Tickets, Reports, Fallberichte, Moderation, Einsprüche |
| Fraktionsverwaltung | Mitglieder, Dienstzeiten, Fahrzeuge – bei der Vergabe auf Fraktionen beschränken |
| Nur Lesen | Übersichten ohne interne Personendaten |

Rollen werden Discord-Rollen oder einzelnen Personen zugewiesen. Dashboard-Nutzer erhalten ihre Discord-Rollen
über die Discord-API (5 Minuten Cache); der Bot sendet die Rollen der handelnden Person bei jeder Anfrage mit.

## Fraktionsbezogene Rechte

`factions:*`, `duty:*`, `vehicles:*` können auf Fraktionen beschränkt werden (`factionIds`). Eine Versetzung
erfordert Rechte für die alte **und** die neue Fraktion.

## Schutz gegen Rechteausweitung

- Wer Rechte vergibt, braucht `permissions:edit` und muss **jedes neu vergebene Recht selbst besitzen**
  (inkl. Fraktionsbeschränkung). Wildcards nur mit eigener Wildcard.
- Wer eine Rolle zuweist, muss alle Rechte dieser Rolle selbst besitzen.
- Die Owner-Rolle ändern nur Owner.
- **Kritische Rechte** (u. a. `permissions:edit|approve|configure`, `settings:configure`, `releases:approve`,
  `backups:approve`, `privacy:delete`, `audit:export`, Wildcards) – Vergabe **und** Entzug – erzeugen eine
  Freigabeanfrage statt sofortiger Wirkung.

## Befehlsrechte (`/permissions`)

Jeder Slash-Befehl hat ein Standardrecht ([`commands.ts`](../packages/permissions/src/commands.ts)).
Overrides je Discord-Rolle: `grant` = freischalten, `revoke` = sperren, `reset` = Overrides entfernen.
Reihenfolge: Owner → Sperre → Freischaltung → Standardrecht. Gesperrte Befehle (z. B. `/permissions grant`,
`/deploy approve`, `/approval approve`, `/data deletion-request`, `/audit export`) lassen sich nicht per Override
öffnen. Freischalten kann nur, wer den Befehl selbst nutzen darf. Overrides gelten für den Bot; die API prüft
jede Aktion zusätzlich anhand der Rollenrechte.

## Vier-Augen-Prinzip (`/approval`, Freigabezentrum)

- Antragsteller kann die eigene Anfrage nicht entscheiden (Code **und** Datenbank-Constraint).
- Der Genehmigende braucht `approvals:approve` und zusätzlich das fachliche Recht der Aktion.
- Die Aktion wird bei Genehmigung in derselben Transaktion **genau einmal** ausgeführt; Payload ist per Hash
  gebunden; abgelaufene (Standard 24 h, Wiederherstellung 4 h, Löschung 72 h), abgelehnte oder bereits
  ausgeführte Anfragen sind wirkungslos.
- Freigabepflichtig: kritische Rechteänderungen und Rollenzuweisungen, Backup-Wiederherstellungen,
  Datenschutz-Löschungen. Releases haben ein eigenes Vier-Augen-Verfahren (Vorbereiter ≠ Freigebender).
