# Leitstelle (Notrufe, Einsätze, Mod-Calls, Live-Lage)

Alles läuft über die eigene Plattform – es wird **keine** fremde Spiel-API (z. B. ER:LC) benutzt.
Das Roblox-Spiel meldet sich wie gewohnt per Heartbeat und Ereignissen bei der API.

## Ablauf eines Notrufs

1. Spieler schreibt im Chat `/notruf Überfall an der Tankstelle` (oder `/110`, `/112`, `/feuerwehr`).
2. `Dispatch.lua` schickt sofort ein Ereignis `emergency_call` (mit Position und nächstem Ort).
3. Die API legt genau einen Einsatz an (Quelle „🎮 Ingame-Notruf“) und meldet ihn
   - live im Dashboard unter **Leitstelle → Einsätze**,
   - im eingestellten Discord-Kanal mit Ping der Leitstellen-Rolle und Buttons
     *Übernehmen*, *Anfahrt*, *Vor Ort*, *Abschließen*.
4. Wer übernimmt, wird als Einheit zugewiesen. Beim **ersten** Zuweisen bekommt der Anrufer im Spiel
   „🚓 Dein Notruf wurde angenommen …“ (abschaltbar über `notifyCaller`).
5. Abschließen mit Einsatzbericht gibt alle Einheiten wieder frei.

Einsätze, die die Leitstelle selbst anlegt (Dashboard oder `/cad create`), sind als „📝 Einsatz der Leitstelle“
gekennzeichnet. Jeder Schritt steht im Verlauf des Einsatzes und im Audit-Log.

Status: `open` (offen) → `assigned` → `en_route` (Anfahrt) → `on_scene` (vor Ort) → `closed`.
Einheiten: `available`, `en_route`, `on_scene`, `busy`, `off_duty` – eigener Status und Rufname über
„Mein Status“ bzw. `/cad unit`.

## Mod-Calls

`/modcall <Text>` im Spiel → Eintrag unter **Leitstelle → Mod-Calls** (und im Mod-Call-Kanal, falls gesetzt).
*Übernehmen* zeigt dem Spieler im Spiel, wer sich kümmert; *Schließen* mit optionaler Notiz.

## Live-Lage

Aus dem letzten Heartbeat jedes laufenden Servers (alle 30 s): Spieler mit Team, Fahndungsstufe,
Gefängnis und Rufname sowie alle Fahrzeuge mit Kennzeichen. Suche nach Namen, Team oder Kennzeichen –
im Dashboard und mit `/live players|vehicles|plate`.

## Fahndungen (BOLO)

Fahndung nach **Kennzeichen** oder **Spieler (Roblox-ID)** – im Dashboard unter **Leitstelle → Fahndungen** oder mit
`/bolo vehicle|person`. Jeder Heartbeat (alle 30 s) wird gegen alle aktiven Fahndungen geprüft; Kennzeichen werden
ohne Leer- und Trennzeichen verglichen (`EN-AB 12` = `enab12`). Ein Treffer
- erscheint live im Dashboard (Trefferzahl, „Zuletzt gesichtet“ mit Fahrzeug/Besitzer bzw. Team),
- steht im Verlauf der Fahndung,
- kommt in den Leitstellen-Kanal mit Ping der Leitstellen-Rolle und Button „Fahndung aufheben“.

Pro Fahndung höchstens ein Alarm alle 10 Minuten. Ist der Gesuchte beim Anlegen schon online, gibt es sofort einen
Treffer. Aufheben mit `/bolo clear` oder im Dashboard.

## Aktionen an Spielern im Spiel

Live-Lage → „Aktion“ oder `/ingame …`: Gefängnis (1–120 Minuten), Entlassen, Fahndungsstufe 0–5, Heilen, Respawn,
Team setzen, private Nachricht, Töten, Kicken. Die Plattform sucht den Server, auf dem der Spieler gerade ist, und
schickt den Befehl dorthin; das Spiel führt ihn innerhalb weniger Sekunden aus und meldet „Ausgeführt“ oder den
Fehler zurück (Roblox-Server → Befehle). Jede Aktion braucht einen Grund und steht im Audit-Log.

## Fahndungsalarm im Spiel

Bei einem Treffer bekommen alle Spieler der Polizei-Teams (`policeTeams`, Standard „Polizei“) auf demselben Server
ein Banner mit Fahndungsnummer, Kennzeichen bzw. Person, Fahrzeug/Team und Grund (höchstens 30 Empfänger, wie der
Discord-Alarm höchstens alle 10 Minuten). Abschaltbar mit `boloIngameAlert`.

## Spiel-Logs nach Discord (Einstellung `game_logs`)

Jede Kategorie kann einen eigenen Kanal bekommen (leer = aus): Kills (Täter, Opfer, Waffe), Teamwechsel,
Fahrzeuge (gespawnt/entfernt mit Kennzeichen), Join/Leave, Dienstbeginn/-ende und Aktionen des Teams an Spielern
(wer, was, Grund). Pro Ereignis-Charge des Servers (alle 5 s) kommt höchstens eine Sammelnachricht je Kanal mit bis zu
15 Zeilen; wiederholt gesendete Ereignisse erscheinen nicht doppelt. Spielertexte werden entschärft (keine
Erwähnungen, Links oder Formatierung).

## Live-Panel (Einstellung `live_panel`)

Eine Nachricht im eingestellten Kanal, die der Worker jede Minute aktualisiert: laufende Server (öffentlich/privat),
Spielerzahl, Teams, Fraktionen im Dienst, Einheiten, offene Einsätze, aktive Fahndungen – optional mit Spielernamen
(`showPlayers`). Wird die Nachricht gelöscht oder der Kanal geändert, legt der Bot eine neue an.

## Einstellungen (Dashboard → Bot → Einstellungen → `dispatch`)

| Feld | Bedeutung |
|---|---|
| `channelId` | Discord-Kanal für Einsatzmeldungen |
| `pingRoleId` | Rolle, die bei Ingame-Notrufen gepingt wird |
| `modCallChannelId` | Discord-Kanal für Mod-Calls |
| `departments` | Bereiche (Standard: Polizei, Rettungsdienst, Feuerwehr) – müssen zu `Config.CallCommands` im Spiel passen |
| `notifyCaller` | Anrufer im Spiel benachrichtigen, wenn sein Notruf übernommen wird |
| `boloIngameAlert`, `policeTeams` | Fahndungsalarm im Spiel an diese Teams |

## Rechte

| Recht | Wer standardmäßig |
|---|---|
| `dispatch:view` | Leitstelle, Moderation, Nur-Lesen |
| `dispatch:create`, `dispatch:edit` | Leitstelle (neue Rolle, Priorität 550) – auch Fahndungen anlegen/aufheben |
| `player_actions:edit` (Gefängnis, Fahndungsstufe, Heilen, Respawn, Team, Nachricht) | Leitstelle, Moderation |
| `player_actions:delete` (Töten, Kicken) | Moderation |
| `mod_calls:view`, `mod_calls:edit` | Moderation |

Das Polizei-Team im Spiel ist frei wählbar; gezählter Dienst bleibt wie bisher Fraktionsmitgliedern vorbehalten.
