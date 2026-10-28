# TikTok LIVE – Benachrichtigungen

Kündigt in einem Discord-Kanal an, wenn ein Creator aus eurer Community auf TikTok live geht. Verwaltung per
`/tiktok-live` und im Dashboard unter **Social Media → TikTok LIVE**.

## Wichtig: Es gibt keine offizielle Live-Status-Schnittstelle

Geprüft im Oktober 2026: Die offiziellen TikTok-Developer-APIs liefern **keinen** Live-Status für Creator.

| Offizielle API | Was sie liefert | Live-Status? |
|---|---|---|
| Login Kit | Anmeldung mit TikTok | nein |
| Display API (`user.info.basic`, `video.list`) | Profilfelder (`open_id`, `avatar_url`, `display_name`) und Videos | nein |
| Content Posting API | Videos veröffentlichen | nein |
| Research API | nur für zugelassene Forschungseinrichtungen | nicht für diesen Zweck |

Alle Angebote, die einen Live-Status liefern, sind **inoffiziell**: Scraping, nachgebaute Web-Schnittstellen oder
Reverse Engineering. Sie können jederzeit ausfallen und verstoßen möglicherweise gegen die TikTok-Nutzungsbedingungen.
Der Bot nutzt sie deshalb **nicht** und umgeht keine Zugriffsbeschränkungen.

Darum ist die Erkennung austauschbar aufgebaut:

| Provider (`tiktok.provider`) | Status | Beschreibung |
|---|---|---|
| `none` (Standard) | **nicht verbunden** | Keine automatische Erkennung. Ankündigungen nur manuell mit `/tiktok-live announce`. |
| `webhook` | verbunden, sobald Meldungen kommen | Ein **externer Dienst, der für TikTok-LIVE-Daten autorisiert ist** (z. B. eine künftige offizielle Schnittstelle oder ein Partnerzugang), meldet den Status per HTTPS. |

Dashboard und `/tiktok-live status` zeigen immer klar an, ob die automatische Erkennung tatsächlich verbunden ist.

## Ablauf

1. Der Worker prüft alle 30 Sekunden, welche Server fällig sind (Intervall `pollSeconds`, mindestens 60 s).
2. Der Provider liefert je Creator `live`, `offline` oder `unknown` (mit Fehlertext).
3. Der Service vergleicht das Ergebnis mit dem gespeicherten Stand:
   - **`live` ohne offene Session** → neue Session anlegen und ankündigen. Bei einer offenen Session passiert nichts
     (idempotent, auch nach einem Neustart, weil der Stand gespeichert ist).
   - **`offline`** → erst nach `endGraceMinutes` durchgehend offline gilt der Stream als beendet. Optional folgt die
     Endmeldung (`endMessages`).
   - **`unknown` oder Provider-Fehler** → am Live-Status ändert sich nichts. Ein Stream wird nie wegen eines Ausfalls
     beendet. Bei Fehlern wird das Intervall verdoppelt (Backoff bis 15 Minuten).
4. Spam-Schutz: höchstens eine LIVE-Nachricht je Creator in 5 Minuten. Manuelle Ankündigungen sind für denselben
   Creator oder Link 30 Minuten gesperrt, je Nutzer höchstens 3 pro Stunde.
5. Alles landet im Ereignis- und Fehlerprotokoll (Dashboard, `/tiktok-live status`) und bei Fehlern in der Konsole.

## Befehle

| Befehl | Wer | Beschreibung |
|---|---|---|
| `/tiktok-live add username` | Admins | Creator überwachen (`@name`, `name` oder Profil-Link) |
| `/tiktok-live remove username` | Admins | Creator entfernen |
| `/tiktok-live channel channel` | Admins | Benachrichtigungskanal |
| `/tiktok-live role [role]` | Admins | Rolle, die erwähnt wird (ohne Rolle = niemand). `@everyone`/`@here` nie. |
| `/tiktok-live list` | Admins, Ankündigungs-Rollen | Creator mit zuletzt bekanntem Status |
| `/tiktok-live status` | Admins, Ankündigungs-Rollen | Erkennung, letzte erfolgreiche Prüfung, letzte Fehler |
| `/tiktok-live settings` | Admins, Ankündigungs-Rollen | Aktive Einstellungen |
| `/tiktok-live test` | Admins, Ankündigungs-Rollen | Testnachricht, als Test gekennzeichnet und ohne Erwähnung |
| `/tiktok-live announce link` | Admins, Ankündigungs-Rollen | Manuelle Ankündigung mit Vorschau. Nur `https://` auf `tiktok.com`, `www.`, `m.`, `vm.`, `vt.tiktok.com`. Als „manuell angekündigt von …“ gekennzeichnet. |

