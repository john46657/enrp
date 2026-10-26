# Roblox-Spielintegration

> ⚠️ **Status:** Die Luau-Skripte sind geschrieben und gegen die offizielle API-Referenz geprüft, wurden aber
> **weder in Roblox Studio ausgeführt noch mit `luau-analyze` statisch geprüft**. Vor dem Livebetrieb in einer
> Test-Experience durchspielen (Checkliste unten).

## Dateien (`roblox/`)

| Datei | Ziel in Roblox | Zweck |
|---|---|---|
| `server/Main.server.luau` | `ServerScriptService.EmdenNetworkMain` (Script) | Heartbeat, Join/Leave, Schleifen, `BindToClose` |
| `server/EmdenNetwork/Config.luau` | `ServerScriptService.EmdenNetwork.Config` | API-URL, Intervalle, Wartungs-Ausnahmen, **keine Geheimnisse** |
| `server/EmdenNetwork/Api.luau` | ModuleScript | `HttpService:RequestAsync` mit Secret, Backoff |
| `server/EmdenNetwork/EventQueue.luau` | ModuleScript | Ereignisse mit GUID, gepuffert, begrenzte Warteschlange |
| `server/EmdenNetwork/Actions.luau` | ModuleScript | Allowlist-Ausführung: announce, restart_announce, kick, ban, unban |
| `server/EmdenNetwork/Duty.luau` | ModuleScript | Dienst-Anfragen (RemoteFunction), Fraktion aus dem Backend |
| `server/EmdenNetwork/Announcements.luau` | ModuleScript | Textfilter + RemoteEvent an Clients |
| `client/Announcements.client.luau` | `StarterPlayerScripts` (LocalScript) | Zeigt gefilterte Ankündigungen an, sendet nichts |

Mit [Rojo](https://rojo.space) über `roblox/default.project.json` synchronisieren oder die Dateien manuell anlegen.
Alles Sicherheitsrelevante liegt in `ServerScriptService` und wird nicht repliziert.

## Einrichtung

1. **HTTP aktivieren:** Experience-Einstellungen → Sicherheit → *Allow HTTP Requests*.
2. **Schlüssel erzeugen:** `openssl rand -hex 32` → in der API-`.env` als `GAME_API_KEY`.
3. **Secret anlegen:** Creator Hub → deine Experience → *Secrets* → Name `EmdenNetworkGameApiKey`, Wert = derselbe
   Schlüssel, Domain auf deine API-Domain beschränken (z. B. `api.deine-domain.de`). Für Tests in Studio den
   Schlüssel zusätzlich als lokales Secret in den Game-Settings hinterlegen.
4. **Place-ID freigeben:** `ALLOWED_PLACE_IDS=<deine Place-ID>` in der API-`.env`.
5. **Config anpassen:** `ApiBaseUrl` in `Config.luau` auf `https://api.deine-domain.de`.

Das Secret wird mit `HttpService:GetSecret()` gelesen und nur als Header-Wert (`Secret:AddPrefix("Bearer ")`)
verwendet. Es taucht nie in LocalScripts, ReplicatedStorage oder Logs auf.

## Sicherheitsregeln (umgesetzt)

- **Kein freier Code:** Es gibt nur die fünf Auftragstypen. Unbekannte Typen werden mit `unknown_type` gemeldet,
  aber nicht ausgeführt. Das Backend lässt andere Typen gar nicht erst zu (CHECK-Constraint + Zod).
- **Payload-Prüfung im Spiel:** Roblox-IDs, Textlängen und Dauern werden vor der Ausführung erneut geprüft.
- **Ablaufzeit:** Abgelaufene Aufträge (`expiresAt`) werden nicht ausgeführt.
- **Idempotenz:** Bereits ausgeführte Auftrags-IDs werden im Server gemerkt. Schlägt die Ergebnismeldung fehl,
  wird nur erneut gemeldet und nicht erneut ausgeführt. Ereignisse tragen eine GUID, Wiederholungen erkennt das
  Backend als Duplikat.
- **Keine Clientdaten übernehmen:** Der Client kann über `EmdenNetworkDutyRequest` nur `"start"`/`"stop"`
  anfragen (Rate-Limit 1/3 s). Die Fraktion ermittelt der Server per Profil-API. Das Announcement-RemoteEvent
  ignoriert alle Client-Nachrichten.
- **Spielberechtigung nie aus Discord-Nachrichten:** Fraktion/Rang stammen aus der Datenbank (Fraktionsverwaltung
  mit Berechtigungsprüfung), nicht aus Chat oder Discord-Text.
- **API-Ausfall:** Anfragen werden mit Backoff wiederholt. Ereignisse bleiben in der Warteschlange (max. 500, die
  ältesten werden verworfen). Ohne API läuft das Spiel normal weiter, nur ohne Synchronisierung.
- **Textfilter:** Ankündigungen laufen vor der Anzeige über `TextService:FilterStringAsync` und
  `GetNonChatStringForBroadcastAsync`. Schlägt der Filter fehl, wird nichts angezeigt.
- **Bans:** `Players:BanAsync` mit `ApplyToUniverse = true`. Laut Roblox-Referenz bedeutet `Duration = -1`
  dauerhaft. Bitte in Studio/Test-Experience prüfen.

## Anbindung eigener Spielsysteme

- Dienst-UI: `ReplicatedStorage.EmdenNetworkDutyRequest:InvokeServer("start")` → `(erfolg, nachricht)`.
- Fraktionswerkzeuge: Der Server setzt nach dem Profilabruf die Attribute `EmdenFaction`, `EmdenRank` und
  `EmdenOnDuty` am Player. **Werkzeuge serverseitig** anhand dieser Attribute vergeben, nicht im Client.

## Test-Checkliste vor dem Livebetrieb

- [ ] Heartbeat erscheint unter `/server status` (≤ 30 s)
- [ ] Beitritt/Verlassen erzeugen Spielzeit (`/playtime`)
- [ ] Dienst im Spiel starten/beenden → `/duty status` und `/duty roster`
- [ ] `/server announce` wird angezeigt (Textfilter aktiv)
- [ ] `/gamekick` mit Testaccount, `/gameban` mit kurzer Dauer + Prüfung der Ban-Meldung, danach Unban
- [ ] `/server maintenance an` → neuer Beitritt wird abgewiesen, Bypass-ID kann beitreten
- [ ] API stoppen → Spiel läuft weiter, nach Neustart werden gepufferte Ereignisse nachgeliefert
- [ ] Server herunterfahren → offene Spiel-Dienste werden beendet
