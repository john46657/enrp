# Leitstelle (Notrufe, Einsätze, Mod-Calls, Fahndungen, Live-Lage, Ingame-Aktionen)

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

Fahndung nach einer **Person** (Roblox-ID oder Benutzername eines bekannten Spielers) oder einem **Kennzeichen**
anlegen – im Dashboard unter **Leitstelle → Fahndungen (BOLO)**, direkt aus der Live-Lage („Fahnden“ bei einem
Fahrzeug) oder mit `/bolo person|vehicle`.

1. Jeder Heartbeat (alle 30 s) wird mit allen aktiven Fahndungen abgeglichen. Kennzeichen werden ohne Leer- und
   Trennzeichen verglichen (`EN-X 999` = `enx999`). Beim Anlegen wird sofort gegen die aktuelle Live-Lage geprüft.
2. Bei einem Treffer: Zähler und „Letzter Treffer“ (Server, Fahrzeug, Spieler mit Team und Fahndungsstufe) werden
   gespeichert, das Dashboard aktualisiert sich live, und im Fahndungskanal erscheint eine Meldung mit Ping und
   Button **Erledigt**.
3. Derselbe BOLO meldet sich frühestens nach `boloHitCooldownMinutes` erneut (Standard 10 Minuten).
4. Optional läuft eine Fahndung nach *n* Stunden automatisch ab (`expired`). Erledigen mit Notiz → `resolved`.

Anlegen, Erledigen und alle Änderungen stehen im Audit-Log (`bolo.create`, `bolo.resolve`).

## Ingame-Aktionen

Aktionen an einem Spieler, der gerade online ist – im Dashboard über **Aktion** in der Spielerliste der Live-Lage
oder mit `/ingame …`:

| Aktion | Wirkung im Spiel | Recht |
|---|---|---|
| Heilen | volle Gesundheit | `ingame_actions:edit` |
| Respawn | Charakter neu laden | `ingame_actions:edit` |
| Gefängnis (Minuten) | `ENRP_Jail` = Entlasszeit, Teleport zu einem Part mit Tag `ENRPGefaengnis` (auch nach jedem Respawn), optional Team `Config.JailTeam`; nach Ablauf automatisch frei | `ingame_actions:edit` |
| Entlassen | Gefängnis sofort beenden, vorheriges Team | `ingame_actions:edit` |
| Fahndungsstufe 0–5 | Attribut `ENRP_Wanted` | `ingame_actions:edit` |
| Team | Team wechseln (muss im Spiel existieren) und neu spawnen | `ingame_actions:edit` |
| Töten | Gesundheit 0 | `ingame_actions:approve` |

Die API legt die Aktion als Server-Befehl für **den Server an, auf dem der Spieler gerade ist** (sonst Fehler „nicht
online“). Der Server holt sie innerhalb weniger Sekunden ab, führt sie aus und meldet „ausgeführt“ oder den Fehler
zurück – sichtbar unter „Letzte Ingame-Aktionen“ und mit `/ingame history`. Der Spieler bekommt einen kurzen Hinweis
mit dem Grund. Jede Aktion steht mit Grund im Audit-Log (`ingame.<aktion>`).

**Kick und Bann** im Spiel laufen bewusst weiter über die Moderation (`/mod kick|ban` mit Plattform Roblox), damit
sie als Sanktion mit Einspruchsmöglichkeit gespeichert werden.

## Einstellungen (Dashboard → Bot → Einstellungen → `dispatch`)

| Feld | Bedeutung |
|---|---|
| `channelId` | Discord-Kanal für Einsatzmeldungen |
| `pingRoleId` | Rolle, die bei Ingame-Notrufen gepingt wird |
| `modCallChannelId` | Discord-Kanal für Mod-Calls |
| `departments` | Bereiche (Standard: Polizei, Rettungsdienst, Feuerwehr) – müssen zu `Config.CallCommands` im Spiel passen |
| `notifyCaller` | Anrufer im Spiel benachrichtigen, wenn sein Notruf übernommen wird |
| `boloChannelId` | Kanal für Fahndungstreffer (leer = `channelId`) |
| `boloPingRoleId` | Rolle, die bei Fahndungstreffern markiert wird (leer = `pingRoleId`) |
| `boloHitCooldownMinutes` | Gleicher BOLO meldet frühestens nach so vielen Minuten erneut (Standard 10) |
| `maxJailMinutes` | Höchstdauer für „Gefängnis“ über Ingame-Aktionen (Standard 60) |

## Rechte

| Recht | Wer standardmäßig |
|---|---|
| `dispatch:view` | Leitstelle, Moderation, Nur-Lesen |
| `dispatch:create`, `dispatch:edit` | Leitstelle (neue Rolle, Priorität 550) – auch für BOLO anlegen/erledigen |
| `mod_calls:view`, `mod_calls:edit` | Moderation |
| `ingame_actions:view`, `ingame_actions:edit` | Moderation, Leitstelle |
| `ingame_actions:approve` (Töten) | Moderation |

> Bereits angelegte Rollen bekommen neue Rechte nicht automatisch (der Seed legt nur fehlende Rollen an).
> Nach dem Update unter *Bot-Verwaltung → Rollen & Rechte* `ingame_actions:*` für Moderation und
> `ingame_actions:view`/`ingame_actions:edit` für die Leitstelle ergänzen.

Das Polizei-Team im Spiel ist frei wählbar; gezählter Dienst bleibt wie bisher Fraktionsmitgliedern vorbehalten.
