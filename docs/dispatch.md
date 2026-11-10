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

## Einstellungen (Dashboard → Bot → Einstellungen → `dispatch`)

| Feld | Bedeutung |
|---|---|
| `channelId` | Discord-Kanal für Einsatzmeldungen |
| `pingRoleId` | Rolle, die bei Ingame-Notrufen gepingt wird |
| `modCallChannelId` | Discord-Kanal für Mod-Calls |
| `departments` | Bereiche (Standard: Polizei, Rettungsdienst, Feuerwehr) – müssen zu `Config.CallCommands` im Spiel passen |
| `notifyCaller` | Anrufer im Spiel benachrichtigen, wenn sein Notruf übernommen wird |

## Rechte

| Recht | Wer standardmäßig |
|---|---|
| `dispatch:view` | Leitstelle, Moderation, Nur-Lesen |
| `dispatch:create`, `dispatch:edit` | Leitstelle (neue Rolle, Priorität 550) |
| `mod_calls:view`, `mod_calls:edit` | Moderation |

Das Polizei-Team im Spiel ist frei wählbar; gezählter Dienst bleibt wie bisher Fraktionsmitgliedern vorbehalten.
