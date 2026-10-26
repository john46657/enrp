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

Name, Produktbezeichnungen und Logo stehen **nur** in `config.json → branding`:

```json
"branding": {
  "name": "Emden Network",
  "shortName": "EN",
  "tagline": "Roleplay. Gemeinschaft. Verantwortung.",
  "logoUrl": "",
  "products": { "dashboard": "{name} Control Center", "…": "…" }
}
```

- `{name}` in den Produktbezeichnungen wird durch `branding.name` ersetzt – ändert sich der Name,
  reicht eine Änderung an einer Stelle.
- `logoUrl`: öffentliche Bild-URL (z. B. das hochgeladene `icon-512.png`). Ist sie gesetzt, erscheint
  das Logo in der Fußzeile aller Embeds.
- Im Code nie den Namen fest eintippen, sondern `src/lib/branding.js` verwenden:

```js
const branding = require('./lib/branding');
branding.name();               // "Emden Network"
branding.product('dashboard'); // "Emden Network Control Center"
branding.footer('B-0042');     // Embed-Fußzeile "Emden Network · B-0042" (+ Logo)
branding.color('accent');      // "#22C3B5"
```

Alle Embeds aus `embed()` (`src/lib/util.js`) tragen automatisch Markenfarbe, Fußzeile und Zeitstempel.

## Logo und Icon

Eigenes Logo, keine fremden Marken- oder Bildrechte:

| Datei | Verwendung |
|---|---|
| `assets/brand/icon.svg` | App-Icon / Favicon (Sechseck = Netzwerk, „E“ aus verbundenen Knoten, Welle = Hafenstadt Emden) |
| `assets/brand/icon-512.png` | Bot-Avatar im Discord Developer Portal, `branding.logoUrl` |
| `assets/brand/logo.svg` | Logo mit Schriftzug für Login-Seite, Navigation und README; nutzt `currentColor` für den hellen Text |

Schutzzone: mindestens die halbe Icon-Breite um das Logo frei lassen. Das Icon nicht verzerren,
umfärben oder mit anderen Logos kombinieren.

## Farben

| Token | Wert | Verwendung |
|---|---|---|
| `primary` | `#2F7DF6` | Standard-Embeds, Buttons, Links, Akzentfarbe der Panels |
| `accent` | `#22C3B5` | Verlauf, Hervorhebungen, Wortmarke „NETWORK“ |
| `success` | `#2ECC71` | Angenommen, online, erfolgreich |
| `warning` | `#F5B841` | Hinweise, Verwarnungen |
| `danger` | `#E5484D` | Abgelehnt, Strafen, Fehler |
| Hintergrund | `#0B1220` | Dunkles Theme (Standard) |
| Fläche | `#121A2B` / `#1A2438` | Karten, Panels |
| Text | `#E6EDF7` / `#8E9BB3` | Fließtext / Nebentext |

Die Embed-Farben kommen aus `config.json → colors`. Für Weboberflächen (Control Center, Admin)
liegen alle Werte als CSS-Variablen in `assets/brand/tokens.css`: dunkles Theme als Standard, helles
Theme über `data-theme="light"`.

## Typografie

- Schrift: **Inter** (Fallback: Segoe UI, Roboto, Helvetica, Arial)
- Code / IDs: **JetBrains Mono** (Fallback: Consolas, monospace)
- Überschriften fett (700–800), Fließtext 400, Wortmarke „NETWORK“ mit weiter Laufweite

## Texte und Benachrichtigungen

- Seitentitel: `<Seite> · Emden Network` bzw. `<Seite> · Emden Network Control Center`
- Discord-Embeds: Emoji + kurzer Titel, Fußzeile „Emden Network“ (über `embed()` automatisch)
- Konsolen-Logs beim Start: `⚓ Emden Network startet …` / `✅ Emden Network ist online als …`
- Sprache: Deutsch, Du-Form, sachlich und freundlich
