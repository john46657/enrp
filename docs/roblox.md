# 🎮 Eigenes Roblox-Spiel anbinden

Der Bot verbindet euer Roblox-Spiel mit **allen** Discord-Servern, auf denen er läuft:

| Discord | Darf im Spiel | Wie wird er das? |
|---|---|---|
| **Haupt-Discord** | Alles im ganzen Spiel: Ansagen, Kicks, Banns (offizielle Roblox-Ban-API), Neustart aller Server | `ROBLOX_MAIN_GUILD_IDS` in der `.env` |
| **Privatserver-Discord** | Nur in den Privatservern seines Besitzers: Ansagen, Kicks, eigene Bannliste, Neustart, **Spielrechte** (z. B. nur angenommene Bewerber ins Polizei-Team) | Haupt-Discord verknüpft ihn mit `/spiel privatserver verknuepfen` |
| **Andere Discords** | Nichts im Spiel – nur `/spiel status` und `/verifizieren` | – |

`/verifizieren` (Discord ↔ Roblox-Konto) gilt auf allen Discords gleichzeitig: einmal verifizieren, überall die Rolle und den Roblox-Namen.

**Läuft auf bot-hosting.net:** Der Bot schickt alles selbst an Roblox (Open Cloud API). Er braucht keinen eigenen Webserver
und keinen freigegebenen Port.

---

## 1. Einrichtung (einmalig, ca. 10 Minuten)

### 1.1 Universe-ID kopieren

