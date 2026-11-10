# Privatserver-Discords, Spielrechte und Teamsperre

Partner-Communities, die eigene **Privatserver** (VIP-Server) in eurem Roblox-Spiel betreiben, bekommen einen
eigenen Discord mit eingeschränkten Rechten. Erkannt wird ein Privatserver im Spiel über seinen Besitzer
(`game.PrivateServerOwnerId`) – niemand muss Server-IDs abtippen.

| Discord | Darf |
|---|---|
| **Haupt-Discord** (`DISCORD_GUILD_ID`) | Alles laut Plattform-Rechten, im ganzen Spiel. Verknüpft Privatserver-Discords. |
| **Privatserver-Discord** | Nur `/ps`, nur für die Privatserver seines Besitzers: Status, Aktionen an Spielern (nie am Besitzer), Teamsperre, Spielrechte über eigene Rollen. |
| Andere Discords | Nichts – dort registriert der Bot keine Befehle. |

> **Sicherheit:** Rollen aus Privatserver-Discords zählen nie für Plattform-Rechte, auch wenn eine Rolle dort
> zufällig dieselbe ID hätte. Die API erkennt den Discord am Header `X-Actor-Guild` des Bots und wertet dessen Rollen
> nur für `/ps` aus. Dafür muss `DISCORD_GUILD_ID` in API **und** Bot gesetzt sein (ohne sie ist `/ps` deaktiviert).

## Verknüpfen (nur Haupt-Discord bzw. Dashboard)

1. Der Partner lädt den Bot in seinen Discord ein.
2. Im Haupt-Discord: `/privatserver link discord_id:<ID> besitzer:<Roblox-Name oder -ID> name:<Anzeigename> grund:<…>`
   oder im Dashboard unter *Technik & Betrieb → Privatserver-Discords → Verknüpfen*.
3. Innerhalb einer Minute erscheint dort `/ps`.

Ein Discord und ein Besitzer können jeweils nur einmal aktiv verknüpft sein. Entfernen (`/privatserver unlink` oder
Dashboard) nimmt allen Spielern sofort die Rechte dieses Discords, und `/ps` verschwindet dort.
Recht: `private_servers:view` bzw. `private_servers:edit` (Standard: Technische Administration).

## `/ps` im Privatserver-Discord

| Befehl | Wer | Wirkung |
|---|---|---|
| `/ps status` | Team-Rolle oder „Server verwalten“ | Laufende Privatserver mit Spielern, Teamsperre, Rollen |
| `/ps aktion spieler aktion grund [minuten] [stufe] [team]` | Team-Rolle oder „Server verwalten“ | Kick (nur vom Privatserver, keine Sanktion), Heilen, Respawn, Töten, Gefängnis, Entlassen, Fahndungsstufe, Team – nur auf eigenen Privatservern, nie am Besitzer |
| `/ps teamsperre aktiv` | „Server verwalten“ | Teamsperre an/aus (Standard **aus** = jeder darf in jedes Team) |
| `/ps spielrecht recht [rolle]` | „Server verwalten“ | Discord-Rolle für ein Spielrecht (ohne Rolle = entfernen) |
| `/ps teamrolle [rolle]` | „Server verwalten“ | Rolle, die `/ps status` und `/ps aktion` nutzen darf |
| `/ps logkanal [kanal]` | „Server verwalten“ | Log für Aktionen, Teamsperre und Rechte-Änderungen |
| `/ps rechte` | Team-Rolle oder „Server verwalten“ | Wer hat welches Spielrecht? |
| `/ps abgleichen` | „Server verwalten“ | Rechte sofort mit den Rollen abgleichen |

Jede Aktion steht im Audit-Log der Plattform (mit Discord-ID des Privatserver-Discords).

## Spielrechte und Teamsperre

```
Bewerbung angenommen → Rolle @Polizei im Privatserver-Discord → Recht „polizei“ → Team „Polizei“ erlaubt
Rolle weg oder Discord verlassen → Recht weg (Abgleich in wenigen Sekunden) → Spieler wird aus dem Team genommen
```

- Rechte bekommt nur, wer sein Roblox-Konto mit `/verify` verknüpft hat. Hat jemand die Rolle, aber kein Konto,
  steht ein Hinweis im Log-Kanal.
- Der Bot gleicht ab: beim Start, alle 15 Minuten, bei jeder Rollenänderung, beim Verlassen und nach
  `/ps spielrecht` bzw. `/ps abgleichen`.
- Das Spiel bekommt Rechte und Teamsperre mit jedem Heartbeat (≤ 30 s). Im Hauptspiel und auf öffentlichen Servern
  gibt es **nie** eine Teamsperre.
- Wer bei aktiver Teamsperre ohne Recht ein gesperrtes Team wählt, kommt ins Ausweich-Team und bekommt einen Hinweis.
- Für eigene Skripte setzt das Spiel `ENRP_Rechte` (kommagetrennt) und `ENRP_<recht>` = `true`.

### Einstellungen (Dashboard → Bot → Einstellungen → `private_servers`)

| Feld | Standard | Bedeutung |
|---|---|---|
| `rights` | `polizei`, `sek`, `flugstaffel`, `ausbilder` | Rechte, die Privatserver-Discords vergeben können |
| `teamRights` | `Polizei=polizei` | Gesperrte Teams bei aktiver Teamsperre (`Team=recht`, eine Zeile je Team) |
| `fallbackTeam` | `Zivilisten` | Team für Spieler ohne Recht |
| `ownerHasAllRights` | an | Besitzer hat in seinen Privatservern alle Rechte |
