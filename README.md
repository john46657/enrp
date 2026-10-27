# ENRP Discord-Bot

Ein Discord-Bot für Roleplay-Server mit Bewerbungssystem, Moderation, Ticket-System und Community-Funktionen.
Er ist in JavaScript mit [discord.js](https://discord.js.org) geschrieben, braucht keine externe Datenbank
und läuft auf jedem Bot-Hoster mit Node.js 18 oder neuer. Ein Bot kann auf **beliebig vielen Servern** gleichzeitig laufen –
jeder Server hat seine eigenen Kanäle, Rollen, Tickets, Bewerbungen, Verwarnungen und Level.

## Funktionen

| Bereich | Befehle / Features |
|---|---|
| 📋 **Bewerbungen** | Polizei-Bewerbung und Einheiten (SEK, Flugstaffel, Ausbilder …) · Fragen per DM inkl. Roblox-Konto · Annehmen/Ablehnen mit Grund, Statusschritte, Rollen automatisch · Sperren · KI-Checker · Statistik – **ausführlich in [docs/applications.md](docs/applications.md)** |
| 🎭 **Roleplay** | `/serverstatus`: FiveM-Status und Spielerliste · `/ankuendigung`: Ankündigungen als Embed · Bot-Status zeigt Spieleranzahl |
| 🛡️ **Moderation** | `/kick` `/ban` `/unban` `/timeout` `/warn` `/verwarnungen anzeigen\|loeschen` `/clear` `/melden` · Berechtigungen per Rolle · Warn-Limit, Ablauf, Warn-Rollen, öffentliche Verwarnung · Honeypot-Köderkanal · Auto-Mod (Hoisting, Einladungen, Links, Spam, Caps, Pings) · DM an Betroffene · Mod-Log |
| 🎫 **Tickets** | Panel mit Kategorien (einzeln abschaltbar), `/ticket fuer` (im Auftrag), eigenes Eröffnungs-Embed, Formular beim Schließen, Schließungs-Anfrage, Auto-Close, **Live-Auslastung** und Banner · Öffnungszeiten · Limit pro Nutzer · Kanalnamen mit Platzhaltern · Übernehmen/Freigeben · Schließen mit Rückfrage und optionalem Grund · Claim-Kategorie · Auto-Team-Alert & Auto-Unclaim · Personen-Anfragen durch Ersteller · Aktivitäts-Log & Transkripte |
| 🎉 **Community** | Willkommensnachricht + Auto-Rolle · `/rollenpanel` (Rollen per Button) · `/umfrage` (native Discord-Umfragen) · Level-System mit `/rang`, `/bestenliste` und Rollen-Belohnungen |
| 👥 **Teamverwaltung** | Team-Rollen mit Rechten · `/team verwarnen\|verwarnungen\|verwarnung-entfernen` mit Ablauf, Warn-Rollen, öffentlichem Post · `/team rang` (Up-/Downrank mit Fall-Nummer, Log, DM, Ankündigung, optional Angebot zum Annehmen) · Live-Teamliste · `/abwesend` `/zurueck` mit Abwesenheitsliste und -rolle |
| 📊 **Server-Statistiken** | Gesperrte Sprachkanäle mit Zählern (Mitglieder, Menschen, Bots, Boosts, Kanäle, Rollen, offene Tickets), Name mit `{count}`, Umbenennung höchstens alle 5 Minuten |
| ⚙️ **Verwaltung** | `/einstellungen`: Kanäle, Rollen, Tickets, Öffnungszeiten, Level und FiveM direkt in Discord ändern, ohne Neustart – je Server getrennt |
| 📖 | `/hilfe` zeigt alle Befehle |

## 1. Bot bei Discord anlegen

1. Öffne das [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**.
2. Links auf **Bot** → **Reset Token** → Token kopieren (niemals teilen!).
3. Unter **Bot → Privileged Gateway Intents** einschalten:
   - ✅ **Server Members Intent** (Willkommen, Auto-Rolle, Tickets und Bewerbungen beim Verlassen)
   - ✅ **Message Content Intent** (Ticket-Transkripte)
4. Links auf **OAuth2 → URL Generator**: Scopes `bot` und `applications.commands`, Berechtigung
   `Administrator` (am einfachsten) → Link öffnen und Bot auf deinen Server einladen. Mit demselben Link
   kannst du ihn auf weitere Server einladen.
   > Soll niemand außer dir den Bot einladen können, schalte unter **Bot** die Option **Public Bot** aus.
5. Ziehe die Bot-Rolle unter **Servereinstellungen → Rollen** möglichst weit nach oben, sonst kann er
   keine Rollen vergeben und niemanden bestrafen, der über ihm steht.

## 2. Konfigurieren

**`.env`** (aus `.env.example` kopieren):

```env
DISCORD_TOKEN=dein-bot-token
```

`GUILD_ID` brauchst du nicht mehr. Nur wenn der Bot schon vor dem Mehr-Server-Update lief und inzwischen auf
mehreren Servern ist, trägst du dort die ID des alten Servers ein, damit dessen `/einstellungen`-Änderungen
ihm zugeordnet werden. Ist der Bot nur auf einem Server, passiert das automatisch.

> IDs bekommst du per Rechtsklick → „ID kopieren“. Dafür in Discord unter
> *Einstellungen → Erweitert* den **Entwicklermodus** einschalten.

### Mehrere Server

- Die `config.json` ist die **Vorlage für alle Server**: Texte, Ticket-Kategorien, Bewerbungsarten und Fragen.
- Kanäle und Rollen sind auf jedem Server andere. Lass sie in der `config.json` leer und stelle sie auf jedem
  Server mit `/einstellungen` ein. Diese Änderungen gelten nur für den Server, auf dem du sie machst.
- Slash-Commands erscheinen auf jedem Server sofort, auch wenn du den Bot später auf einen neuen Server einlädst.
- Tickets, Bewerbungen, Sperren, Verwarnungen und Level werden je Server getrennt gespeichert.

**`config.json`**: Vorlage für alle Server (leere Felder werden einfach übersprungen). Kanäle und Rollen stellst
du bei mehreren Servern besser je Server mit `/einstellungen` ein:

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
| `onCreatorLeave` | Wenn der Ersteller den Server verlässt: `"nothing"` = nichts, `"notify"` = Hinweis im Ticket, `"close"` = Hinweis als Grund und schließen |
| `leaveMessage` | Text dazu, Platzhalter `{user}` `{username}` |
| `logging.activities` | Öffnen, Übernehmen, Freigeben, Hinzufügen, Schließen in `channels.ticketLog` protokollieren |
| `logging.transcripts` | Verlauf beim Schließen als `.txt` speichern (Log-Kanal + DM an Ersteller) |
| `claimCategory.enabled` / `categoryId` | Übernommene Tickets in diese Kategorie verschieben (beim Freigeben zurück) |
| `openingHours` | `enabled`, `timezone` und `periods` mit Tagen `mo di mi do fr sa so` und Zeiten `"15:00"`–`"23:00"` (auch über Mitternacht, `"24:00"` = Tagesende). Außerhalb bekommt jedes neue Ticket einen Hinweis, wann das Team wieder da ist, und Erinnerungen pausieren. |
| `autoTeamAlert` | Team erneut markieren, wenn nach `afterMinutes` noch niemand geantwortet hat; `message` = eigener Text (`{user}` `{since}`) |
| `autoClose` | Ticket schließen, wenn `afterHours` lang niemand geschrieben hat (pausiert außerhalb der Öffnungszeiten) |
| `autoUnclaim` | Ticket automatisch freigeben, wenn der Bearbeiter `afterHours` lang nichts schreibt |
| `types[]` | Kategorien: `id`, `prefix`, `label`, `emoji`, `description`, `capacity` (für die Auslastung, `0` = ausblenden), `roles` (eigene Team-Rollen, leer = `roles.support`), optional `categoryId` – weitere Felder siehe unten |

**Je Kategorie (`types[]`)** gibt es zusätzlich:

| Feld | Bedeutung |
|---|---|
| `enabled` | `false` = Kategorie nicht im Panel anbieten |
| `allowClaim` | `false` = kein „Übernehmen“-Button |
| `allowOnBehalf` | Team darf mit `/ticket fuer` ein Ticket für ein Mitglied öffnen |
| `openEmbed` | Eröffnungs-Embed: `title`, `description`, `image`; Platzhalter `{user}` `{username}` `{category}` `{emoji}` `{number}` (leer = Standardtext) |
| `closeForm` | Formular beim Schließen, max. 5 Felder: `label`, `style` (`short`/`paragraph`), `placeholder`, `maxLength`, `required`. Die Antworten landen im Log und in der DM. |
| `onlyTeamCanClose`, `onCreatorLeave`, `leaveMessage`, `autoClose`, `autoTeamAlert` | Wie oben, gelten nur für diese Kategorie. Fehlen sie, gilt der allgemeine Wert. |

Darf nur das Team schließen (`onlyTeamCanClose`), bekommt der Ersteller beim Schließen keine Fehlermeldung, sondern
stellt eine **Schließungs-Anfrage**: Ein Teammitglied stimmt zu oder lässt das Ticket offen.

### Moderation (`moderation`)

| Feld | Bedeutung |
|---|---|
| `enabled` | Aus = Moderationsbefehle, Auto-Mod und Honeypot sind abgeschaltet |
| `dmOnAction` / `logEnabled` | Betroffene per DM informieren / Aktionen in `channels.modLog` protokollieren |
| `ignoredRoles` | Mitglieder mit diesen Rollen können nicht bestraft werden |
| `permissions` | Rollen je Aktion: `timeout` `warn` `kick` `ban` `viewLogs`. Admins und Mitglieder mit dem passenden Discord-Recht dürfen immer. |
| `warnings.expire` | `enabled`, `days`: Verwarnungen laufen ab und zählen dann nicht mehr (mit `/warn ablauf:` je Verwarnung anders) |
| `warnings.dmOnExpire` | Mitglied per DM informieren, wenn eine Verwarnung abläuft |
| `warnings.roles` | Bis zu 5 Rollen „Warn 1“ … „Warn 5“, passend zur Anzahl aktiver Verwarnungen |
| `warnings.publicChannel` | Jede Verwarnung zusätzlich öffentlich in diesen Kanal posten (leer = aus) |
| `warnings.limit` | `enabled`, `count`, `action` (`kick` `ban` `timeout`), `timeoutMinutes` |
| `report` | `/melden`: `enabled`, `channel`, `pingRoles` – das Team markiert Meldungen als erledigt oder abgelehnt |
| `honeypot` | Köderkanal gegen Scam-Konten: `enabled`, `channel`, `action` (`kick` `ban` `timeout`), `deleteMessages` (`none` `hour` `day`), `dm`, `dmTitle`, `dmText` (`{user}` `{server}` `{action}` `{invite}`), `invite` (einmaliger Link nach einem Kick), `warnTitle`/`warnText` (Hinweis im Kanal) |
| `automod` | `ignoredRoles` und Regeln `hoisting`, `invites`, `links` (`allowed` = erlaubte Domains), `spam` (`messages` in `seconds`), `caps` (`percent`, `minLength`), `ping` (`roles` = geschützte Rollen) – jeweils mit `enabled` |

Teammitglieder (Admin, Nachrichten verwalten, Kicken, Bannen, Timeout), der Server-Besitzer und ignorierte Rollen lösen
den Honeypot nicht aus. Von Auto-Mod sind Admins, „Nachrichten verwalten“ und `automod.ignoredRoles` ausgenommen.
Die Moderationsbefehle sind jetzt für alle sichtbar und prüfen die Berechtigung selbst, damit Rollen aus
`permissions` sie nutzen können.

### Teamverwaltung (`team`)

| Feld | Bedeutung |
|---|---|
| `enabled` | Aus = `/team`, `/abwesend`, `/zurueck` antworten nur mit einem Hinweis |
| `logChannel` / `dmNotify` | Log für Rang-Änderungen und Team-Verwarnungen / Mitglied per DM informieren |
| `roles[]` | Team-Rollen: `{ "id": "ROLLEN_ID", "perms": ["absence", "warn", "rank"] }`. Admins („Server verwalten“) dürfen immer. |
| `warnings` | Team-Verwarnungen: `enabled`, `expire`, `dmOnExpire`, `roles` (Warn 1–5), `publicChannel` – wie bei der Moderation |
| `rank` | `reasonRequired`, `announceChannel` (öffentliche Ankündigung, leer = aus), `announceTitle`/`announceText` (`{user}` `{username}` `{oldrole}` `{newrole}` `{server}`), `offer` (`enabled`, `channel`, `hours`): Upranks erst nach „Annehmen“ durch das Mitglied |
| `teamList` | `enabled`, `channel`, `roles`: Nachricht mit allen Mitgliedern je Rolle, aktualisiert sich bei Rollenänderungen |
| `absence` | `enabled`, `channel` (Liste der Abwesenden), `role` (wird während der Abwesenheit vergeben) |

Rang-Aufstieg mit automatischen Laufbahnen und der Team-Kalender sind (noch) nicht enthalten.

### Server-Statistiken (`stats`)

| Feld | Bedeutung |
|---|---|
| `enabled` | Statistik-Kanäle anlegen und aktualisieren. Aus = bestehende Kanäle bleiben unverändert. |
| `categoryId` | Discord-Kategorie für neue Statistik-Kanäle (leer = ganz oben) |
| `counters[]` | `type` (`members` `humans` `bots` `boosts` `channels` `roles` `tickets`) und `name` mit `{count}`. Entfernte Zähler löschen ihren Kanal. |

Der Bot braucht dafür „Kanäle verwalten“. Discord erlaubt nur zwei Umbenennungen je Kanal in 10 Minuten, daher
aktualisiert sich ein Kanal höchstens alle 5 Minuten.

Nach jeder Änderung an `config.json` den Bot neu starten. Mit `npm run check` kannst du vorher
prüfen, ob die Konfiguration gültig ist.

### Einstellungen direkt in Discord (`/einstellungen`)

Die meisten Werte kannst du auch ohne Dateizugriff ändern (nur mit „Server verwalten“). Änderungen gelten
sofort und **nur für diesen Server**, werden in `data/db.json` gespeichert und haben Vorrang vor der `config.json`.

| Unterbefehl | Was du einstellst |
|---|---|
| `anzeigen` | Übersicht aller aktuellen Werte |
| `kanal` / `rolle` | Log- und Willkommenskanäle bzw. Support-, Staff- und Auto-Rolle (ohne Auswahl = entfernen) |
| `bewerbung` / `bewerbungs-kanaele` | je Bewerbungsart: aktiv, Panel, Kanäle, Manager-/Ping-/Annahme-/Ausstehend-/Pflicht-Rolle, Wartezeit, Zeitlimit, Verhalten beim Verlassen, Team-Threads; Standard-Kanäle |
| `tickets` | Kategorie, Claim-Kategorie, Limit, Team markieren, Schließ-Regeln, Verhalten beim Verlassen, Logs, Transkripte, Auslastung, Kanalname, Auto-Alert (mit Text), Auto-Unclaim, Auto-Close |
| `ticket-panel` | Titel, Beschreibung, Banner, Fußzeile und Auswahltext (`-` leert ein Feld) |
| `ticket-kategorie` | je Kategorie: Kapazität, Team-Rolle, Discord-Kategorie, Beschreibung, aktiv, Claimen, `/ticket fuer`, nur Team schließt, Verhalten beim Verlassen, Auto-Close, Erinnerung, Eröffnungs-Embed; `allgemein_verwenden` setzt die eigenen Regeln zurück |
| `ticket-formular` | Formular beim Schließen je Kategorie: Feld 1–5 mit Frage, Art, Platzhalter, Länge, Pflicht (oder `entfernen`) |
| `oeffnungszeiten` | An/aus, Zeitzone und Zeiten, z. B. `mo-fr 15:00-23:00; sa,so 12:00-24:00` |
| `willkommen` | Willkommensnachricht mit `{user}` `{name}` `{server}` `{count}` |
| `level` | An/aus, Cooldown, Rollen-Belohnungen (Level + Rolle; ohne Rolle = Belohnung entfernen) |
| `fivem` | Server-Adresse und Verbinden-Link |
| `statistik` | Server-Statistiken an/aus, Kategorie für neue Kanäle, Statistik hinzufügen/umbenennen/entfernen |
| `zuruecksetzen` | Alle Discord-Änderungen dieses Servers verwerfen, wieder die `config.json` verwenden |

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
3. Die `.env`-Datei mit dem Token hochladen bzw. im Dateimanager anlegen.
4. Als Startdatei (`Main file` / `JS file`) `index.js` eintragen, dann starten.
5. In der Konsole sollte `✅ Eingeloggt als …` und für jeden Server `✅ 21 Slash-Commands auf „…“ registriert` stehen.

Die Daten (Verwarnungen, Level, Tickets) liegen in `data/db.json`. Diesen Ordner beim Aktualisieren
nicht löschen.

## 4. Einrichten auf dem Server

Auf **jedem** Server, auf dem der Bot läuft:

1. Mit `/einstellungen kanal` und `/einstellungen rolle` Kanäle und Rollen festlegen.
2. `/ticket panel` im Support-Kanal ausführen.
3. `/bewerbungspanel` und `/qualipanel` in den Bewerbungs-Kanälen ausführen (Einrichtung: [docs/applications.md](docs/applications.md#14-schnellstart)).
4. Optional `/rollenpanel` für selbst wählbare Rollen.

## Projektstruktur

```
index.js              Start, lädt Befehle und Events
config.json           Einstellungen (keine Geheimnisse)
src/commands/…        Slash-Befehle, nach Bereich sortiert
src/events/…          Discord-Events (Start, Interaktionen, Join/Leave, Nachrichten)
src/lib/…             Gemeinsame Logik (Datenbank, Einstellungen je Server, Tickets, Öffnungszeiten, Level, FiveM)
scripts/check.js      Offline-Prüfung: npm run check
```
