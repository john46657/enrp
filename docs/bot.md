# Discord-Bot

Der Bot (`apps/bot`) ist ein dünner Client der API: Jede Aktion läuft über `/api/v1` mit dem Service-Token und
der handelnden Person (`X-Actor-Id`, `X-Actor-Roles`). Vor jedem Befehl prüft der Bot die Befehlsrechte
(inkl. Overrides); die API prüft jede Aktion erneut. Antworten auf Verwaltungsbefehle sind nur für die Person
sichtbar.

## Befehle

| Befehl | Unterbefehle |
|---|---|
| `/verify` | `start`, `status`, `unlink` |
| `/profile` | `me`, `view`, `history` |
| `/leaderboard` | `playtime`, `duty` |
| `/faction` | `list`, `members`, `add`, `transfer`, `remove` |
| `/duty` | `status`, `stats`, `sessions` |
| `/vehicle` | `list`, `info` |
| `/mod` | `warn`, `timeout`, `kick`, `ban`, `unban`, `history`, `revoke` |
| `/report` | `create`, `list`, `resolve` |
| `/appeal` | `create`, `review` |
| `/suggest` | `create`, `status` (+ Abstimmungsbuttons) |
| `/poll` | `create`, `close` (+ Abstimmungsbuttons) |
| `/giveaway` | `create`, `draw`, `cancel` (+ Teilnahmebutton) |
| `/announce` | `create` |
| `/rules` | `show`, `accept` |
| `/permissions` | `view`, `grant`, `revoke`, `test`, `reset` |
| `/approval` | `create`, `view`, `approve`, `reject`, `pending` |
| `/audit` | `search`, `diff`, `export`, `verify`, `retention` |
| `/data` | `inspect`, `export`, `deletion-request`, `retention`, `cleanup-preview` |
| `/ops` | `health`, `metrics`, `dependencies`, `queue`, `alerts` |
| `/incident` | `create`, `assign`, `update`, `resolve`, `history` |
| `/feature` | `list`, `enable`, `disable`, `status`, `history` |
| `/killswitch` | `status`, `activate`, `deactivate` |
| `/deploy` | `status`, `prepare`, `approve`, `history`, `rollback` |
| `/env` | `status`, `compare`, `config-diff`, `promote`, `history` |
| `/automation` | `list`, `create`, `pause`, `test`, `history` |
| `/backup` | `status`, `run` |
| `/cad` | `list`, `info`, `create`, `assign`, `status`, `note`, `close`, `unit`, `units` (+ Buttons Übernehmen/Anfahrt/Vor Ort/Abschließen an jeder Einsatzmeldung) |
| `/live` | `players`, `vehicles`, `plate` |
| `/bolo` | `list`, `vehicle`, `person`, `clear` (+ Button „Fahndung aufheben“ an Alarmen) |
| `/ingame` | `jail`, `unjail`, `wanted`, `heal`, `respawn`, `team`, `pm`, `kill`, `kick` (Spieler per Name oder Roblox-ID, muss online sein) |
| `/status`, `/hilfe` | – |

Discord-Moderation beachtet die Rollenhierarchie (niemand sanktioniert gleich- oder höhergestellte Personen,
Owner und Bot sind geschützt) und Discord-Grenzen (Timeout max. 28 Tage). Teammitglieder mit
Moderationsrechten können nur mit `moderation:approve` sanktioniert werden; permanente Banns ebenso.

## Mehrere Discord-Server

Der Bot kann in mehreren Discords gleichzeitig sein:

- **Haupt-Discord** (`DISCORD_GUILD_ID`): alles wie bisher – alle Befehle inklusive Altmodule, Begrüßung,
  Kanäle unter *Bot-Verwaltung → Konfiguration*.