[Creator Hub](https://create.roblox.com/dashboard/creations) → bei deinem Spiel auf **⋯** → **Copy Universe ID**.

### 1.2 API-Key erstellen

[Creator Hub → Open Cloud → API Keys](https://create.roblox.com/dashboard/credentials) → **Create API Key**.
Gehört das Spiel einer Gruppe, wähle oben die Gruppe aus.

1. **Name:** z. B. `Discord-Bot`
2. **Access Permissions** → bei **Select API System** nacheinander hinzufügen, jeweils dein Spiel auswählen:

   | API-System | Operationen | Wofür |
   |---|---|---|
   | **messaging-service** (`universe-messaging-service`) | `publish` | Ansagen, Kicks, Neustart |
   | **user-restrictions** (`universe.user-restriction`) | `read`, `write` | Banns im ganzen Spiel |
   | **data-stores** (`universe-datastores.objects`) | `read`, `create`, `update` | Bannlisten und Spielrechte der Privatserver (Datastores `ENRPPrivatServerBans` und `ENRPRechte`) |

3. **Accepted IP Addresses:** `0.0.0.0/0` – bei bot-hosting.net kann sich die IP des Servers ändern.
   Läuft der Bot auf einem eigenen VPS, trage lieber dessen feste IP ein.
4. **Expiration:** frei lassen oder ein Datum setzen (dann rechtzeitig einen neuen Key erstellen).
5. **Save & Generate Key** → Key kopieren. Er wird nur einmal angezeigt.

> ⚠️ Der Key ist ein Passwort für euer Spiel. Er gehört **nur** in die `.env` – nicht in Discord, nicht in die `config.json`,
> nicht auf GitHub. Wurde er geteilt, im Creator Hub sofort löschen und neu erstellen.

### 1.3 `.env` ergänzen

Auf bot-hosting.net: **Dateimanager** → `.env` öffnen → diese Zeilen ergänzen → speichern → Bot **neu starten**.

```env
ROBLOX_UNIVERSE_ID=1234567890
ROBLOX_API_KEY=dein-api-key
ROBLOX_MAIN_GUILD_IDS=ID-deines-Haupt-Discords
```

Die Discord-ID bekommst du per Rechtsklick auf den Servernamen → **Server-ID kopieren** (Entwicklermodus muss an sein).
Mehrere Haupt-Discords trennst du mit Komma.

### 1.4 Skript ins Spiel einbauen

1. Spiel in **Roblox Studio** öffnen.
2. Im Explorer **ServerScriptService** → Rechtsklick → **Insert Object** → **Script** (kein LocalScript).
3. Script in `ENRPBridge` umbenennen und den kompletten Inhalt von [`roblox/ENRPBridge.server.lua`](../roblox/ENRPBridge.server.lua) hineinkopieren.
4. **File → Publish to Roblox**.

Laufende Server bekommen das Skript erst nach einem Neustart. Am einfachsten: `/spiel neustart` im Haupt-Discord.

### 1.5 Testen

- `/spiel status` → zeigt Spieler online, Besuche und Favoriten.
- Im Spiel sein und im Haupt-Discord `/spiel ansage text:Test` → oben im Bild erscheint ein Banner.
- Der Bot-Status zeigt jetzt „X Spieler in <Spielname>“.

---

## 2. Privatserver-Discords

Viele Gruppen spielen auf einem eigenen Privatserver und haben einen eigenen Discord. Diese Discords können den Bot
benutzen und **nur ihre eigenen Privatserver** moderieren.

1. Der Privatserver-Discord lädt den Bot ein (gleicher Einladungslink wie beim Haupt-Discord).
2. Dort mit `/einstellungen kanal typ:Mod-Log` einen Log-Kanal festlegen.
3. Im **Haupt-Discord** verknüpft euer Team:
   ```
   /spiel privatserver verknuepfen discord_server_id:<ID des Privatserver-Discords> besitzer:<Roblox-Name des Privatserver-Besitzers> name:<Anzeigename>
   ```
4. Fertig. Das Team des Privatserver-Discords (Staff-Rolle oder „Server verwalten“) kann jetzt `/spiel` benutzen.

**Wie erkennt das Spiel den Privatserver?** Über den Besitzer (`game.PrivateServerOwnerId`). Deshalb muss niemand eine
Server-ID abtippen. Hat der Besitzer mehrere Privatserver in eurem Spiel, gelten die Rechte für alle.

**Was ein Privatserver-Discord nicht kann:**
- Nichts außerhalb der eigenen Privatserver – keine Ansagen im ganzen Spiel, keine Banns im ganzen Spiel.
- Den Besitzer des Privatservers kicken oder bannen.
- Sich selbst Rechte geben: Verknüpfen kann nur der Haupt-Discord. Das steht absichtlich nicht in `/einstellungen`.

**Kontrolle:** Jede Aktion eines Privatserver-Discords landet in dessen Mod-Log **und** im Mod-Log des Haupt-Discords.

Weitere Befehle im Haupt-Discord: `/spiel privatserver liste` und `/spiel privatserver entfernen`.
Beim Entfernen verlieren alle Spieler die Spielrechte, die dieser Discord vergeben hat.

---

## 3. Spielrechte (nur Privatserver)

Ein Privatserver-Discord entscheidet selbst, wer in **seinen** Privatservern z. B. ins Polizei-Team darf – typischerweise
alle, deren Polizei-Bewerbung dort angenommen wurde. Die öffentlichen Server eures Spiels sind davon **nicht betroffen**,
und der Haupt-Discord vergibt keine Spielrechte.

### So hängt alles zusammen

```
Bewerbung angenommen ──▶ Discord-Rolle @Polizei ──▶ Recht „polizei“ ──▶ im Privatserver: Team „Polizei“ erlaubt
Rolle entfernt (degradiert, Discord verlassen) ──▶ Recht weg ──▶ Spieler wird aus dem Team genommen
```

Die **Discord-Rollen sind die Quelle**: Wer die Rolle hat, hat das Recht. Wird sie entfernt, auch von Hand, oder verlässt
die Person den Discord, ist das Recht weg. Laufende Privatserver erfahren das sofort.

### Einrichten

**Einmal im Spiel (du als Entwickler):** Im Skript `ENRPBridge` oben bei `TEAM_RIGHTS` eintragen, welches Team welches
Recht braucht. Die Teamnamen müssen genau wie im Explorer unter **Teams** heißen:

```lua
local TEAM_RIGHTS = {
	["Polizei"] = "polizei",
	["SEK"] = "sek",
	["Flugstaffel"] = "flugstaffel",
}
local FALLBACK_TEAM = "Zivilisten" -- hierhin kommt, wer ohne Recht ein gesperrtes Team wählt (nil = neutral)
```

Welche Rechte es gibt, steht in der `config.json` unter `roblox.rights` (Standard: `polizei`, `sek`, `flugstaffel`,
`ausbilder` – passend zu den Bewerbungsarten). Neue Rechte dort ergänzen und den Bot neu starten.

**In jedem Privatserver-Discord (deren Team):**
1. Welche Rolle gibt welches Recht: `/einstellungen spielrecht recht:Polizei rolle:@Polizei`
2. Dieselbe Rolle bei der Bewerbung als Annahme-Rolle: `/einstellungen bewerbung art:Polizei-Bewerbung annahme_rolle:@Polizei`
3. Fertig. Wer ab jetzt angenommen wird, darf im Privatserver ins Polizei-Team. Wer die Rolle schon hat, wird sofort
   abgeglichen.

### Welches Roblox-Konto?

1. Das mit `/verifizieren` verknüpfte Konto, sonst
2. das Roblox-Konto aus der zuletzt **angenommenen Bewerbung** in diesem Discord (bei der Polizei-Bewerbung hat der
   Bewerber es mit „Ja, das bin ich“ bestätigt und das Team hat es gesehen).

Hat jemand die Rolle, aber kein Roblox-Konto (z. B. Rolle von Hand vergeben), steht eine Warnung im Mod-Log. Die Person
muss sich dann mit `/verifizieren start` verknüpfen.

### Im Spiel

- Wer ohne Recht ein gesperrtes Team wählt, kommt ins `FALLBACK_TEAM`, wird neu gespawnt und sieht einen Hinweis.
- Ändern sich die Rechte, während jemand spielt, gilt das sofort, mit Banner „Rechte aktualisiert“.
- Der Besitzer des Privatservers darf in seinem Server jedes Team wählen (`OWNER_HAS_ALL_RIGHTS`).
- **Für eigene Skripte**: Jeder Spieler hat im Privatserver für jedes Recht ein Attribut, z. B.
  `player:GetAttribute("ENRP_polizei") == true`, und alle Rechte in `player:GetAttribute("ENRP_Rechte")`. Damit kannst du
  Polizeifahrzeuge, Waffen, Spawns oder Funk sperren. Prüfe Rechte immer in einem Server-Skript.

### Befehle

| Befehl | Wer | Was |
|---|---|---|
| `/einstellungen spielrecht recht rolle` | Admins des Privatserver-Discords | Rolle → Recht festlegen (ohne Rolle = entfernen) |
| `/spiel rechte` | alle | eigene Rechte in diesen Privatservern |
| `/spiel rechte spieler` | Team | Rechte eines Spielers |
| `/spiel rechte-abgleichen` | Team | alle Mitglieder neu abgleichen (passiert sonst automatisch, auch nach jedem Bot-Start) |

Jede Änderung steht im Mod-Log des Privatserver-Discords: wer, welches Roblox-Konto, ➕/➖ welches Recht.

---

## 4. Verifizierung (Discord ↔ Roblox)

1. Optional pro Discord: `/einstellungen rolle typ:Verifiziert (Roblox)` und `/einstellungen roblox nickname_setzen:true`.
2. Mitglied: `/verifizieren start roblox_name:<Name>` → der Bot zeigt fünf zufällige Wörter.
3. Wörter in die Roblox-Profilbeschreibung schreiben → **Prüfen** klicken.
4. Der Bot gibt auf **allen** Discords, auf denen die Person ist, die Verifiziert-Rolle und setzt den Roblox-Namen als
   Nickname. Tritt sie später einem weiteren Discord bei, passiert das automatisch.

Danach kann das Team bei `/spiel kick|ban|unban|bann-pruefen` statt des Roblox-Namens einfach `@Person` schreiben.
`/verifizieren anzeigen @Person` (Team) zeigt das verknüpfte Konto, `/verifizieren entfernen` hebt die Verknüpfung auf.

---

## 5. Befehle

| Befehl | Wer | Haupt-Discord | Privatserver-Discord |
|---|---|---|---|
| `/spiel status` | alle | Spieler, Besuche, Favoriten | dasselbe + Name des Privatservers |
| `/spiel ansage text` | Team | Banner in allen Servern | Banner in den eigenen Privatservern |
| `/spiel kick spieler grund` | Team | Kick in jedem Server | Kick in den eigenen Privatservern |
| `/spiel ban spieler dauer grund [notiz] [zweitaccounts]` | Team | Roblox-Bann im ganzen Spiel (auch Zweitaccounts) | Bann nur in den eigenen Privatservern |
| `/spiel unban spieler` | Team | Bann aufheben | Bann aufheben |
| `/spiel bann-pruefen spieler` | Team | Bann-Status, Grund, Notiz | Bann-Status in den eigenen Privatservern |
| `/spiel banns` | Team | Verweis auf Creator Hub → Moderation → Bans | Liste aller eigenen Banns |
| `/spiel rechte [spieler]` | alle / Team | – (nur Privatserver) | Spielrechte anzeigen |
| `/spiel rechte-abgleichen` | Team | – | Spielrechte aller Mitglieder abgleichen |
| `/spiel neustart grund bestaetigen` | Team | Alle Server leeren (z. B. nach einem Update) | Eigene Privatserver leeren |
| `/spiel privatserver verknuepfen\|entfernen\|liste` | Team | Privatserver-Discords verwalten | – |
| `/verifizieren start\|anzeigen\|entfernen` | alle | Roblox-Konto verknüpfen | Roblox-Konto verknüpfen |

**Dauer:** `30m`, `12h`, `7d`, `2w` oder `perm` (dauerhaft).
**Team** = Staff-Rolle oder die Berechtigung „Server verwalten“ auf dem jeweiligen Discord.

---

## 6. So funktioniert es

```
Discord ──/spiel──▶ Bot ──Open Cloud──▶ Roblox ──MessagingService──▶ ENRPBridge-Skript in jedem Server
                                     └─ Ban-API (ganzes Spiel)   └─ Datastores „ENRPPrivatServerBans“ und „ENRPRechte“ (Privatserver)
```

- **Ansagen, Kicks, Neustart:** Der Bot sendet eine Nachricht an alle laufenden Server. Das Skript prüft, ob sie für
  diesen Server gedacht ist (ganzes Spiel oder Privatserver dieses Besitzers), und führt sie aus.
- **Banns im ganzen Spiel:** offizielle Roblox-Ban-API. Roblox wirft den Spieler sofort aus allen Servern und zeigt ihm
  beim Beitreten den Grund. Zu sehen auch im Creator Hub unter **Moderation → Bans**.
- **Banns in Privatservern:** stehen im Datastore `ENRPPrivatServerBans` (ein Eintrag je Besitzer). Das Skript prüft
  jeden Spieler beim Beitreten.
- **Spielrechte:** stehen im Datastore `ENRPRechte` (Schlüssel `owner-<Besitzer-ID>-user-<Spieler-ID>`). Das Skript
  lädt sie beim Beitreten und bekommt Änderungen live.
- **Texte aus Discord** laufen im Spiel durch den Roblox-Textfilter, wie es die Roblox-Regeln verlangen.
- Nur Server eures Spiels und der Bot mit dem API-Key können Nachrichten senden. Spieler können keine Befehle vortäuschen.

**Grenzen:**
- Ein Kick wirkt nur, wenn der Spieler gerade online ist.
- Die Spielerzahl einzelner Privatserver kann der Bot nicht abfragen, nur die des ganzen Spiels.
- Meldungen **aus** dem Spiel in den Discord (z. B. Reports als Ticket) brauchen einen Webserver. Das ist der nächste
  mögliche Ausbauschritt.

---

## 7. Fehlerbehebung

| Meldung / Problem | Lösung |
|---|---|
| „Das Spiel ist noch nicht verbunden“ | `ROBLOX_UNIVERSE_ID` und `ROBLOX_API_KEY` in der `.env` fehlen, oder der Bot wurde danach nicht neu gestartet. |
| „Der ROBLOX_API_KEY ist ungültig oder abgelaufen“ | Key im Creator Hub prüfen, ggf. neu erstellen. |
| „Dem API-Key fehlt eine Berechtigung …“ | Eine der Berechtigungen aus 1.2 fehlt, das falsche Spiel ist ausgewählt, oder die IP ist nicht erlaubt (`0.0.0.0/0`). |
| „Dieser Discord ist mit keinem Teil des Spiels verknüpft“ | Haupt-Discord in `ROBLOX_MAIN_GUILD_IDS` eintragen bzw. Privatserver-Discord verknüpfen. |
| Befehl klappt, aber im Spiel passiert nichts | Skript fehlt im **ServerScriptService** oder ist ein LocalScript, Spiel nicht veröffentlicht, oder die Server laufen noch mit der alten Version → `/spiel neustart`. |
| Spieler mit Rolle darf trotzdem nicht ins Team | Im Mod-Log nach „Roblox-Konto fehlt“ schauen. Steht der Teamname in `TEAM_RIGHTS` genau so wie unter **Teams**? `/spiel rechte spieler:<Name>` zeigt, was gespeichert ist. |
| Verifizierung findet die Wörter nicht | Beschreibung gespeichert? Roblox braucht manchmal eine Minute. Wurden Wörter durch `####` ersetzt, neu starten (neue Wörter). |
