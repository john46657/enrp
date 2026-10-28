# Roblox-Integration (Luau)

Serverseitige Skripte, die einen Roblox-Spielserver mit der ENRP-API verbinden.

> **Status:** Die Skripte sind gegen die dokumentierte HttpService-/Players-API geschrieben, wurden in dieser
> Umgebung aber **nicht** in Roblox Studio ausgeführt (kein Studio/Luau-Analyzer verfügbar). Vor dem Livebetrieb
> bitte in einem privaten Testserver prüfen (siehe Checkliste unten). Die Gegenseite (API) ist vollständig getestet.

## Was die Skripte tun

| Funktion | Ablauf |
|---|---|
| Heartbeat (alle 30 s) | Meldet JobId, Place, Servertyp (`PrivateServerId`/`PrivateServerOwnerId` → öffentlich, privat, reserviert), Spielerliste. Antwort: Kill-Switch, Wartung, neue Ankündigungen, ausstehende Sanktionen und Server-Befehle. |
| Server-Befehle | Aus dem Dashboard: Nachricht an alle Spieler eines Servers, Nachricht an einen Spieler, Server herunterfahren (Ankündigung, nach 10 s Kick aller Spieler). Abholen alle 5 s (`/game/commands/poll`), Bestätigen über `/game/commands/:id/ack`. Optionaler Weckruf über Open Cloud Messaging (Thema `ENRP_Commands`, `MessagingService:SubscribeAsync`) – siehe `ROBLOX_UNIVERSE_ID`/`ROBLOX_OPEN_CLOUD_KEY` in `.env.example`. |
| Spielereignisse | `player_joined`, `player_left`, `duty_start`, `duty_end`, `redemption_delivered` werden gepuffert und gebündelt gesendet. Jedes Ereignis hat eine GUID → das Backend verarbeitet es genau einmal. |
| Zugangsprüfung | Beim Betreten: aktiver Roblox-Bann → Kick mit Grund. Fraktion und erlaubte Fahrzeuge kommen vom Backend (Attribute `ENRP_Faction`, `ENRP_Vehicles`). |
| Dienstsystem | Client fragt per `ReplicatedStorage.ENRP.DutyToggle` an. Server prüft Fraktion + Abstand, Backend entscheidet endgültig mit eigener Serverzeit. |
| Codes | `ReplicatedStorage.ENRP.RedeemCode` → Backend prüft Gültigkeit/Limits idempotent → Belohnung über registrierten Handler (`Rewards.register`). |
| Sanktionen | Banns/Entbannungen über `Players:BanAsync` / `Players:UnbanAsync`, Kicks direkt; Ergebnis wird bestätigt (`/game/sanctions/:id/ack`). |
| Ankündigungen/Wartung | RemoteEvents `Announcement`, `Maintenance` → einfache Banner im Client. |

## Sicherheit

- Der API-Schlüssel liegt **nur** im Roblox **Secrets Store** und wird über `HttpService:GetSecret()` als
  undurchsichtiges `Secret`-Objekt in den `Authorization`-Header gesetzt. Er steht in keinem Skript und erreicht
  nie den Client.
- Jede Anfrage enthält `X-Roblox-Timestamp` (±5 Minuten) und eine einmalige `X-Roblox-Nonce` → Replays werden
  vom Backend abgewiesen und als Sicherheitsereignis protokolliert.
- Der Schlüssel kann im Dashboard auf bestimmte Place-IDs beschränkt und jederzeit widerrufen werden.
- Clients können nur *anfragen* (Dienst, Code). Alle Entscheidungen treffen Spielserver und Backend.
- Hinweis: Ohne lesbares Geheimnis kann Luau keine HMAC-Signatur berechnen. Die Integrität der Anfragen beruht
  daher auf HTTPS + geheimem Schlüssel; Zeitstempel/Nonce verhindern Wiederholungen. Eigene Krypto wird bewusst
  nicht implementiert.

