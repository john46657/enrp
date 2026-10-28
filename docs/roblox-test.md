# Roblox-Integration auf dem eigenen PC testen (mit Cloudflare-Tunnel)

Live-Server laufen in der Cloud von Roblox und können `localhost` nicht erreichen. Deshalb machst du die
Plattform auf deinem PC über einen **Cloudflare-Tunnel** unter einer öffentlichen HTTPS-Adresse erreichbar –
derselbe Aufbau funktioniert dann in Roblox Studio und im veröffentlichten Spiel. Kosten: keine (Quick Tunnel
ohne Cloudflare-Konto).

Dauer beim ersten Mal: etwa 45 Minuten. Befehle sind für **Windows (PowerShell)** geschrieben; auf Mac/Linux
funktionieren sie genauso im Terminal.

## 1. Programme installieren

| Programm | Woher |
|---|---|
| Docker Desktop | <https://www.docker.com/products/docker-desktop/> – nach der Installation einmal starten |
| Git | <https://git-scm.com/download/win> |
| cloudflared | PowerShell: `winget install --id Cloudflare.cloudflared` |
| Roblox Studio | hast du schon |

## 2. Projekt holen

```powershell
git clone https://github.com/john46657/enrp.git
cd enrp
copy .env.example .env
```

## 3. Tunnel starten und Adresse merken

In einem **eigenen** PowerShell-Fenster (bleibt während des ganzen Tests offen):

```powershell
cloudflared tunnel --url http://localhost:3000
```

In der Ausgabe steht eine Adresse wie `https://ruhig-blau-wald-1234.trycloudflare.com`. Das ist ab jetzt
**deine Adresse**. Achtung: Bei jedem Neustart von `cloudflared` gibt es eine neue Adresse – dann die Schritte
4 (PUBLIC_URL/DASHBOARD_URL), 5 (Redirect) und 8 (Secret-Domain, `ApiBaseUrl`) wiederholen.

## 4. `.env` ausfüllen

Öffne `.env` im Editor und setze mindestens:

```ini
APP_ENV=development
PUBLIC_URL=https://ruhig-blau-wald-1234.trycloudflare.com
DASHBOARD_URL=https://ruhig-blau-wald-1234.trycloudflare.com
TRUST_PROXY=true
BOT_API_TOKEN=<zufälliger Wert, mind. 32 Zeichen>
HASH_SECRET=<anderer zufälliger Wert, mind. 32 Zeichen>
OWNER_DISCORD_IDS=<deine Discord-User-ID>
DISCORD_CLIENT_ID=<aus Schritt 5>
DISCORD_CLIENT_SECRET=<aus Schritt 5>
```

Zufallswerte erzeugen (zweimal ausführen):

```powershell
[Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Maximum 256 }))
```

Deine Discord-User-ID: Discord → Einstellungen → Erweitert → Entwicklermodus an → Rechtsklick auf dich → „ID kopieren“.

`DATABASE_URL` und `REDIS_URL` aus der `.env` werden in Docker automatisch durch die richtigen Werte ersetzt.

## 5. Discord-Login für das Dashboard

1. <https://discord.com/developers/applications> → deine Bot-Anwendung (oder eine neue) → **OAuth2**.
2. Client-ID und Client-Secret in die `.env` (Schritt 4).
3. Unter **Redirects** eintragen: `https://ruhig-blau-wald-1234.trycloudflare.com/api/v1/auth/discord/callback`

## 6. Plattform starten

```powershell
docker compose --profile app up -d --build api worker dashboard
```

Der erste Start dauert einige Minuten (Images werden gebaut). Den Discord-Bot brauchst du für den Roblox-Test
nicht. Prüfen:

```powershell
docker compose logs -f api
```

Wenn dort `Server listening` steht: `https://<deine Adresse>/api/v1/status` im Browser öffnen → JSON-Antwort.
Dann `https://<deine Adresse>` öffnen und mit Discord anmelden.

## 7. API-Schlüssel erzeugen

Dashboard → **Technik & Betrieb → Roblox-Server → Schlüssel erzeugen** → Name z. B. „Studio-Test“, Grund
eintragen. Den angezeigten Schlüssel (`enrp_rbx_…`) sofort kopieren – er wird nur einmal angezeigt.

## 8. Roblox Studio vorbereiten

1. Dein Spiel in Studio öffnen. Es muss **veröffentlicht** sein (Datei → In Roblox veröffentlichen), sonst lassen
   sich die Spieleinstellungen nicht ändern.
