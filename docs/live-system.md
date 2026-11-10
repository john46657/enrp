# 🚓 EN | POLIZEI – Live-System für das eigene Roblox-Spiel

Der Bot verbindet euer **eigenes Roblox-Spiel** mit Discord: Live-Daten, Logs, Notrufe, Ingame-Befehle, Banns, CAD,
Dispatch und BOLO. Funktional orientiert an Bots wie Melonly, aber mit eigener Architektur – und **ohne die
ER:LC-API**: Die PRC-/ER:LC-API (`api.erlc.gg`) liefert nur Daten von ER:LC-Privatservern, nicht von einem eigenen
Spiel. Stattdessen spricht euer Spiel direkt mit dem Bot.

---

## 1. Architektur

```
Roblox-Spielserver (Skript ENRPBridge)                        EN | POLIZEI-Bot (bot-hosting.net)
  ├─ POST /bridge/v1/live    Live-Zustand alle 15 s  ───────▶  Live-Daten (nur im Speicher)
  ├─ POST /bridge/v1/events  Ereignisse (Webhooks)   ───────▶  Ereignis-Warteschlange → Logs, CAD, Mod-Calls, BOLO
  ├─ GET  /bridge/v1/sync    Befehle abholen alle 3 s ◀──────  Befehls-Ausgang (Outbox)
  ├─ GET  /bridge/v1/bans    Bannliste               ◀──────  Banns (im Bot gespeichert)
  ├─ GET  /bridge/v1/player  Bann + Rechte beim Join ◀──────  Banns, Spielrechte
  └─ POST /bridge/v1/bye     Server fährt herunter   ───────▶
           alle Anfragen HTTPS über eure Domain, signiert mit HMAC-SHA256

optional: Bot ──▶ Roblox Open Cloud (Ban-API: Banns zusätzlich bei Roblox, Zweitaccount-Erkennung; Spielstatistik)
```

- **Alles läuft über eure Domain** (z. B. `https://….apps.bot-hosting.cloud`). Der Bot startet dafür einen kleinen
  Webserver (`src/lib/web/server.js`). Die Domain leitet per HTTPS an den Port des Bots weiter.
- **Das Spiel fragt, der Bot antwortet.** Befehle aus Discord liegen im Bot bereit, bis der Spielserver sie abholt
  (spätestens nach 3 s). Das Spiel bestätigt jeden Befehl, und das Ergebnis erscheint in Discord.
- **Banns liegen im Bot.** Das Spiel prüft jeden Spieler beim Beitreten. Ist der Bot einmal nicht erreichbar, nutzt das
  Spiel die zuletzt geladene Bannliste.
- **Live-Daten werden nicht gespeichert**, nur im Arbeitsspeicher gehalten. In die Datenbank kommen nur Ereignis-Historie,
  Befehle, CAD, BOLO, Banns und Einstellungen.

---

## 2. Einrichtung

### 2.1 `.env` des Bots

| Variable | Pflicht | Bedeutung |
|---|---|---|
| `DISCORD_TOKEN` | ✅ | Bot-Token (wie bisher) |
| `PUBLIC_URL` | ✅ | Eure Domain, z. B. `https://xyz.apps.bot-hosting.cloud` (für Admin-Center und Verbindungstest) |
| `WEB_PORT` | – | Port des Webservers. Fehlt er, nimmt der Bot `SERVER_PORT` vom Bot-Hoster (Pterodactyl) |
| `ENRP_SECRET` | ✅ | Mind. 32 zufällige Zeichen. Damit verschlüsselt der Bot Schlüssel in der Datenbank (AES-256-GCM) |
| `BRIDGE_SECRET` | – | Bridge-Schlüssel direkt setzen (mind. 32 Zeichen). Sonst per `/spiel-admin bridge-schluessel` erzeugen |
| `ROBLOX_MAIN_GUILD_IDS` | ✅ | ID(s) des Haupt-Discords (mehrere mit Komma) |
| `ROBLOX_UNIVERSE_ID` | – | Für die Spielstatistik und die Roblox-Ban-API (oder `/spiel-admin universe`) |
| `ROBLOX_API_KEY` | – | Open-Cloud-Key nur für die Roblox-Ban-API (oder verschlüsselt per `/spiel-admin api-key`) |

