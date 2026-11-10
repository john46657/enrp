# 🎮 Roblox: Discords, Privatserver, Verifizierung und Spielrechte

Die technische Einrichtung der Spiel-Anbindung (Domain, Bridge-Schlüssel, Spiel-Skript, Endpunkte, Sicherheit) steht in
**[docs/live-system.md](live-system.md)**. Hier geht es darum, welcher Discord was darf.

## 1. Drei Arten von Discord

| Discord | Darf im Spiel | Wie wird er das? |
|---|---|---|
| **Haupt-Discord** | Alles im ganzen Spiel: Live-Daten aller Server, Befehle, Banns (optional zusätzlich Roblox-Ban-API), Neustart | `ROBLOX_MAIN_GUILD_IDS` in der `.env` |
| **Privatserver-Discord** | Nur die Privatserver seines Besitzers: Live-Daten, Befehle, eigene Bannliste, Neustart, **Spielrechte** | Haupt-Discord verknüpft ihn mit `/spiel-admin privatserver verknuepfen` |
| **Andere Discords** | Nur `/spiel status` und `/verifizieren` | – |

## 2. Privatserver-Discords

1. Der Privatserver-Discord lädt den Bot ein und legt mit `/einstellungen kanal typ:Mod-Log` einen Log-Kanal fest.
2. Im **Haupt-Discord**:
   ```
   /spiel-admin privatserver verknuepfen discord_server_id:<ID> besitzer:<Roblox-Name des Besitzers> name:<Anzeigename>
   ```
3. Fertig. Das Team dort nutzt `/spiel`, `/ingame`, `/cad` und `/bolo`, allerdings nur für die eigenen Privatserver.

Erkannt wird ein Privatserver im Spiel über seinen Besitzer (`game.PrivateServerOwnerId`). Niemand muss eine Server-ID
abtippen. Hat der Besitzer mehrere Privatserver in eurem Spiel, gelten die Rechte für alle.

**Grenzen eines Privatserver-Discords:** Er kann nichts außerhalb seiner Privatserver tun, den Besitzer nicht kicken,
bannen, töten oder jailen und sich nicht selbst verknüpfen, das kann nur der Haupt-Discord. Jede seiner Aktionen steht
zusätzlich im Mod-Log des Haupt-Discords. Beim Entfernen der Verknüpfung (`/spiel-admin privatserver entfernen`)
verlieren alle Spieler die Spielrechte, die dieser Discord vergeben hat.

## 3. Spielrechte (nur Privatserver)

Ein Privatserver-Discord bestimmt, wer in **seinen** Privatservern z. B. ins Polizei-Team darf. Typisch sind alle,
deren Polizei-Bewerbung dort angenommen wurde. Öffentliche Server sind nicht betroffen, und der Haupt-Discord vergibt
keine Spielrechte.

```
Bewerbung angenommen → Discord-Rolle @Polizei → Recht „polizei“ → im Privatserver: Team „Polizei“ erlaubt
Rolle weg (degradiert, Discord verlassen) → Recht weg → Spieler wird aus dem Team genommen
```

**Einrichten**
- Im Spiel-Skript bei `TEAM_RIGHTS` eintragen, welches Team welches Recht braucht, z. B. `["Polizei"] = "polizei"`, und
  bei `FALLBACK_TEAM` das Ausweich-Team.
- Im Privatserver-Discord: `/einstellungen spielrecht recht:Polizei rolle:@Polizei` und dieselbe Rolle als Annahme-Rolle
  der Bewerbung: `/einstellungen bewerbung art:Polizei-Bewerbung annahme_rolle:@Polizei`.

Welche Rechte es gibt, steht in der `config.json` unter `roblox.rights` (Standard: polizei, sek, flugstaffel, ausbilder).
Das Roblox-Konto kommt aus `/verifizieren`, sonst aus der zuletzt angenommenen Bewerbung. Hat jemand die Rolle, aber kein
Konto, steht eine Warnung im Mod-Log.

Im Spiel: Wer ohne Recht ein gesperrtes Team wählt, kommt ins Ausweich-Team. Rechte ändern sich live. Der
Privatserver-Besitzer darf alles (`OWNER_HAS_ALL_RIGHTS`). Für eigene Skripte gibt es die Attribute `ENRP_<recht>` und
`ENRP_Rechte`.

Befehle: `/spiel rechte [spieler]`, `/spiel rechte-abgleichen` (sonst automatisch bei jeder Rollenänderung und jedem
Bot-Start).

## 4. Verifizierung (Discord ↔ Roblox)

1. Optional je Discord: `/einstellungen rolle typ:Verifiziert (Roblox)` und `/einstellungen roblox nickname_setzen:true`.
2. Mitglied: `/verifizieren start roblox_name:<Name>`. Der Bot zeigt fünf zufällige Wörter.
3. Die Wörter in die Roblox-Profilbeschreibung schreiben, dann **Prüfen** klicken.
4. Auf **allen** Discords mit dem Bot gibt es die Verifiziert-Rolle und den Roblox-Namen als Nickname.

Danach reicht bei `/ingame …`, `/spiel spieler-info` usw. `@Person` statt des Roblox-Namens. Das CAD zeigt bei
verifizierten Einheiten, ob sie gerade im Spiel sind. `/verifizieren anzeigen` und `/verifizieren entfernen` gibt es auch.