2. **Spieleinstellungen → Sicherheit → „HTTP-Anfragen zulassen“** einschalten. Speichern.
3. **Secret für Studio:** Spieleinstellungen → Sicherheit → Feld **Secrets** (gilt nur in Studio) mit folgendem
   Inhalt füllen – Schlüssel und Domain (ohne `https://`) ersetzen:

   ```json
   {"ENRP_API_KEY": ["enrp_rbx_DEIN_SCHLUESSEL", "ruhig-blau-wald-1234.trycloudflare.com"]}
   ```

   Lehnt Studio das Format ab, im Roblox-Creator-Hub-Artikel „Secrets store“ das aktuelle Format nachsehen.
   Für Live-Server legst du das Secret später im Creator Hub an (Spiel → Secrets), siehe
   [roblox/README.md](../roblox/README.md).
4. Skripte einfügen – fertige Modelldateien, kein Kopieren einzelner Skripte:
   - Rechtsklick auf **ServerScriptService** → **Aus Datei einfügen…** → `roblox/ENRP-Server.rbxmx`.
   - Rechtsklick auf **StarterPlayer → StarterPlayerScripts** → **Aus Datei einfügen…** → `roblox/ENRP-Client.rbxmx`.
5. Adresse eintragen: im eingefügten Ordner `ENRP` das ModuleScript `Config` öffnen und
   `ApiBaseUrl = "https://ruhig-blau-wald-1234.trycloudflare.com",` setzen. Alternativ die Modelldatei gleich mit
   deiner Adresse bauen: `node roblox/scripts/build-model.mjs --url https://ruhig-blau-wald-1234.trycloudflare.com`

## 9. Testen

Auf **Play** (F5) klicken. In der Ausgabe (Ansicht → Ausgabe) dürfen keine roten `[ENRP]`-Meldungen stehen.

| Test | Erwartung |
|---|---|
| Dashboard → Roblox-Server | Ein Server `studio-…` ist „Online“, Typ „Öffentlich“, 1 Spieler (du) |
| Auf den Server klicken | Detailseite, du stehst in der Spielerliste |
| „Nachricht senden“ | Innerhalb von ~5 s erscheint oben im Spiel ein Banner; Befehl steht auf „Erfolgreich“ |
| „Nachricht“ neben deinem Namen | Banner nur bei dir |
| Spielereignisse (Roblox-Server-Seite unten) | `player_joined`; nach dem Stoppen `player_left` |
| Spieltest stoppen | Server wechselt auf „Offline“ (sofort per Abmeldung oder spätestens nach 3 Minuten) |
| Neu starten, „Herunterfahren“ (Wort `HERUNTERFAHREN` eingeben) | Banner „Server wird geschlossen“, nach 10 s wirst du gekickt |
| Statistiken | Deine Spielzeit taucht unter „Spieler pro Stunde“ auf |

Weitere Punkte (Dienst, Codes, Banns, Kill-Switch, private Server) stehen in der Checkliste in
[roblox/README.md](../roblox/README.md#testcheckliste-privater-server). Private und reservierte Server lassen sich
nur im veröffentlichten Spiel testen, nicht in Studio.

**Hinweise zu Studio:**
- Beim lokalen Mehrspieler-Test (Test → Server + Spieler starten) haben die Testspieler negative IDs; sie werden
  bewusst nicht an das Backend gemeldet. Für Spielertests „Play“ verwenden.
- `Players:BanAsync` funktioniert in Studio nur eingeschränkt – Banns im veröffentlichten Spiel testen.

## Fehlersuche

| Meldung in Studio-Ausgabe | Ursache |
|---|---|
| `HTTP-Anfragen sind deaktiviert` | Schritt 8.2 |
| `Secret 'ENRP_API_KEY' fehlt` | Schritt 8.3: Name, JSON-Format oder Domain stimmt nicht |
| `Heartbeat fehlgeschlagen: UNAUTHENTICATED` | Schlüssel falsch kopiert oder widerrufen |
| `Heartbeat fehlgeschlagen: NETWORK_ERROR` | Tunnel aus oder `ApiBaseUrl` falsch |
| `Heartbeat fehlgeschlagen: FORBIDDEN` | Schlüssel ist auf andere Place-IDs beschränkt |
| `Heartbeat fehlgeschlagen: INVALID_SIGNATURE` | Uhrzeit des PCs weicht stark ab (Windows-Zeit synchronisieren) |

Login im Dashboard schlägt fehl → Redirect in Schritt 5 prüfen (genau die aktuelle Tunnel-Adresse).
Logs: `docker compose logs -f api dashboard`. Beenden: `docker compose --profile app down`
(Daten bleiben erhalten).