`ENRP_SECRET` erzeugen, z. B. in einer Konsole: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`

### 2.2 Domain → Bot

Auf bot-hosting.net zeigt die Domain eures Servers auf dessen Port. Der Bot lauscht automatisch auf `SERVER_PORT`.
Beim Start steht in der Konsole `✅ Bridge-Webserver läuft auf Port …`.

> ⚠️ Auf einem Port kann nur **ein** Programm laufen. Läuft auf demselben Server schon etwas anderes (z. B. ein
> Dashboard), meldet der Bot `Port … ist schon belegt`. Dann entweder den Bot auf einem eigenen Server mit eigener
> Domain betreiben, oder das andere Programm leitet `/bridge/*` an den Bot weiter.

Prüfen: `/spiel-admin test` → „🟢 Domain erreicht den Bot“ und „🟢 Signierte Anfrage über die Domain klappt“.

### 2.3 Bridge-Schlüssel

`/spiel-admin bridge-schluessel` im Haupt-Discord erzeugt einen zufälligen Schlüssel und zeigt ihn **genau einmal**.
Gespeichert wird er verschlüsselt, angezeigt danach nur noch als Fingerabdruck. Ein neuer Schlüssel macht den alten sofort
ungültig.

### 2.4 Spiel-Skript

1. Roblox Studio → **Game Settings → Security → Allow HTTP Requests** einschalten.
2. **ServerScriptService** → Insert Object → **Script** (kein LocalScript), Name `ENRPBridge`.
3. Inhalt von [`roblox/ENRPBridge.server.lua`](../roblox/ENRPBridge.server.lua) hineinkopieren.
4. Oben eintragen: `BRIDGE_URL` (eure Domain) und `BRIDGE_SECRET`.
5. Optional anpassen: Staff (Gruppe/Ränge oder Nutzer), `VEHICLE_TAG`, Gefängnis-Teil `ENRPJail`, Notruf-Befehle,
   Orte (`ENRPOrt`-Tag), `TEAM_RIGHTS` für Privatserver.
6. Veröffentlichen. Nach ein paar Sekunden zeigt `/spiel status` „🟢 Spiel verbunden“.

**Fahrzeuge:** Euer Fahrzeug-Spawner gibt dem Modell den CollectionService-Tag `ENRPFahrzeug` und die Attribute
`Besitzer` (UserId), optional `Kennzeichen`, `Farbe` und `Modell`. Fehlt das Kennzeichen, vergibt das Skript eins
(`EN-A1234`).
**Notrufe im Spiel:** `/notruf …`, `/110 …`, `/112 …`, `/feuerwehr …` im Chat, oder aus eurem Handy-UI per
`ServerStorage.ENRP.Notruf:Fire(player, "Polizei", text)`. **Mod-Call:** `/modcall …`.

### 2.5 Discord einrichten (je Discord)

```
/spiel-admin dispatch kanal:#dispatch rolle:@Leitstelle
/spiel-admin bolokanal kanal:#bolo
/spiel-admin logkanal art:Beitritte & Verlassen kanal:#join-logs      (und kills, befehle, mod-calls, notrufe, …)
/spiel-admin livepanel kanal:#server-status
/spiel-admin berechtigung stufe:Dispatch rolle:@Polizei
/spiel-admin berechtigung stufe:Moderation rolle:@Moderator
```

---

## 3. Endpunkt-Matrix

### 3.1 Bridge (Spiel ↔ Bot, eigene API)

| Methode & Pfad | Richtung | Inhalt | Antwort | Auth |
|---|---|---|---|---|
| `GET /health` | Monitor → Bot | – | `{ ok, service: "enrp-bridge" }` | keine (verrät nichts) |
| `POST /bridge/v1/live` | Spiel → Bot | Snapshot (siehe 4.1) | `{ ok }` / 400 ungültig | HMAC |
| `POST /bridge/v1/events` | Spiel → Bot | `{ events: [≤100 Ereignisse] }` (siehe 4.2) | `{ accepted, duplicates, rejected }` | HMAC |
| `GET /bridge/v1/sync?job&owner&cursor&boot` | Spiel ← Bot | – | `{ boot, cursor, commands[], bansVersion, config{live,sync}, time }` | HMAC |
| `GET /bridge/v1/bans?owner` | Spiel ← Bot | – | `{ version, bans: { userId: { r, e, s } } }` | HMAC |
| `GET /bridge/v1/player?id&owner` | Spiel ← Bot | – | `{ ban: {r,e,s}\|null, rights: [] }` | HMAC |
| `POST /bridge/v1/bye` | Spiel → Bot | `{ job }` | `{ ok }` | HMAC |

**Signatur:** Header `X-ENRP-Timestamp` (Unix-Sekunden), `X-ENRP-Nonce` (16–64 Zeichen, einmalig),
`X-ENRP-Signature` = hex(HMAC-SHA256(Bridge-Schlüssel, `Timestamp\nNonce\nMETHODE\nPfad+Query\nRoh-Body`)).
Der Bot lehnt ab, wenn die Signatur falsch ist, der Zeitstempel mehr als ±5 Minuten abweicht oder die Nonce schon
benutzt wurde (Replay). Antwort dann immer nur `401 nicht autorisiert`, den Grund gibt es nur im API-Log.

**Grenzen:** Body ≤ 256 KB, 1200 Anfragen/Minute je IP, 30 Fehlsignaturen/Minute → IP 10 Minuten gesperrt,
Zeitlimit 15 s pro Anfrage.

### 3.2 Roblox (optional)

| Endpunkt | Wofür | Rechte des API-Keys |
|---|---|---|
| `PATCH /cloud/v2/universes/{u}/user-restrictions/{id}` | Bann/Unbann im ganzen Spiel spiegeln | `universe.user-restriction:write` |
| `GET /cloud/v2/universes/{u}/user-restrictions/{id}` | Bann-Status (`/ingame bann-pruefen`, Test) | `universe.user-restriction:read` |
| `GET https://games.roblox.com/v1/games?universeIds=` | Spieler gesamt, Besuche, Favoriten | keine (öffentlich) |
| `POST https://users.roblox.com/v1/usernames/users` | Roblox-Namen → ID | keine (öffentlich) |
| `GET https://users.roblox.com/v1/users/{id}` | Profilbeschreibung für `/verifizieren` | keine (öffentlich) |

Der Client wiederholt bei 429/5xx/Netzwerkfehlern bis zu 3-mal (1 s, 2 s, 4 s oder `Retry-After`). Er bricht nach 10 s
ab und schreibt jede Aktion und jeden Fehler ohne Schlüssel ins API-Log (`/spiel-admin api-logs`).

### 3.3 Nicht verfügbar (bewusst oder technisch)

| Funktion | Grund |
|---|---|
| Warteschlange („Queue“) | Roblox hat keine Server-Warteschlange; Anzeige „— (gibt es bei Roblox nicht)“ |
| ER:LC-spezifische Daten (ER:LC-Callsigns, ER:LC-Fahrzeuge …) | eigenes Spiel statt ER:LC; Callsign kommt aus Attribut `ENRP_Callsign` |
| Spielerposition dauerhaft | wird nicht übertragen (Datenschutz/Datenmenge); nur bei Notrufen der Ort |
| Fahrzeughistorie vor Einführung des Skripts | Verlauf beginnt mit den ersten Fahrzeug-Ereignissen |
| Jail über Server-Wechsel hinweg | Gefängnis gilt auf dem Server, auf dem es verhängt wurde |
| Webhook-Push an das Spiel | Roblox-Server sind nicht von außen erreichbar → das Spiel fragt alle 3 s nach |

---

## 4. Datenformate (Bridge-Protokoll v1)

### 4.1 Live-Snapshot

```json
{ "v": 1, "job": "JobId", "owner": 0, "ps": false, "max": 30, "started": 1700000000, "at": 1700000123, "ver": 42,
  "teams": ["Polizei", "Zivilisten"],
  "players": [{ "id": 77, "n": "Name", "d": "Anzeigename", "t": "Polizei", "s": "Admin", "w": 0, "j": 0, "c": "12/1", "since": 1700000050 }],
  "vehicles": [{ "m": "Streifenwagen", "o": 77, "on": "Name", "p": "EN-A1234", "c": "Blau", "h": "#1e3a8a" }] }
```

### 4.2 Ereignisse

Gemeinsam: `v`, `id` (GUID), `type`, `at`, `job`, `owner`, `u` (UserId), `n` (Name).

| `type` | Zusatzfelder | Wirkung im Bot |
|---|---|---|
| `join` / `leave` | `s` (Staff-Rang), `dur` (Sekunden, nur leave) | Join-Log, BOLO-Personen-Treffer, Staff-Spielzeit |
| `kill` | `vu`, `vn`, `ku`, `kn`, `w` | Kill-Log |
| `command` | `text`, `src` | Befehls-Log (aus eurem Admin-System über `ServerStorage.ENRP.Log`) |
| `modcall` | `text` | Mod-Call mit „Übernehmen“-Button, Spieler bekommt Rückmeldung |
| `call` | `num`, `team`, `text`, `loc`, `x`, `z` | **Einsatz im CAD** + Dispatch-Nachricht + Notruf-Log |
| `vehicle` | `act` (spawn/despawn), `m`, `p`, `c` | Fahrzeug-Log, BOLO-Fahrzeug-Treffer |
| `team` | `from`, `to` | Teamwechsel-Log |
| `ack` | `cmd`, `ok`, `msg` | Ergebnis eines Discord-Befehls |

Prüfung: Version, Typ, ID-Format, Zeitstempel (nicht mehr als 5 Min. in der Zukunft; älter als 6 Std. → nur Historie,
keine Benachrichtigung), alle Texte gekürzt. Doppelte IDs werden erkannt, auch nach einem Neustart (letzte 5000).

### 4.3 Befehle an das Spiel

`announce {text}` · `pm {userId,text}` · `kick {userId,reason}` · `jail {userId,minutes,reason}` · `unjail {userId}` ·
`heal` · `kill` · `respawn` · `wanted {userId,stars,reason}` · `team {userId,team}` · `shutdown {reason}` ·
`rights {userId,rights[]}` · `refresh` – jeweils mit `cmd` (ID für die Bestätigung). Ziel: `all`, `owner:<id>` oder
`job:<JobId>`. Spieler-Befehle gehen direkt an den Server, auf dem der Spieler gerade ist.

---

## 5. Discord-Befehle

### `/spiel` – Live-Daten (Stufe Einsicht)
`status` · `server [server]` · `spieler [server] [team]` · `spieler-info <spieler>` · `fahrzeuge [spieler]` ·
`kennzeichen <kennzeichen>` · `staff [tage]` · `logs [typ] [spieler] [suche] [anzahl]` · `notrufe [team] [alle]` ·
`rechte [spieler]` · `rechte-abgleichen` – mit Vorschlägen beim Tippen (Spieler, Server, Teams).

### `/ingame` – Aktionen im Spiel
| Befehl | Stufe | Rückfrage |
|---|---|---|
| `pm`, `jail`, `unjail`, `heal`, `respawn`, `wanted`, `team` | Moderation | – |
| `kick`, `kill` | Moderation | ✅ |
| `ansage` | Admin | – |
| `ban`, `neustart` | Admin | ✅ |
| `unban` | Admin | – |
| `bann-pruefen`, `banns`, `verlauf` | Moderation | – |
| `befehl text:":jail Name 10 Grund"` | Admin | wie der jeweilige Befehl |

Jede Aktion: Berechtigung → Rate-Limit (6/Min. je Person, 25/Min. je Discord) → Eingaben prüfen (Spieler online, Team
existiert, Zahlen im Bereich) → ggf. Rückfrage (60 s, nur der Auslöser) → an das Spiel → Bestätigung abwarten (12 s) →
Ergebnis + Verlauf + Audit-Log (Mod-Log, Kanal „Discord-Aktionen“, bei Privatservern zusätzlich Haupt-Discord).

### `/cad` – CAD & Dispatch
`neu` · `liste` · `info` · `zuweisen` · `status` · `notiz` · `abschliessen [bericht]` · `suche` · `statistik [tage]` ·
`einheit <status> [rufname]` · `einheiten`. Einsätze im Dispatch-Kanal haben Buttons **Übernehmen**, **Abschließen**
(mit Bericht) und ein Status-Menü. Ingame-Notrufe tragen „🎮 Ingame-Notruf #n“, eigene Einsätze „📝 EN | POLIZEI-Einsatz
(eigene Daten)“. Übernimmt jemand einen Ingame-Notruf, bekommt der Anrufer im Spiel „Einheit X ist unterwegs“.
Einheiten-Status: 2 Einsatzbereit · 3 Anfahrt · 4 Am Einsatzort · 5 Beschäftigt · 6 Außer Dienst. Bei verifizierten
Einheiten zeigt das CAD, ob sie gerade im Spiel sind.

### `/bolo` – Fahndungen
`person` · `fahrzeug` · `liste` · `info` · `bearbeiten` · `aufheben` · `suche` · `archiv`. Optional befristet. Gekennzeichnet
als „EN | POLIZEI – eigene BOLO-Daten (nicht aus dem Spiel)“. **Treffer-Alarm**: Taucht ein gesuchter Spieler oder ein
gesuchtes Kennzeichen im Spiel auf, kommt eine Meldung mit Server in den BOLO-Kanal (je BOLO höchstens alle 30 Min.).

### `/spiel-admin` – Admin-Center (nur „Server verwalten“)
`uebersicht` · `test` · `bridge-schluessel`* · `api-key`* · `universe`* · `api-logs`* · `intervall`* · `logkanal` ·
`livepanel` · `dispatch` · `bolokanal` · `berechtigung` · `privatserver verknuepfen|entfernen|liste`* (* nur Haupt-Discord)

---

## 6. Berechtigungen

| Stufe | Darf | Standard ohne eingestellte Rollen |
|---|---|---|
| Einsicht | Live-Daten, Logs, CAD/BOLO ansehen | jeder |
| Dispatch | CAD, Einsätze übernehmen, BOLO | nur Staff |
| Moderation | PM, Kick, Jail, Unjail, Heal, Kill, Respawn, Wanted, Team, Mod-Calls übernehmen, Banns ansehen | nur Staff |
| Admin | Bann/Unbann, Ansage, Neustart, freie Befehle, Admin-Center | Staff-Rolle oder „Server verwalten“ |

Jede Stufe schließt die darunterliegenden ein. **Bereiche:** Der Haupt-Discord sieht und steuert alle Server.
Ein Privatserver-Discord sieht und steuert nur die Privatserver seines Besitzers. Andere Discords bekommen nur
`/spiel status`.

---

## 7. Sicherheit

- **Signierte Anfragen** (HMAC-SHA256), **Zeitstempel ±5 Min.**, **Einmal-Nonce** gegen Replay, zeitkonstanter Vergleich
- **Schlüssel** nie in Discord-Nachrichten (außer einmalig beim Erzeugen, privat), nie in Logs, nie im Klartext in der
  Datenbank (AES-256-GCM mit `ENRP_SECRET`). Angezeigt wird nur ein Fingerabdruck.
- **Keine Geheimnisse beim Spieler**: Der Bridge-Schlüssel steht nur im Server-Skript.
- **Eingaben geprüft**: alles aus dem Spiel (Typen, Längen, IDs), alles aus Discord (Namen, Dauer, Zahlenbereiche, Teams)
- **Rechte** je Befehl, **Bereiche** je Discord, **Rückfragen** bei kritischen Aktionen, **Rate-Limits** gegen Spam
  (Discord-Befehle, Notrufe/Mod-Calls im Spiel, Webserver je IP), **Audit-Log** für jede Aktion
- **Roblox-Textfilter** für jeden Text aus Discord, den Spieler sehen
- API-Log speichert IPs nur gehasht

---

## 8. Datenbank & Migrationen

`data/db.json` bekommt eine Versionsnummer (`schemaVersion`). Beim Start laufen fehlende Migrationen einmal
(`src/lib/db.js`). **Migration 2** legt diese Bereiche an:

| Bereich | Inhalt | Begrenzung |
|---|---|---|
| `gameBans` | Banns (global / je Privatserver-Besitzer) | abgelaufene werden entfernt |
| `gameRights` | Spielrechte je Privatserver und Spieler | – |
| `gameEvents` | Ereignis-Historie (für `/spiel logs`, Staff-Aktivität, Spieler-Info) | letzte 3000 |
| `gameEventSeen` | IDs verarbeiteter Ereignisse (Deduplizierung) | letzte 5000 |
| `gameCommands` | Befehls-Historie je Discord | letzte 500 |
| `gameModcalls` | Mod-Calls je Discord | 7 Tage |
| `cad`, `bolos` | Einsätze, Einheiten, BOLOs je Discord | – |
| `apiLogs` | Roblox-Aktionen und Fehler | letzte 300 |
| `secrets`, `gameConfig` | verschlüsselte Schlüssel, Universe-ID, Intervalle | – |

Einstellungen je Discord (Kanäle, Rollen, Berechtigungen, Live-Panel) liegen wie bisher in `settings`
(Vorlage `config.json` → `game`).

---

## 9. Funktionsvergleich mit Melonly

Grundlage sind die öffentlichen Seiten von Melonly (Stand der Recherche: Toolbox mit Mitglieder-Checks, Remote-Befehlen
und Live-Logs, Weiterleitung von Ereignissen in Kanäle, Kick/Bann-Erkennung zum „Claimen“, Auto-Schichten, Workflows,
Abteilungen). Melonly arbeitet mit **ER:LC**, EN | POLIZEI mit **eurem eigenen Spiel**.

| Bereich | Melonly (ER:LC) | EN | POLIZEI (eigenes Spiel) |
|---|---|---|---|
| Serverstatus | ER:LC-Server | ✅ `/spiel status`, Live-Panel, alle Server + Privatserver |
| Live-Spieler | ✅ | ✅ inkl. Team, Staff, Wanted, Gefängnis, Callsign |
| Live-Fahrzeuge | ER:LC-Fahrzeuge | ✅ über `ENRPFahrzeug`-Tag, Kennzeichensuche |
| Staff | ✅ | ✅ online, Spielzeit, Mod-Calls, Befehle |
| Ingame-Logs | ✅ Join/Leave, Kills, Befehle | ✅ je Log-Art eigener Kanal |
| Ingame-Befehle | ✅ Remote-Befehle | ✅ mit Bestätigung aus dem Spiel, Rückfrage, Historie |
| Notrufe | ER:LC-Notrufe | ✅ eigene Notrufe (`/notruf`, `/110`, `/112`, Handy-UI) |
| Webhooks | ER:LC-Event-Webhooks | ✅ signierte Webhooks vom Spiel an den Bot |
| CAD / Dispatch | – (Abteilungen/Ressourcen) | ✅ Einsätze, Einheiten, Status, Berichte, Statistik |
| BOLO | – | ✅ mit automatischem Treffer-Alarm |
| Kick/Bann-Erkennung | ✅ „Claim“ | ✅ Banns im Bot, optional Roblox-Ban-API |
| Schichten (Shifts) | ✅ Auto-Schichten | 🟡 Staff-Spielzeit aus Join/Leave; echtes Schichtsystem fehlt noch |
| Workflows/Automationen | ✅ | ❌ nicht umgesetzt |
| Web-Mod-Panel | ✅ | ❌ alles in Discord |

---

## 10. Testbericht

| Test | Ergebnis |
|---|---|
| `npm run check`: Konfiguration, alle 27 Befehle bauen, Ticket-Panel, Öffnungszeiten, Einstellungen | ✅ |
| Signatur: gültig, Replay, veränderter Body/Pfad, alter Zeitstempel, fehlende Header | ✅ |
| Echter Webserver (HTTP): Health, falscher Schlüssel → 401, Live-Snapshot, Ereignisse (angenommen/abgelehnt/doppelt), Sync (erster Abruf ohne Altlasten), Befehl an genau den richtigen Server, Bestätigung → Ergebnis, Bannliste je Server, Bann-/Rechte-Abfrage beim Join | ✅ |
| Bereiche: Haupt- vs. Privatserver-Discord (Server, Spieler, Befehle) | ✅ |
| Banns inkl. Spiegelung an die Roblox-Ban-API (gestellt), Unbann | ✅ |
| Spielrechte: Rolle → Recht → live ans Spiel → Rolle weg → Recht weg; Haupt-Discord vergibt keine | ✅ |
| Verschlüsselung: kein Klartext, falscher `ENRP_SECRET` entschlüsselt nichts | ✅ |
| Berechtigungsstufen, CAD-Ablauf, CAD-Suche, BOLO-Ablauf/-Suche/Kennzeichen-Normalisierung | ✅ |
| Spiel-Skript passt zum Bot (Routen, Befehle, Ereignis-Typen, Signatur-Kanon, Protokollversion) | ✅ |
| **Lua-SHA-256/HMAC gegen die Bot-Signatur** (`scripts/test-lua-crypto.py`, Lua 5.2 mit bit32): 18 Fälle inkl. Umlauten und Blockgrenzen + echte Bridge-Signatur | ✅ |
| Mutationstests: Replay-Schutz, Zeitstempel, Befehls-Ziel, Bereichsfilter, Lua-Konstante absichtlich kaputt → jeweils erkannt | ✅ |
| Smoke-Test aller Discord-Befehle/Buttons/Formulare mit gestellten Interaktionen (72 Abläufe) | ✅ |
| Lua-Syntax des Spiel-Skripts | ✅ |

**Nicht getestet** (braucht echte Umgebung): Roblox Studio/Live-Server (Roblox-APIs wie Teams, TextChatService,
HttpService), echter Discord, echte Domain-Weiterleitung an den Bot, echte Roblox-Ban-API mit gültigem Key.

## 11. Fehlerbericht (beim Testen gefunden und behoben)

1. Formular-Beschriftung beim API-Key war länger als Discords Grenze von 45 Zeichen → Formular wäre abgestürzt.
2. `npm run check` konnte auf dem Bot-Hoster in die echte `data/db.json` schreiben → nutzt jetzt eine eigene Testdatenbank.
3. Das Krypto-Testskript legte über die neue Datenbank-Migration eine echte `data/db.json` an → eigene Wegwerf-Datenbank.
4. Spielertexte (Notruf, Mod-Call) konnten Discord-Formatierung und getarnte Links enthalten → werden jetzt entschärft.
5. Mod-Log-Einträge nach Spiel-Aktionen brachen ab (falsche Argumente) – behoben in der Vorversion, Test ergänzt.

## 12. Offene Einschränkungen

- **Domain/Port:** Auf eurer Domain läuft derzeit ein anderes Programm (Dashboard mit Login). Der Bot braucht den Port
  selbst oder eine Weiterleitung von `/bridge/*` (siehe 2.2).
- Befehle kommen mit bis zu 3 s Verzögerung an (einstellbar: `/spiel-admin intervall`, 2–30 s).
- Ereignisse, die angenommen, aber vor der Verarbeitung durch einen Bot-Absturz verloren gehen, werden nicht erneut
  geschickt (sehr kurzes Zeitfenster).
- Ohne Roblox-API-Key gibt es keine Zweitaccount-Erkennung bei Banns.
- Jail/Wanted gelten je Server (kein Übertrag beim Serverwechsel).
