# Web-Dashboard

Im Browser Bewerbungen bearbeiten und entscheiden – mit Anmeldung über Discord. Das Dashboard läuft **im Bot-Prozess**
mit (kein zweites Programm, keine Datenbank). Davor sitzt ein Reverse-Proxy, der deine Domain mit HTTPS bereitstellt.

```
Browser ──https──▶ dashboard.deinserver.de (Caddy oder nginx) ──▶ 127.0.0.1:3000 (Bot)
```

## Was es kann

| Bereich | Inhalt | Wer |
|---|---|---|
| **Bewerbungen** | offene und alte Bewerbungen filtern und durchsuchen, alle Antworten, KI-Checker, Verlauf, frühere Bewerbungen der Person, **Annehmen/Ablehnen mit Grund**, Prüfschritt wechseln, löschen | Manager-Rollen (nur ihre Arten), Staff |
| **Bewerbungsarten** | anlegen (Vorlage oder Kopie) und **alles bearbeiten**: Name, ID, Präfix, Emoji, Beschreibung, Panel, Fragen (alle Typen, sortieren), Prüfschritte, Wartezeit, Zeitlimit, Kanäle, alle Rollen, Texte; löschen, Reihenfolge | Staff / „Server verwalten“ |
| **Panels** | anlegen, Titel, Text, Bild, Auswahltext, Team-Kanal, Liste an/aus, **in einen Kanal posten**, löschen | Staff / „Server verwalten“ |
| **Sperren** | anlegen (Discord-ID und/oder Roblox), aufheben, Übersicht | Manager, Staff |
| **Statistik** | wie `/bewerbungen statistik` | Manager, Staff |

**Bot-Admins** (`BOT_ADMINS` in der `.env`, siehe README) sehen im Dashboard **alle Server** des Bots mit vollen
Rechten, auch ohne dort Mitglied zu sein. Sie tragen oben das Abzeichen „Bot-Admin“.

Alles, was du im Dashboard änderst, gilt sofort – genau wie mit `/bewerbungsart` in Discord. Entscheidungen lösen
dieselben DMs, Rollen und Nachrichten-Updates aus wie die Buttons in Discord. Jeder sieht nur die Server, auf denen er
Rechte hat.

## Einrichtung

### 1. Discord Developer Portal

1. [discord.com/developers/applications](https://discord.com/developers/applications) → deine Bot-Anwendung →
   **OAuth2**.
2. **Client ID** kopieren, bei **Client Secret** auf *Reset Secret* klicken und kopieren.
3. Unter **Redirects** eintragen: `https://dashboard.deinserver.de/auth/callback` (deine Domain) → *Save Changes*.

### 2. `.env`

```env
DASHBOARD_URL=https://dashboard.deinserver.de
DASHBOARD_PORT=3000
DASHBOARD_HOST=127.0.0.1
DISCORD_CLIENT_ID=123456789012345678
DISCORD_CLIENT_SECRET=dein-client-secret
DASHBOARD_SECRET=langer-zufaelliger-text
```

`DASHBOARD_SECRET` erzeugst du mit:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Wer dieses Secret kennt, kann sich als beliebige Person anmelden – niemals teilen. Ändern meldet alle ab.

### 3. Domain

Beim Domain-Anbieter einen **A-Eintrag** `dashboard` → IP deines Servers anlegen.

### 4. Reverse-Proxy mit HTTPS

**Caddy** (am einfachsten, holt das Zertifikat selbst) – `/etc/caddy/Caddyfile`:

```
dashboard.deinserver.de {
    reverse_proxy 127.0.0.1:3000
}
```

```bash
sudo systemctl reload caddy
```

**nginx** (Zertifikat z. B. mit `certbot --nginx`):

```nginx
server {
    server_name dashboard.deinserver.de;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
    listen 443 ssl;
    # ssl_certificate … (trägt certbot ein)
}
```

### 5. Bot neu starten

In der Konsole steht dann:

```
✅ Dashboard läuft auf 127.0.0.1:3000 → https://dashboard.deinserver.de
```

Fehlt etwas in der `.env`, sagt der Bot beim Start genau, was. Ohne Dashboard-Einträge läuft der Bot wie bisher.

## Sicherheit

- Anmeldung nur über Discord (Scope `identify` – der Bot sieht nur Name und Avatar). Rechte prüft der Bot bei
  **jeder Anfrage** neu anhand der aktuellen Rollen auf dem Server.
- Sitzungen sind signierte Cookies (`HttpOnly`, `SameSite=Lax`, bei https `Secure`), 12 Stunden gültig.
- Änderungen brauchen einen eigenen Header, fremde Seiten können also nichts in deinem Namen auslösen.
- Content-Security-Policy, keine fremden Skripte; Antworten von Bewerbern werden nie als HTML dargestellt.
- Rollen- und Kanal-IDs werden gegen den Server geprüft; alle Eingaben gehen durch dieselbe Prüfung wie in Discord.
- `DASHBOARD_HOST=127.0.0.1` lässt den Port nur lokal offen – erreichbar nur über den Proxy mit HTTPS.

## Fehlerbehebung

| Problem | Lösung |
|---|---|
| „Discord hat die Anmeldung abgelehnt“ | Redirect-URL im Developer Portal muss **exakt** `DASHBOARD_URL` + `/auth/callback` sein; Client Secret prüfen |
| „Keine Server“ | Du brauchst auf dem Server Staff, „Server verwalten“ oder eine Manager-Rolle einer Bewerbungsart – oder deine ID in `BOT_ADMINS` |
| 502 Bad Gateway | Bot läuft nicht oder `DASHBOARD_PORT` passt nicht zum Proxy |
| Anmeldung klappt, sofort wieder abgemeldet | Seite über `http://` statt `https://` geöffnet, obwohl `DASHBOARD_URL` https ist |

## Dateien

| Datei | Inhalt |
|---|---|
| `src/dashboard/server.js` | HTTP-Server, Login-Routen, statische Dateien, Sicherheits-Header |
| `src/dashboard/auth.js` | Discord-OAuth2, signierte Cookies |
| `src/dashboard/api.js` | JSON-API mit Rechteprüfung |
| `src/dashboard/public/` | Oberfläche (HTML, CSS, JavaScript ohne Framework) |
| `scripts/check-dashboard.js` | Tests (laufen mit `npm run check`) |