- **Weitere Discords** (Discords der Privat-Server und andere): Sobald der Bot eingeladen wird, meldet er den
  Discord bei der Plattform und registriert dort die Plattform-Befehle (ohne Altmodule). Er erscheint dann im
  Dashboard unter *Bot-Verwaltung → Discord-Server*. Dort stellt das Team (`settings:edit`) ein:
  - **Zugeordneter Privat-Server**: dessen Notrufe, Mod-Calls, Fahndungstreffer und Spiel-Logs landen in diesem
    Discord. Ist dort kein Kanal eingestellt, geht es wie bisher in den Haupt-Discord. Ein Privat-Server kann nur
    einem Discord zugeordnet sein.
  - **Eigene Kanäle/Rollen**: Leitstellen-Kanal und -Rolle (Ping), Mod-Call-Kanal, Spiel-Logs je Kategorie,
    Live-Panel (zeigt beim Privat-Server-Discord nur dessen Server). Leer = aus.
  - **Globale Banns übernehmen**: Discord-Banns mit der Option `global` (z. B. `/mod ban … global:true`, nur aus
    dem Haupt-Discord oder Dashboard) gelten dann auch hier – inklusive Aufheben und Ablauf.
- **Rechte je Discord getrennt**: Unter *Rollen & Rechte* kann eine Zuweisung auf einen Discord-Server beschränkt
  werden. Sie gilt dann nur bei Befehlen aus genau diesem Discord, nicht im Haupt-Discord und nicht im Dashboard.
  Discord-Aktionen (Kick, Timeout, Bann) aus einem weiteren Discord wirken nur dort. Roblox-Sanktionen wirken im
  ganzen Spiel und brauchen deshalb Rechte, die auch außerhalb dieses Discords gelten.
- Verlässt der Bot einen Discord, wird er als „Bot nicht mehr drin“ markiert (Einstellungen bleiben erhalten).

## Altmodule (bisheriger Bot)

Unverändert weiter in Betrieb (`apps/bot/legacy`, eigene `config.json`): `/bewerbung`, `/bewerbungen`,
`/bewerbungspanel`, `/qualipanel`, `/bewerbungssperre`, `/ticket` (Ticketpanel), `/rang`, `/bestenliste`,
`/rollenpanel`, `/einstellungen`, `/clear`. Tickets aus dem Ticketpanel werden beim Öffnen, Übernehmen und
Schließen in die Datenbank gespiegelt und erscheinen im Dashboard.

Ersetzt und nicht mehr geladen: `/ban`, `/kick`, `/warn`, `/timeout`, `/unban`, `/verwarnungen` (→ `/mod`,
mit Datenbank und Audit), `/serverstatus` (FiveM → `/status` für Roblox), `/ankuendigung` (→ `/announce`),
`/umfrage` (→ `/poll`), `/hilfe` (neu). Alte Verwarnungen aus `db.json` werden nicht automatisch migriert.

### Altbefehle im Rechtesystem

Jeder Altbefehl hat jetzt eine Regel im zentralen Rechtekatalog und erscheint im Dashboard unter
*Bot-Verwaltung → Befehle & Overrides*. Neues Recht **Bewerbungen** (`applications:view|edit|delete|configure`,
Startrolle Community-Management):

| Befehl | Plattform-Recht |
|---|---|
| `/bewerbung`, `/rang`, `/bestenliste` | für alle |
| `/bewerbungen offen\|in-bearbeitung\|anzeigen\|verlauf\|statistik`, `/bewerbungssperre liste` | `applications:view` |
| `/bewerbungssperre hinzufuegen\|aufheben` | `applications:edit` |
| `/bewerbungen loeschen` | `applications:delete` |
| `/bewerbungspanel`, `/qualipanel` | `applications:configure` |
| `/rollenpanel` | `community:create` |
| `/clear` | `moderation:delete` |
| `/ticket panel` · `fuer` · `schliessen\|hinzufuegen\|entfernen` | `settings:edit` · `tickets:create` · `tickets:edit` |
| `/einstellungen anzeigen` · übrige Unterbefehle | `settings:view` · `settings:edit` |

So wird entschieden (es geht keine bisherige Berechtigung verloren):

1. Im Dashboard deaktivierte Befehle (`bot.disabledCommands`) sind gesperrt.
2. Ein Rollen-Override „verweigern“ sperrt.
3. Wer das Plattform-Recht hat (oder Override „erlauben“, Owner), darf den Befehl nutzen und gilt dabei in den
   Altmodulen als Staff – auch ohne die alten Discord-Rechte oder die Staff-Rolle aus `/einstellungen`.
4. Sonst gilt wie bisher das Discord-Recht des Befehls (z. B. „Server verwalten“ für `/einstellungen`) bzw. die
   Staff-/Support-Rolle der Altmodule.