„Admins“ = „Server verwalten“ oder Server-Besitzer. Ankündigungs-Rollen stellst du unter `tiktok.manualRoles` ein.
Alle Rechte prüft der Bot selbst, nicht Discord.

## Einstellungen (`tiktok` in config.json bzw. Dashboard)

| Feld | Bedeutung |
|---|---|
| `enabled` | Modul an/aus (manuelle Ankündigungen nur, wenn an) |
| `channel`, `role` | Kanal und optionale Rolle |
| `provider` | `none` oder `webhook` |
| `pollSeconds` | Prüfintervall in Sekunden (mind. 60) |
| `endMessages`, `endGraceMinutes` | Endmeldung an/aus, Toleranz bis „beendet“ |
| `manualRoles` | Rollen, die manuell ankündigen dürfen |
| `template` | `title`, `text`, `footer`, `color` der LIVE-Nachricht. Platzhalter `{brand}` (= `serverName`), `{creator}`, `{url}` |
| `endTemplate` | `title`, `text` der Endmeldung |

## Webhook-Provider einrichten

1. In der `.env`: `TIKTOK_WEBHOOK_SECRET=<langer zufälliger Text>` (nie ins Repository oder in den Browser).
2. Dashboard muss laufen (`DASHBOARD_URL`, siehe README).
3. Im Dashboard `Erkennungs-Provider = Webhook` wählen.
4. Der autorisierte Dienst sendet für jeden Creator den Status:

```http
POST https://2pgwy073wo.apps.bot-hosting.cloud/hooks/tiktok
Authorization: Bearer <TIKTOK_WEBHOOK_SECRET>
Content-Type: application/json

{ "username": "creatorname", "status": "live", "url": "https://www.tiktok.com/@creatorname/live" }
```

`status` ist `live` oder `offline`. Meldungen gelten 10 Minuten; danach ist der Status wieder „unbekannt“. Der
Dienst sollte also mindestens alle paar Minuten melden. Eingaben werden geprüft, ungültige Anfragen mit 400
abgelehnt, falsche Secrets mit 401; je IP sind 120 Anfragen pro Minute erlaubt.

## Daten

Gespeichert in `data/db.json` unter `tiktok.<Server-ID>`. Das entspricht den geforderten Modellen; eine eigene
Datenbank wie PostgreSQL oder Redis braucht dieser Bot nicht:

| Modell | Ort | Inhalt |
|---|---|---|
| TikTokCreator | `creators` | Benutzername (= Kennung), aktiv, zuletzt bekannter Status, letzte (erfolgreiche) Prüfung, letzter Fehler |
| TikTokLiveSession + NotificationHistory | `sessions` (letzte 200) | Quelle (automatisch/manuell), Link, Beginn, Ende, Kanal- und Nachrichten-ID, Ergebnis/Fehler der Benachrichtigung, Ersteller bei manuell |
| TikTokLiveEvent | `events` (letzte 200) | Ereignis- und Fehlerprotokoll |
| TikTokProviderStatus | `provider` | letzter Durchlauf, letzter Erfolg, Fehler in Folge, nächste Prüfung |
| TikTokLiveSettings | Einstellungen `tiktok` | siehe oben |

Gespeichert werden nur TikTok-Benutzernamen sowie Discord-IDs von Kanälen, Nachrichten und Ankündigenden.

## Tests

`npm test` prüft: Creator hinzufügen/entfernen, neue Session, keine doppelten Nachrichten, Neustart, Provider-Ausfall
mit Backoff, unbekannten Status, LIVE-Ende mit Toleranz, Spam-Schutz, fehlende Discord-Berechtigungen, Rollen-Erwähnung,
unberechtigte Befehle, ungültige manuelle Links und die Prüfung der Dashboard-Eingaben. Live/Offline kommen dabei nur
von einem Test-Provider; es wird kein echter Live-Status vorgetäuscht.
