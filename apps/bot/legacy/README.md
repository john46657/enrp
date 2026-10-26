# ENRP Discord-Bot

Ein Discord-Bot für Roleplay-Server mit Bewerbungssystem, Moderation, Ticket-System und Community-Funktionen.
Er ist in JavaScript mit [discord.js](https://discord.js.org) geschrieben, braucht keine externe Datenbank
und läuft auf jedem Bot-Hoster mit Node.js 18 oder neuer.

## Funktionen

| Bereich | Befehle / Features |
|---|---|
| 📋 **Bewerbungen** | Polizei-Bewerbung und Einheiten (SEK, Flugstaffel, Ausbilder …) · Fragen per DM inkl. Roblox-Konto · Annehmen/Ablehnen mit Grund, Statusschritte, Rollen automatisch · Sperren · KI-Checker · Statistik – **ausführlich in [docs/applications.md](docs/applications.md)** |
| 🎭 **Roleplay** | `/serverstatus`: FiveM-Status und Spielerliste · `/ankuendigung`: Ankündigungen als Embed · Bot-Status zeigt Spieleranzahl |
| 🛡️ **Moderation** | `/kick` `/ban` `/unban` `/timeout` `/warn` `/verwarnungen anzeigen\|loeschen` `/clear` · Rollen-Hierarchie wird geprüft · DM an Betroffene · Mod-Log |
| 🎫 **Tickets** | Panel mit Kategorien, **Live-Auslastung** und Banner · Öffnungszeiten · Limit pro Nutzer · Kanalnamen mit Platzhaltern · Übernehmen/Freigeben · Schließen mit Rückfrage und optionalem Grund · Claim-Kategorie · Auto-Team-Alert & Auto-Unclaim · Personen-Anfragen durch Ersteller · Aktivitäts-Log & Transkripte |
| 🎉 **Community** | Willkommensnachricht + Auto-Rolle · `/rollenpanel` (Rollen per Button) · `/umfrage` (native Discord-Umfragen) · Level-System mit `/rang`, `/bestenliste` und Rollen-Belohnungen |
| ⚙️ **Verwaltung** | `/einstellungen`: Kanäle, Rollen, Tickets, Öffnungszeiten, Level und FiveM direkt in Discord ändern, ohne Neustart |
| 📖 | `/hilfe` zeigt alle Befehle |

## 1. Bot bei Discord anlegen

1. Öffne das [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**.
2. Links auf **Bot** → **Reset Token** → Token kopieren (niemals teilen!).
3. Unter **Bot → Privileged Gateway Intents** einschalten:
   - ✅ **Server Members Intent** (Willkommen, Auto-Rolle, Tickets und Bewerbungen beim Verlassen)
   - ✅ **Message Content Intent** (Ticket-Transkripte)
4. Links auf **OAuth2 → URL Generator**: Scopes `bot` und `applications.commands`, Berechtigung
   `Administrator` (am einfachsten) → Link öffnen und Bot auf deinen Server einladen.
5. Ziehe die Bot-Rolle unter **Servereinstellungen → Rollen** möglichst weit nach oben, sonst kann er
   keine Rollen vergeben und niemanden bestrafen, der über ihm steht.

## 2. Konfigurieren

**`.env`** (aus `.env.example` kopieren):

```env
DISCORD_TOKEN=dein-bot-token
GUILD_ID=id-deines-servers
```

> IDs bekommst du per Rechtsklick → „ID kopieren“. Dafür in Discord unter
> *Einstellungen → Erweitert* den **Entwicklermodus** einschalten.

**`config.json`**: Kanäle und Rollen eintragen (leere Felder werden einfach übersprungen):

| Feld | Bedeutung |
|---|---|
| `channels.welcome` | Willkommensnachrichten |
| `channels.modLog` | Moderations-Log |
| `channels.ticketLog` | Ticket-Aktivitäten und Transkripte |
| `channels.levelUp` | Level-Up-Nachrichten (leer = im selben Kanal) |
| `roles.autoRole` | Bekommt jedes neue Mitglied |
| `roles.support` | Standard-Team für Tickets |
| `roles.staff` | Darf alle Bewerbungen entscheiden, Tickets freigeben usw. |
| `applications` | Bewerbungsarten, Fragen, Texte, Rollen und Kanäle – siehe [docs/applications.md](docs/applications.md) |
| `fivem.address` | z. B. `123.45.67.89:30120` (leer = kein Gameserver) |
| `fivem.connectUrl` | z. B. `https://cfx.re/join/abc123` für den „Verbinden“-Button |
| `leveling.roleRewards` | z. B. `{ "10": "ROLLEN_ID" }` gibt ab Level 10 eine Rolle |

### Ticket-Einstellungen (`tickets`)

| Feld | Bedeutung |
|---|---|
| `categoryId` | Discord-Kategorie, in der Tickets erstellt werden |
| `panel.title` / `panel.description` / `panel.image` / `panel.footer` | Aussehen der Panel-Nachricht (`image` = Banner-URL) |
| `panel.showLoad` | Auslastung im Panel anzeigen (aktualisiert sich automatisch) |
| `maxOpenPerUser` | Offene Tickets pro Nutzer, `0` = kein Limit |
| `pingTeam` | Team beim Öffnen markieren |
| `channelName` | Kanalname, Platzhalter: `%PREFIX%` `%USERNAME%` `%USER_ID%` `%USER_NICK_NAME%` `%DISPLAY_NAME%` `%EMOTE%` `%TICKET_NUMBER%` (fortlaufend) `%CASEID%` (fortlaufend je Kategorie) |
| `onlyTeamCanClose` | `true` = Ersteller darf sein Ticket nicht selbst schließen |
| `creatorCanAddUsers` | Ersteller darf Personen anfragen, das Team bestätigt |
| `onCreatorLeave` | `"close"` = Ticket schließen, wenn der Ersteller den Server verlässt, `"nothing"` = offen lassen |
| `logging.activities` | Öffnen, Übernehmen, Freigeben, Hinzufügen, Schließen in `channels.ticketLog` protokollieren |
| `logging.transcripts` | Verlauf beim Schließen als `.txt` speichern (Log-Kanal + DM an Ersteller) |
| `claimCategory.enabled` / `categoryId` | Übernommene Tickets in diese Kategorie verschieben (beim Freigeben zurück) |
| `openingHours` | `enabled`, `timezone` und `periods` mit Tagen `mo di mi do fr sa so` und Zeiten `"15:00"`–`"23:00"` (auch über Mitternacht, `"24:00"` = Tagesende). Außerhalb bekommt jedes neue Ticket einen Hinweis, wann das Team wieder da ist, und Erinnerungen pausieren. |
| `autoTeamAlert` | Team erneut markieren, wenn nach `afterMinutes` noch niemand geantwortet hat |
| `autoUnclaim` | Ticket automatisch freigeben, wenn der Bearbeiter `afterHours` lang nichts schreibt |
| `types[]` | Kategorien: `id`, `prefix`, `label`, `emoji`, `description`, `capacity` (für die Auslastung, `0` = ausblenden), `roles` (eigene Team-Rollen, leer = `roles.support`), optional `categoryId` |

Nach jeder Änderung an `config.json` den Bot neu starten. Mit `npm run check` kannst du vorher
prüfen, ob die Konfiguration gültig ist.

### Einstellungen direkt in Discord (`/einstellungen`)

Die meisten Werte kannst du auch ohne Dateizugriff ändern (nur mit „Server verwalten“). Änderungen gelten
sofort, werden in `data/db.json` gespeichert und haben Vorrang vor der `config.json`.

| Unterbefehl | Was du einstellst |
|---|---|
| `anzeigen` | Übersicht aller aktuellen Werte |
| `kanal` / `rolle` | Log- und Willkommenskanäle bzw. Support-, Staff- und Auto-Rolle (ohne Auswahl = entfernen) |
| `bewerbung` / `bewerbungs-kanaele` | je Bewerbungsart: aktiv, Panel, Kanäle, Manager-/Ping-/Annahme-/Ausstehend-/Pflicht-Rolle, Wartezeit, Zeitlimit, Verhalten beim Verlassen, Team-Threads; Standard-Kanäle |
| `tickets` | Kategorie, Claim-Kategorie, Limit, Team markieren, Schließ-Regeln, Logs, Transkripte, Auslastung, Kanalname, Auto-Alert, Auto-Unclaim |
| `ticket-panel` | Titel, Beschreibung, Banner, Fußzeile und Auswahltext (`-` leert ein Feld) |
| `ticket-kategorie` | Kapazität, eigene Team-Rolle, eigene Discord-Kategorie und Beschreibung je Kategorie |
| `oeffnungszeiten` | An/aus, Zeitzone und Zeiten, z. B. `mo-fr 15:00-23:00; sa,so 12:00-24:00` |
| `willkommen` | Willkommensnachricht mit `{user}` `{name}` `{server}` `{count}` |
| `level` | An/aus, Cooldown, Rollen-Belohnungen (Level + Rolle; ohne Rolle = Belohnung entfernen) |
| `fivem` | Server-Adresse und Verbinden-Link |
| `zuruecksetzen` | Alle Discord-Änderungen verwerfen, wieder die `config.json` verwenden |

Neue Ticket-Kategorien, Bewerbungsarten und Bewerbungsfragen legst du weiterhin in der `config.json` an.

## 3. Starten

### Lokal / VPS

```bash
npm install
npm start
```

### Bot-Hoster (Pterodactyl-Panel, z. B. bot-hosting.net)

1. Server mit **Node.js** (Version 18 oder neuer) anlegen.
2. Alle Dateien hochladen **außer** `node_modules` (wird vom Panel installiert).
3. Die `.env`-Datei mit Token und Server-ID hochladen bzw. im Dateimanager anlegen.
4. Als Startdatei (`Main file` / `JS file`) `index.js` eintragen, dann starten.
5. In der Konsole sollte `✅ Eingeloggt als …` und `✅ 21 Slash-Commands … registriert` stehen.

Die Daten (Verwarnungen, Level, Tickets) liegen in `data/db.json`. Diesen Ordner beim Aktualisieren
nicht löschen.

## 4. Einrichten auf dem Server

1. `/ticket panel` im Support-Kanal ausführen.
2. `/bewerbungspanel` und `/qualipanel` in den Bewerbungs-Kanälen ausführen (Einrichtung: [docs/applications.md](docs/applications.md#14-schnellstart)).
3. Optional `/rollenpanel` für selbst wählbare Rollen.

## Projektstruktur

```
index.js              Start, lädt Befehle und Events
config.json           Einstellungen (keine Geheimnisse)
src/commands/…        Slash-Befehle, nach Bereich sortiert
src/events/…          Discord-Events (Start, Interaktionen, Join/Leave, Nachrichten)
src/lib/…             Gemeinsame Logik (Datenbank, Tickets, Öffnungszeiten, Level, FiveM)
scripts/check.js      Offline-Prüfung: npm run check
```
