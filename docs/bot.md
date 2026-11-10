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
| `/status`, `/hilfe` | – |

Discord-Moderation beachtet die Rollenhierarchie (niemand sanktioniert gleich- oder höhergestellte Personen,
Owner und Bot sind geschützt) und Discord-Grenzen (Timeout max. 28 Tage). Teammitglieder mit
Moderationsrechten können nur mit `moderation:approve` sanktioniert werden; permanente Banns ebenso.

## Altmodule (bisheriger Bot)

Unverändert weiter in Betrieb (`apps/bot/legacy`, eigene `config.json`): `/bewerbung`, `/bewerbungen`,
`/bewerbungspanel`, `/qualipanel`, `/bewerbungssperre`, `/ticket` (Ticketpanel), `/rang`, `/bestenliste`,
`/rollenpanel`, `/einstellungen`, `/clear`. Tickets aus dem Ticketpanel werden beim Öffnen, Übernehmen und
Schließen in die Datenbank gespiegelt und erscheinen im Dashboard.

Ersetzt und nicht mehr geladen: `/ban`, `/kick`, `/warn`, `/timeout`, `/unban`, `/verwarnungen` (→ `/mod`,
mit Datenbank und Audit), `/serverstatus` (FiveM → `/status` für Roblox), `/ankuendigung` (→ `/announce`),
`/umfrage` (→ `/poll`), `/hilfe` (neu). Alte Verwarnungen aus `db.json` werden nicht automatisch migriert.

Die Begrüßung neuer Mitglieder kommt aus dem Dashboard (*Community-Tools → Begrüßung*); ist sie dort
deaktiviert, gilt die bisherige Begrüßung aus der `config.json`.
