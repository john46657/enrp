# roblox – serverseitige Luau-Skripte

> **Geplant für Phase 3.** Hier gibt es noch keine Skripte.

Vorgesehen sind Beispielskripte für `ServerScriptService` (niemals als LocalScript), die über `HttpService`
per HTTPS Registrierung und Heartbeats an das Emden Network Backend senden:

- `game.JobId` = Serverinstanz, `game.PlaceId` = Place
- `game.PrivateServerId` / `game.PrivateServerOwnerId` = private bzw. reservierte Server –
  eine private Serveridentität kann zu mehreren Instanzen gehören und ist **keine** Instanz-ID
- Voraussetzung: In den Einstellungen der Erfahrung muss „HTTP-Anfragen erlauben“ aktiviert sein
- Absicherung: geheimer Schlüssel nur serverseitig, signierte Anfragen mit Zeitstempel und Replay-Schutz

Nicht möglich und wird nicht vorgetäuscht: beliebige Server von außen neu starten oder alle laufenden
Instanzen vollständig auflisten.