## Einrichtung

1. **Dashboard → Technik & Betrieb → Roblox-Server → Schlüssel erzeugen.** Optional die Place-ID eintragen.
   Schlüssel kopieren (er wird nur einmal angezeigt).
2. **Creator Hub → dein Spiel → Secrets → Secret anlegen**: Name `ENRP_API_KEY`, Wert = Schlüssel,
   Domain = Domain deiner API (z. B. `dashboard.example.de`).
   Für Tests in Studio: *Game Settings → Security → Secrets* (lokale Secrets).
3. **Game Settings → Security → „Allow HTTP Requests“** aktivieren.
4. Skripte einfügen – per [Rojo](https://rojo.space) (`rojo serve` mit `default.project.json`) oder manuell:
   - `src/ServerScriptService/ENRP/` → Ordner `ENRP` in **ServerScriptService** (`Main.server.lua` als Script,
     die übrigen Dateien als ModuleScripts mit gleichem Namen ohne `.lua`).
   - `src/StarterPlayer/StarterPlayerScripts/ENRPClient.client.lua` → LocalScript in StarterPlayerScripts.
5. In `Config.lua` `ApiBaseUrl` auf die öffentliche HTTPS-Adresse setzen.
6. Belohnungstypen registrieren, z. B. in einem eigenen Server-Skript:

   ```lua
   local Rewards = require(game.ServerScriptService.ENRP.Rewards)
   Rewards.register("cash", function(player, payload)
       -- Eigene Währungslogik des Spiels; true zurückgeben, wenn vergeben.
       return MyEconomy.add(player, payload.amount)
   end)
   ```

7. Dienst-Button im eigenen UI: `ReplicatedStorage.ENRP.DutyToggle:InvokeServer()` liefert `(ok, meldung)`.

Schritt-für-Schritt-Anleitung für einen Test vom eigenen PC aus (Docker + Cloudflare-Tunnel + Studio):
[docs/roblox-test.md](../docs/roblox-test.md). In Studio ist `game.JobId` leer – die Skripte verwenden dann eine
eigene Kennung `studio-…`; Testspieler mit negativer ID (lokaler Mehrspieler-Test) werden nicht gemeldet.

## Testcheckliste (privater Server)

- [ ] Dashboard zeigt den Server unter *Roblox-Server* als online, Spielerzahl stimmt.
- [ ] Betreten/Verlassen erzeugt `player_joined`/`player_left` (Dashboard → Letzte Spielereignisse).
- [ ] Mitglied einer Fraktion kann Dienst beginnen/beenden; Nicht-Mitglied erhält eine Ablehnung.
- [ ] Roblox-Bann im Dashboard → Spieler wird gekickt, Aktion wechselt auf „Aktiv“.
- [ ] Code einlösen: zweite Einlösung wird mit „bereits eingelöst“ abgelehnt.
- [ ] Kill-Switch aktivieren → Dienst/Codes gesperrt; Wartungsmodus → Banner erscheint.
- [ ] Privater Server (VIP) erscheint im Dashboard als „Privat“ mit Besitzer, reservierter Server als „Reserviert“.
- [ ] Dashboard → Server → „Nachricht senden“ → Banner erscheint innerhalb weniger Sekunden, Befehl steht auf „Ausgeführt“.
- [ ] „Herunterfahren“ → Ankündigung, nach 10 s werden alle Spieler gekickt, Server meldet sich ab.

## Grenzen der Roblox-Umgebung

- Roblox-Server können keine eingehenden Verbindungen annehmen; Steuerdaten kommen daher über den Heartbeat
  (alle 30 s, begrenztes HTTP-Budget pro Minute).
- `BindToClose` hat höchstens 30 Sekunden; nicht gesendete Ereignisse gehen verloren, das Backend schließt offene
  Spiel- und Dienstsessions dann über den Server-Timeout-Watchdog (Ende = letzter Heartbeat).