5. Ist die Plattform nicht erreichbar (oder antwortet nicht innerhalb von 1,5 s), gilt das bisherige Verhalten.

Die Altbefehle sind deshalb in Discord für alle sichtbar; wer sie nicht nutzen darf, bekommt eine Absage.

### Buttons der Altmodule

Auch die Staff-Aktionen hinter Buttons, Menüs und Formularen hängen am Rechtesystem
(`LEGACY_COMPONENT_PERMISSIONS`). Wer das Plattform-Recht hat, gilt bei dieser Aktion als Staff – zusätzlich zu
den bisherigen Staff-/Support-/Manager-Rollen, von denen niemand etwas verliert:

| Buttons | Plattform-Recht |
|---|---|
| Ticket übernehmen, freigeben, schließen (inkl. Rückfrage, Formular, Schließungs-Anfrage), Personen-Anfrage bestätigen/ablehnen | `tickets:edit` |
| Bewerbung annehmen/ablehnen (mit Grund), Prüfschritt weiter, Ticket mit dem Bewerber öffnen | `applications:edit` |
| Verlauf eines Bewerbers ansehen | `applications:view` |

Ticket öffnen, bewerben und das Rollenpanel bleiben für alle. Der Bot fragt die Plattform höchstens 1,5 s lang und
merkt sich das Ergebnis 30 s; ist sie nicht erreichbar, gelten nur die bisherigen Rollen.

### Altmodule im Dashboard

Unter **Discord-Module** lassen sich die Altmodule des Haupt-Discords im Dashboard ansehen und bearbeiten:

| Seite | Inhalt | Rechte |
|---|---|---|
| Bewerbungen | Liste mit Filter und Suche, Antworten, Verlauf, interne Notizen, annehmen/ablehnen mit Grund, Prüfschritte, löschen · „In Bearbeitung“ · Sperren anlegen/aufheben · Statistik · Einrichtung: Panels, Team-Kanäle, je Bewerbungsart Rollen, Kanäle, Texte und Fragen, Panel posten | `applications:view` · `edit` · `delete` · `configure` |
| Ticketpanel | offene Tickets, Aussehen, Kategorien, Verhalten, Automatik, Öffnungszeiten, Panel posten/aktualisieren | `tickets:view`, `settings:view` · `settings:edit` |
| Level-System | Rangliste, XP setzen/löschen, Einstellungen, Rollen-Belohnungen | `community:view` · `community:edit`/`delete` · `settings:edit` |
| Rollenpanel | neues Panel mit bis zu 10 Rollen posten | `community:view` · `community:create` |
| Kanäle & Rollen | Log-Kanäle, Support-/Staff-/Auto-Rolle, Zeitzone, Roblox-Spiel, bisherige Begrüßung, alles zurücksetzen | `settings:view` · `settings:edit` · `settings:configure` |

Es sind dieselben Werte wie bei `/einstellungen`; Änderungen gelten sofort und landen im Audit-Log
(`legacy.*`). Neue Ticket-Kategorien und Bewerbungsarten werden weiterhin in `apps/bot/legacy/config.json` angelegt.

So funktioniert es: Die Daten der Altmodule liegen beim Bot (`data/db.json`). Das Dashboard stellt eine Anfrage an
die API (`/api/v1/legacy/…`), die das Recht prüft und sie in `legacy_requests` ablegt. Der Bot holt Anfragen per
Long-Polling ab (`GET /api/v1/bot/legacy/requests`), führt sie mit den Altmodulen aus
(`apps/bot/legacy/src/lib/platformBridge.js`) und meldet das Ergebnis zurück; die Anfrage des Dashboards wartet
darauf. Aktionen laufen im Namen der angemeldeten Person – sie muss Mitglied des Haupt-Discords sein. Läuft der Bot
nicht (oder mit `LEGACY_MODULES=false`), zeigt das Dashboard nach etwa 12 s „Der Bot antwortet nicht“ und führt die
Anfrage später nicht mehr aus.

Die Begrüßung neuer Mitglieder kommt aus dem Dashboard (*Community-Tools → Begrüßung*); ist sie dort
deaktiviert, gilt die bisherige Begrüßung aus der `config.json`.
