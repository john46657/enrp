# Emden Network – Branding

**Emden Network** ist der einzige offizielle Name des Projekts. Er gilt für alle Bestandteile:

| Bestandteil | Bezeichnung | Schlüssel in `branding.products` |
|---|---|---|
| Projekt, Discord-Bot, Logs, Benachrichtigungen | Emden Network | `bot` |
| Web-Dashboard | Emden Network Control Center | `dashboard` |
| Administrationsbereich | Emden Network Admin | `admin` |
| Backend und API | Emden Network Backend | `backend` |
| Roblox-Integration | Emden Network Roblox Integration | `roblox` |

Technische Paketnamen verwenden das Präfix `emden-network` bzw. den Scope `@emden-network/…`
(z. B. `@emden-network/shared`, `@emden-network/permissions`).

## Zentral konfigurieren

Name, Produktbezeichnungen, Profilbild und Banner stehen **nur** in `config.json → branding`:

```json
"branding": {
  "name": "Emden Network",
  "shortName": "EN",
  "tagline": "Roleplay. Gemeinschaft. Verantwortung.",
  "avatar": "assets/brand/avatar.png",
  "banner": "assets/brand/banner.webp",
  "syncProfile": true,
  "logoUrl": "",
  "bannerUrl": "",
  "products": { "dashboard": "{name} Control Center", "…": "…" }
}
```

- `{name}` in den Produktbezeichnungen wird durch `branding.name` ersetzt – ändert sich der Name,
  reicht eine Änderung an einer Stelle.
- `avatar` / `banner`: Bilddateien des Bot-Profils. Mit `syncProfile: true` überträgt der Bot sie beim
  Start auf seinen Discord-Account – aber nur, wenn sich eine Datei geändert hat (Discord begrenzt
  Profiländerungen). Neues Bild = Datei ersetzen und den Bot neu starten.
- `logoUrl` / `bannerUrl`: nur nötig, wenn andere Bilder als das Bot-Profil verwendet werden sollen.
  Leer = Profilbild und Banner des Bots, wie Discord sie hostet.
- Das Profilbild erscheint als Icon in der Fußzeile aller Embeds, der Banner in Ticket- und
  Bewerbungs-Panels ohne eigenes `image`.
- Im Code nie den Namen fest eintippen, sondern `src/lib/branding.js` verwenden:

```js
const branding = require('./lib/branding');
branding.name();               // "Emden Network"
branding.product('dashboard'); // "Emden Network Control Center"
branding.footer('Q-0042');     // Embed-Fußzeile "Emden Network · Q-0042" mit Profilbild
branding.color('primary');     // "#1E9BF0"
branding.bannerUrl();          // Banner-URL für Panels
```

Alle Embeds aus `embed()` (`src/lib/util.js`) tragen automatisch Markenfarbe, Fußzeile und Zeitstempel.

## Profilbild und Banner

| Datei | Verwendung |
|---|---|
| `assets/brand/avatar.png` | Offizielles Profilbild: „EN“-Monogramm, silbernes E und blaues N (1024 × 1024, transparent) – Bot-Avatar, Embed-Icon, Favicon und App-Icon |
| `assets/brand/banner.webp` | Offizieller Banner auf dunklem Hintergrund – Bot-Banner, Panels, README, Login-Seite des Control Centers |

Das Monogramm nicht verzerren, umfärben oder mit anderen Logos kombinieren und rundherum mindestens
ein Viertel seiner Breite frei lassen. Auf dunklen Flächen funktioniert es ohne Hintergrund, auf hellen
Flächen mit genug Kontrast zum silbernen „E“.

## Farben

Abgeleitet aus Profilbild und Banner: Silber und leuchtendes Blau auf tiefem Nachtblau.

| Token | Wert | Verwendung |
|---|---|---|
| `primary` | `#1E9BF0` | Standard-Embeds, Buttons, Links, Akzentfarbe der Panels (Blau des „N“) |
| `accent` | `#C2C8CF` | Silber des „E“, Hervorhebungen, Trennlinien |
| `success` | `#2ECC71` | Angenommen, online, erfolgreich |
| `warning` | `#F5B841` | Hinweise, Verwarnungen |
| `danger` | `#E5484D` | Abgelehnt, Strafen, Fehler |
| Hintergrund | `#050B16` | Dunkles Theme (Standard) |
| Fläche | `#0D1626` / `#142036` | Karten, Panels |
| Text | `#E8EDF4` / `#8C99AE` | Fließtext / Nebentext |

Die Embed-Farben kommen aus `config.json → colors`. Für Weboberflächen (Control Center, Admin)
liegen alle Werte als CSS-Variablen in `assets/brand/tokens.css`: dunkles Theme als Standard, helles
Theme über `data-theme="light"`.

## Typografie

- Überschriften und Wortmarke: Serifenschrift wie im Logo, z. B. **Cinzel** oder **Playfair Display**,
  in Großbuchstaben mit weiter Laufweite
- Fließtext und Oberfläche: **Inter** (Fallback: Segoe UI, Roboto, Helvetica, Arial)
- Code / IDs: **JetBrains Mono** (Fallback: Consolas, monospace)

## Texte und Benachrichtigungen

- Seitentitel: `<Seite> · Emden Network` bzw. `<Seite> · Emden Network Control Center`
- Discord-Embeds: Emoji + kurzer Titel, Fußzeile „Emden Network“ (über `embed()` automatisch)
- Konsolen-Logs beim Start: `⚓ Emden Network startet …` / `✅ Emden Network ist online als …`
- Sprache: Deutsch, Du-Form, sachlich und freundlich
