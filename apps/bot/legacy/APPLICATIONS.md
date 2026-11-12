# Bewerbungssystem

Übersicht über das Bewerbungssystem des Bots: **eigene Bewerbungen und Fragen in Discord anlegen** (es gibt keine
vorgefertigten), Fragen per Direktnachricht, Entscheidungen im Team-Kanal, Sperren, KI-Checker und Statistik.

> Kurzfassung: Bewerber klicken in Discord auf ein Panel → der Bot stellt die Fragen per Direktnachricht → die Bewerbung
> landet mit Annehmen/Ablehnen-Buttons im Team-Kanal → die Entscheidung geht per DM an die Person, Rollen werden
> automatisch vergeben/entfernt.

Alles läuft in Discord. Im Dashboard (Gruppe **Bewerbungen**) gibt es zusätzlich: Liste mit Filter und Suche,
Annehmen/Ablehnen mit Grund, Prüfschritte, interne Notizen, CSV-Export, Sperren, Statistik und die Einrichtung der
Bewerbungsarten mit Fragen, Rollen, Kanälen und Texten. Was fehlt, steht unter [13. Nicht enthalten](#13-nicht-enthalten).

---

## 1. Bewerbungsarten

Der Bot bringt **keine fertigen Bewerbungen** mit. Jeder Server legt seine eigenen an – Name, Emoji, Beschreibung und
alle Fragen – mit `/bewerbung-verwalten` (siehe [6.](#6-bewerbungen-selbst-erstellen-bewerbung-verwalten)). Werte, die
eine Bewerbung nicht selbst setzt (Texte, Wartezeit, Zeitlimit …), kommen aus `applications.defaults` in der `config.json`.

Beim Anlegen wählst du den **Ablauf**:

| Ablauf | `workflow` | Statusablauf |
|---|---|---|
| **Einfach** (Standard) | `simple` | `OPEN → ACCEPTED \| REJECTED \| WITHDRAWN` |
| **Mehrstufig** | `police` | `SUBMITTED → SCREENING → INTERVIEW → PENDING_DECISION → ACCEPTED \| REJECTED \| WITHDRAWN` |

Die Bewerbungsnummer beginnt mit dem **Kürzel** (`numberPrefix`, z. B. `POL-0001`). Lässt du es weg, wird es aus dem
Namen gebildet (Flugstaffel → `FLUG`). Gezählt wird je Kürzel und Server.

Wo eine Bewerbung erscheint, legst du über **Panels** fest (siehe [6.1](#61-panels)). Eine Bewerbung kann in mehreren
Panels sein.

Erlaubte Statuswechsel im mehrstufigen Ablauf (`POLICE_TRANSITIONS` in `src/lib/applications/store.js`):

| von | erlaubt nach |
|---|---|
| SUBMITTED | SCREENING, REJECTED, WITHDRAWN |
| SCREENING | INTERVIEW, REJECTED, WITHDRAWN |
| INTERVIEW | PENDING_DECISION, REJECTED, WITHDRAWN |
| PENDING_DECISION | ACCEPTED, REJECTED, WITHDRAWN |
| ACCEPTED / REJECTED / WITHDRAWN | – (Endzustand) |

Über die Buttons **Annehmen/Ablehnen** kann aus **jedem offenen Status** direkt entschieden werden. Die Zwischenschritte
wählt das Team im Status-Menü unter der Bewerbung.

---

## 2. Ablauf für Bewerber (Fragen per Direktnachricht)

1. Person klickt im Panel auf **Jetzt bewerben**, wählt eine Art im Auswahlmenü oder nutzt `/bewerbung [art]`.
2. Vorabprüfungen (`offer()` in `src/lib/applications/flow.js`, `eligibility()` in `store.js`):
   - Läuft schon eine Bewerbung im DM-Chat?
   - Ist die Bewerbung aktiviert (`enabled`)?
   - **Rollen-Voraussetzungen**: *erforderliche* Rollen (`requiredMode`: `all` oder `any`) und *gesperrte* Rollen
     (`blockedMode`)
   - **Bewerbungssperre** (siehe 7.)
   - Gibt es schon eine **offene Bewerbung** derselben Art auf diesem Server?
   - Ist die **Wartezeit** (`cooldownMinutes`) seit der letzten Bewerbung dieser Art vorbei?
3. Der Bot schickt per DM die **Startnachricht** mit *Bewerbung starten* / *Abbrechen*. Im Kanal bekommt die Person
   den Button „Zur Bewerbung“ (Link in die DMs). Sind die DMs geschlossen, erklärt der Bot, wie man sie öffnet.
4. Nach *Starten* kommen die Fragen **einzeln**:
   - **TEXT** → Antwort als Nachricht (Mindest- und Höchstlänge werden geprüft)
   - **CHOICE / ROLE** → Auswahlmenü, optionale Fragen mit *Überspringen*
   - **ROBLOX** → Bot sucht das Konto und zeigt es mit Profilbild, die Person bestätigt mit „Ja, das bin ich“
   - Abbrechen jederzeit durch Schreiben von **abbrechen**
5. Zeitlimit: `timeLimitMinutes`, Standard 3 Stunden, 5 Minuten bis 7 Tage. Eine abgelaufene Bewerbung wird beendet
   und die Person per DM informiert. Der Fortschritt erscheint unter `/bewerbungen in-bearbeitung`.
6. Nach der letzten Antwort wird eingereicht. Die Person erhält die **Abschlussnachricht** mit Bewerbungsnummer und
   einem Button **Bewerbung zurückziehen**.

> Laufende DM-Bewerbungen liegen in `data/db.json` (`appSessions`). Nach einem Neustart schickt der Bot die aktuelle
> Frage noch einmal und es geht weiter. Ist die Zeit inzwischen abgelaufen, endet die Bewerbung mit einem Hinweis.

---

## 3. Prüfungen beim Einreichen

`submit()` in `src/lib/applications/flow.js` wiederholt alle Prüfungen vom Start, weil sich in der Zwischenzeit etwas
geändert haben kann (Rolle verloren, gesperrt, Bewerbung geschlossen). Dazu kommen:

1. Jede Antwort gegen ihre Frage (`checkAnswer()` in `src/lib/applications/forms.js`): Pflichtfeld, Länge, gültige
   Auswahl, gültiger Roblox-Name. Bestätigte Roblox-Konten werden als `Name (ID 123)` gespeichert.
2. **Bewerbungssperre** per Discord-ID **oder** Roblox-ID
3. **Keine zweite offene Bewerbung** derselben Art (je Server; mehrstufige zusätzlich je Roblox-ID)

Danach:
- Datensatz anlegen, „in Bearbeitung“ entfernen
- **KI-Checker** ausführen (siehe 8.)
- Nachricht in den Team-Kanal, optional mit Team-Thread (siehe 5.)
- Rollen „ausstehend“ (`pending`) geben, Rollen „beim Einreichen entfernen“ (`removeOnSubmit`) nehmen

---

## 4. Entscheiden (Team-Kanal)

Jede eingegangene Bewerbung hat Buttons:

| Button / Menü | Wirkung |
|---|---|
| **Annehmen** / **Ablehnen** | sofort entscheiden |
| **Annehmen mit Grund** / **Ablehnen mit Grund** | Formular, der Grund geht **per DM an die Person** |
| **Verlauf** | alle bisherigen Bewerbungen dieser Discord-ID |
| **🎫 Ticket mit Bewerber öffnen** | privater Ticket-Kanal mit Bewerber, Manager-Rollen und dir (du übernimmst es direkt) |
| **Status-Menü** (nur mehrstufig) | nächster Prüfschritt (In Prüfung, Gespräch, Entscheidung ausstehend) oder Zurückziehen |

**Wer klicken darf:** Staff (Rolle `roles.staff` oder „Server verwalten“) **oder** eine der **Manager-Rollen**
(`roles.managers`) dieser Bewerbung. Über die eigene Bewerbung kann niemand entscheiden. Doppelte Klicks sind
abgesichert: Wer als Zweiter klickt, sieht „bereits entschieden von …“.

### Was bei der Entscheidung passiert
- Status, Entscheider, Zeitpunkt und ggf. Grund werden gespeichert, inklusive Verlauf (`history`).
- **DM an die Person** mit dem eingestellten Annahme- oder Ablehnungstext (Variablen siehe 6.3).
- **Rollen bei Annahme:** `acceptAdd` sowie die in ROLE-Fragen gewählten Rollen werden vergeben. `acceptRemove` und
  `pending` werden genommen.
- **Rollen bei Ablehnung:** `rejectAdd` wird vergeben. `rejectRemove` und `pending` werden genommen.
- **Team-Nachricht:** Sie wird aktualisiert (Farbe, Status, wer, Grund), die Entscheidungs-Buttons verschwinden. Bei
  aktivem Team-Thread kommt dort ein Hinweis.
- **Archiv:** Ist `channels.accepted` bzw. `channels.rejected` gesetzt, wird die Bewerbung zusätzlich dorthin gepostet.

### Zurückziehen
- **Bewerber:** Button in der Abschluss-DM.
- **Team:** „Zurückziehen“ im Status-Menü (nur mehrstufig).

In beiden Fällen bekommt die Person eine DM und die Rolle „ausstehend“ wird genommen.

### Person verlässt den Server
`onLeave` je Bewerbungsart: `NONE` (nichts), `DENY` (automatisch ablehnen) oder `WITHDRAW` (zurückziehen, Standard).
Grund: „Hat den Discord-Server verlassen.“ Eine laufende DM-Bewerbung wird abgebrochen. Dafür braucht der Bot den
*Server Members Intent*.

---

## 5. Team-Nachricht

Aufbau (`buildTeamMessage()` in `src/lib/applications/messages.js`):

- **Info-Embed:** Art und Nummer, Status, Grund, Bewerber (Discord-ID, Roblox mit Profil-Link, auf dem Server seit,
  Discord-Konto seit, Dauer), **KI-Checker** und gewählte Rollen.
- **Antworten:** Jede Frage ist ein Feld, auf mehrere Embeds verteilt (je 25 Felder). Vom KI-Checker markierte
  Antworten tragen ein ⚠️.
- **Grenzen:** Discord erlaubt pro Nachricht 6000 Zeichen in allen Embeds zusammen. Reicht das nicht, werden Antworten
  (und notfalls Fragen) gekürzt, und die vollständigen Antworten hängen als `bewerbung-APP-0001.txt` an.
- **Ping:** die Ping-Rollen (`roles.ping`) werden markiert. Mit `teamThreads: true` wird zusätzlich ein Thread
  geöffnet.

Kanal für neue Bewerbungen: `channels.open` der Art. Ist er leer, gilt der Standard-Kanal `applications.channel`
(`/einstellungen bewerbungs-kanaele`). Alte Einheiten-Bewerbungen aus dem früheren Qualifikations-Panel nutzen
`applications.qualiChannel`.

---

## 6. Bewerbungen selbst erstellen (`/bewerbung-verwalten`)

Ohne Neustart und nur für den jeweiligen Server. Dafür braucht man „Server verwalten“. Es gibt drei Wege, die alle
dasselbe speichern:

1. **Übersicht in Discord** – `/bewerbung-verwalten uebersicht` öffnet ein Menü mit Buttons (nur für dich sichtbar):
   - **📋 Bewerbungen: N** – Liste, 🔍 Suchen, ➕ Neue Bewerbung. Eine Bewerbung öffnen → Bearbeiten, Texte,
     Öffnen/Schließen, Ablauf, Löschen, Fragen hinzufügen (Typ wählen → Formular), Fragen bearbeiten, verschieben,
     entfernen.
   - **🗂️ Panels: N** – ➕ Neues Panel, Bewerbungen im Panel auswählen, in einen Kanal posten, bearbeiten, löschen.
     Ohne Bewerbung zeigt es „Keine Bewerbungen gefunden“ mit einem Button zum Erstellen.
2. **Dashboard der Plattform** (siehe [6.5](#65-dashboard-der-plattform)) – Einstellungen, Fragen-Editor und Panels posten.
3. **Einzelbefehle** (praktisch für schnelle Änderungen):

Bei `art` schlägt Discord beim Tippen die Bewerbungen des Servers vor.

| Unterbefehl | Wirkung |
|---|---|
| `uebersicht` | die Übersicht mit Buttons (siehe oben) |
| `erstellen name [emoji] [beschreibung] [ablauf] [kuerzel]` | neue Bewerbung anlegen (kommt automatisch ins erste Panel) |
| `bearbeiten art …` | dieselben Felder ändern (nur angegebene; `beschreibung:-` leert) |
| `loeschen art bestaetigen` | löschen. Gibt es noch offene Bewerbungen oder füllt sie gerade jemand aus, geht das nicht. Alte Bewerbungen bleiben mit `/bewerbungen` lesbar |
| `texte art` | Formular für die vier DM-Texte (Start, Einreichen, Annahme, Ablehnung). Leer = Standardtext |
| `fragen art` | alle Fragen mit Nummer, Typ und Einstellungen |
| `frage-hinzufuegen art typ frage [hinweis] [pflicht] [min_zeichen] [max_zeichen] [optionen] [mehrfach] [position]` | Frage hinzufügen (Standard: Pflicht, ans Ende) |
| `frage-bearbeiten art nummer …` | Frage ändern (nur angegebene Optionen) |
| `frage-entfernen art nummer` | Frage entfernen |
| `frage-verschieben art nummer position` | Reihenfolge ändern |
| `phase art [oeffnet] [schliesst] [plaetze]` | Bewerbungsphase (siehe [6.6](#66-bewerbungsphasen)) |
| `dienstnummer art [aktiv] [format] [stellen] [start] [ende] [nickname] [freigeben_bei_verlassen]` | Dienstnummer-Automatik (siehe [6.7](#67-dienstnummern)) |

**Fragetypen** (`typ`):

| Typ | Antwort | Optionen |
|---|---|---|
| Freitext | Nachricht in der DM | `min_zeichen`, `max_zeichen` (Standard 1000, bis 5000) |
| Auswahl | Auswahlmenü | `optionen:Täglich; Mehrmals pro Woche; Selten` (max. 25, mit `;` getrennt), `mehrfach` |
| Rollen-Auswahl | Auswahlmenü, die gewählten Rollen gibt es **bei Annahme** | `optionen:@Streife; @Verkehr`, `mehrfach` |
| Roblox-Benutzername | wird bei Roblox gesucht und muss bestätigt werden (höchstens eine je Bewerbung) | – |

Beispiel:

```
/bewerbung-verwalten erstellen name:Polizei-Bewerbung emoji:👮 ablauf:Mehrstufig kuerzel:POL
/bewerbung-verwalten frage-hinzufuegen art:Polizei-Bewerbung typ:Roblox-Benutzername frage:Wie heißt du in Roblox?
/bewerbung-verwalten frage-hinzufuegen art:Polizei-Bewerbung typ:Freitext frage:Warum möchtest du zu uns? min_zeichen:50
/bewerbung-verwalten frage-hinzufuegen art:Polizei-Bewerbung typ:Auswahl frage:Wie aktiv bist du? optionen:Täglich; Mehrmals pro Woche; Selten
/einstellungen bewerbung art:Polizei-Bewerbung manager_rolle:@Ausbilder annahme_rolle:@Polizeianwärter
/bewerbung-verwalten uebersicht   → 🗂️ Panels → ➕ Neues Panel → in #bewerbungen posten
```

- Eine Bewerbung **ohne Fragen** erscheint in keinem Panel und lässt sich nicht starten.
- Änderungen an den Fragen gelten für neue Bewerbungen. Wer gerade ausfüllt, bekommt noch die alten Fragen.
- Gepostete Panels aktualisieren sich nach jeder Änderung automatisch.
- Höchstens 25 Bewerbungen je Server und 50 Fragen je Bewerbung.

Rollen, Kanäle, Wartezeit, Zeitlimit usw. stellst du danach mit `/einstellungen bewerbung` ein (siehe 6.4).
`/einstellungen zuruecksetzen` setzt nur diese Einstellungen zurück, die Bewerbungen selbst bleiben erhalten.

> **Update von einer älteren Version:** Früher waren Polizei, SEK, Flugstaffel und Ausbilder fest eingebaut. Hat ein
> Server sie schon benutzt (Bewerbungen oder geänderte Einstellungen), werden sie beim Start einmalig als eigene
> Bewerbungen dieses Servers übernommen und lassen sich danach wie jede andere bearbeiten oder löschen.

### 6.1 Panels
Ein Panel ist die Nachricht in Discord, über die man sich bewirbt. Du legst beliebig viele an, jedes mit **Name**,
**Überschrift**, **Text**, optional **Bild** und den **Bewerbungen**, die darin auswählbar sind.

- Für ein Panel brauchst du mindestens eine Bewerbung.
- Mit einer Bewerbung zeigt das Panel den Button *Jetzt bewerben*, mit mehreren eine Liste und ein Auswahlmenü.
- Bewerbungen ohne Fragen erscheinen nicht.
- Posten: in der Übersicht oder im Dashboard der Plattform einen Kanal wählen, oder `/bewerbungspanel [panel]` im Kanal.
- Gepostete Panels aktualisieren sich automatisch bei jeder Änderung und beim Bot-Start. Wird ein Panel gelöscht,
  verschwinden auch seine Nachrichten.
- Früher gab es zwei feste Panels (Bewerbungs- und Qualifikations-Panel). Sie werden beim Update automatisch zu
  Panels mit denselben Texten; schon gepostete Nachrichten funktionieren weiter.

### 6.2 Aufbau einer Bewerbung
So speichert der Bot eine Bewerbung (in `data/db.json` unter `appTypes`): `id` (wird aus dem Namen gebildet, `a-z0-9_-`,
2–24 Zeichen), `name`, `emoji`, `description`, `workflow`, `numberPrefix`, `questions` (max. 50) und alle
Einstellungen aus 6.4. Wer möchte, kann Bewerbungen auch für alle Server fest in `config.json` unter
`applications.types` eintragen – im Auslieferungszustand ist die Liste leer.

### 6.3 Fragen
```json
{ "key": "f1", "type": "TEXT", "label": "Warum möchtest du zu uns?", "required": true, "min": 50, "max": 1000 }
```

| `type` | Beschreibung |
|---|---|
| `TEXT` | Freitext; `required`, `min`, `max` (bis 5000) |
| `CHOICE` | Auswahl aus `options` (max. 25, `{ "label": "Täglich" }`); `multiple` für Mehrfachauswahl |
| `ROLE` | wie CHOICE, aber jede Option hat `roleId`. Die gewählten Rollen werden **bei Annahme** vergeben |
| `ROBLOX` | Roblox-Benutzer: wird bei Roblox gesucht und muss bestätigt werden |

Optional ist bei jeder Frage `description` (Zusatztext unter der Frage, in Discord `hinweis`).

### 6.4 Einstellungen je Bewerbung

**Grundlegendes:** `enabled`, `name` (`{applicationName}`), `channels.open` / `accepted` / `rejected`.

**Texte** (`messages.start`, `finish`, `accept`, `reject`), mit den Variablen
`{applicationName}`, `{user}` = Entscheider, `{applicant}`, `{number}`, `{reason}`, `{questionCount}` und
`{timeLimit}`. Fehlt `{reason}` im Text, wird ein vorhandener Grund automatisch angehängt.

**Rollen** (`roles`, jeweils Listen von Rollen-IDs):

| Feld | Bedeutung |
|---|---|
| `required` + `requiredMode` (`all`/`any`) | ohne diese Rollen keine Bewerbung |
| `blocked` + `blockedMode` (`any`/`all`) | mit diesen Rollen keine Bewerbung |
| `acceptAdd` / `acceptRemove` | bei Annahme geben / nehmen |
| `rejectAdd` / `rejectRemove` | bei Ablehnung geben / nehmen |
| `pending` | beim Einreichen geben, bei jeder Entscheidung nehmen |
| `removeOnSubmit` | beim Einreichen nehmen |
| `ping` | bei neuen Bewerbungen markieren |
| `managers` | dürfen in Discord entscheiden |

**Sonstiges:**

| Feld | Bedeutung |
|---|---|
| `teamThreads` | Team-Thread zu jeder Bewerbung öffnen |
| `cooldownMinutes` | Wartezeit zwischen zwei Bewerbungen |
| `timeLimitMinutes` | Zeitlimit zum Ausfüllen |
| `onLeave` | was passiert, wenn die Person den Server verlässt (siehe 4.) |

`npm run check` und der Bot-Start prüfen die Bewerbungsarten und melden Fehler wie doppelte Schlüssel, fehlende
Optionen oder ungültige Werte.

### 6.5 Dashboard der Plattform

Im Dashboard der Plattform (**Altmodule → Bewerbungen → Einrichtung**) siehst du dieselben Bewerbungen: Einstellungen,
Rollen, Kanäle, Fragen-Editor und „Panel posten“ (Auswahl der Panels, die du in Discord angelegt hast). Änderungen dort
und mit `/bewerbung-verwalten` landen an derselben Stelle, keine Seite überschreibt die andere. Wer was darf, regelt das
Rechtesystem der Plattform (`applications:configure`); „Server verwalten“ in Discord gilt weiterhin.

---

### 6.6 Bewerbungsphasen

`/bewerbung-verwalten phase art:… oeffnet:24.12.2026 18:00 schliesst:31.12.2026 23:59 plaetze:20`

- **oeffnet / schliesst**: Zeitpunkt in der Zeitzone des Servers (`/einstellungen zeitzone`), z. B. `24.12.2026 18:00`,
  `24.12.2026` oder `2026-12-24 18:00`. `-` leert den Wert.
- **plaetze**: höchstens so viele Bewerbungen ab Phasenbeginn (0 = unbegrenzt). Die Plätze stehen auch im Dashboard.
- Vor dem Öffnen, nach dem Schließen oder wenn alle Plätze vergeben sind, kann sich niemand bewerben. Das Panel zeigt den
  Zustand („öffnet in 2 Tagen“, „3 von 20 Plätzen frei“, „geschlossen“) und aktualisiert sich jede Minute von selbst,
  wenn sich der Zustand ändert.
- `enabled` (Bewerbungen annehmen an/aus) gilt weiterhin zusätzlich.

### 6.7 Dienstnummern

`/bewerbung-verwalten dienstnummer art:… aktiv:true format:PD-{n} stellen:2 start:1 ende:99 nickname:[{serviceNumber}] {name}`

- Bei **Annahme** bekommt die Person automatisch die kleinste freie Nummer (z. B. `PD-07`). Wer schon eine hat, behält sie.
- Die Nummer steht in der Annahme-DM (`{serviceNumber}` im Text, sonst wird sie angehängt) und in der Team-Nachricht.
- **nickname**: Vorlage mit `{serviceNumber}` `{name}` (Roblox-Name, sonst Discord-Name) `{roblox}` `{username}`, höchstens
  32 Zeichen. Leer = Nickname nicht ändern.
- **freigeben_bei_verlassen**: Nummer wieder frei, wenn die Person den Server verlässt (Standard: ja).
- `/dienstnummer anzeigen [user]` (alle), `/dienstnummer liste`, `/dienstnummer setzen user [nummer] [art]`,
  `/dienstnummer entfernen user` (Team).

---

## 7. Bewerbungssperren (`/bewerbungssperre`)

- `hinzufuegen`: Sperrt eine Person per **Discord-Nutzer und/oder Roblox-Name** (wird bei Roblox nachgeschlagen).
  - Bereich: alle Bewerbungen oder eine bestimmte (Vorschläge beim Tippen).
  - Mit Grund und optionaler Dauer in Tagen.
- `aufheben`: Hebt eine Sperre über ihre ID auf (z. B. `B-0001`).
- `liste`: Zeigt alle aktiven Sperren.

Gesperrte Personen können die Bewerbung gar nicht erst starten und werden beim Absenden abgewiesen. Sie sehen dabei
Grund und Ablaufdatum. Sperren gelten je Server. Anlegen und Aufheben wird im Mod-Log festgehalten. Erlaubt ist das für
Staff und Manager-Rollen.

---

## 8. KI-Checker

`src/lib/applications/aiCheck.js` läuft lokal ohne externen Dienst. Er bewertet die Antworten mit
**gering / mittel / hoch** und nennt Gründe:
- typische KI-Formulierungen
- Chat-Spuren („Gerne! Hier ist …“) und Platzhalter wie „[Dein Name]“
- Geviertstrich (—) und Markdown
- Tipp-Tempo: Zeichen pro Minute zwischen Frage und Antwort, damit fallen hineinkopierte Texte auf
- auffällig gleichförmiger Aufbau

Das Ergebnis steht im Info-Embed, betroffene Antworten sind mit ⚠️ markiert, und `/bewerbungen offen` zeigt 🔴 bei
hohem Verdacht. **Nur ein Hinweis, kein Beweis.** Frag im Zweifel im Gespräch nach.

---

## 9. Statistik (`/bewerbungen statistik`)

| Teil | Inhalt |
|---|---|
| Zeitraum | 7–365 Tage (Standard 30), verglichen mit der Vorperiode |
| Filter | Bewerbungsart, Status, Prüfer |
| Kennzahlen | Anzahl, Annahmequote, ⌀ Bearbeitungszeit, offene, Abschlussquote |
| Verlauf | je Tag und als 7-Tage-Schnitt (Sparkline) |
| Aufteilung | angenommen / offen / abgelehnt / zurückgezogen, je Bewerbungsart |
| Prüfer | Top 10 |
| Heatmap | Wochentag × Stunde in Berliner Zeit |

---

## 10. Rechte

| Wer | darf |
|---|---|
| alle | sich bewerben (`/bewerbung`, Panels), eigene Bewerbung zurückziehen |
| **Manager-Rollen** einer Art | diese Art entscheiden, Statusschritte, Verlauf, Ticket öffnen; `/bewerbungen` (außer löschen), `/bewerbungssperre` |
| **Staff** (`roles.staff` oder „Server verwalten“) | alles oben für alle Arten, dazu `/bewerbungen loeschen` |
| „Server verwalten“ oder `applications:configure` | `/bewerbung-verwalten`, `/bewerbungspanel`, `/einstellungen`, Dashboard |

---

## 11. Discord-Befehle

| Befehl | Wer | Wirkung |
|---|---|---|
| `/bewerbung [art]` | alle | Bewerbung starten (Standard: die erste im ersten Panel) |
| `/bewerbung-verwalten …` | „Server verwalten“ | Bewerbungen und Fragen anlegen, ändern, löschen (siehe 6.) |
| `/bewerbungspanel [panel]` | „Server verwalten“ | ein Panel in den Kanal posten (Standard: das erste) |
| `/bewerbungen offen [art]` | Team | offene Bewerbungen mit Links |
| `/bewerbungen in-bearbeitung` | Team | gerade laufende DM-Bewerbungen |
| `/bewerbungen anzeigen <nummer>` | Team | Bewerbung mit allen Antworten (auch als `.txt`) |
| `/bewerbungen verlauf <user>` | Team | alle Bewerbungen einer Person |
| `/bewerbungen loeschen <nummer>` | Staff | Bewerbung und Team-Nachricht löschen (Mod-Log) |
| `/bewerbungen statistik` | Team | Statistik (siehe 9.) |
| `/bewerbungssperre …` | Team | Sperren (siehe 7.) |
| `/dienstnummer anzeigen [user]` | alle | eigene oder fremde Dienstnummer |
| `/dienstnummer liste` · `setzen` · `entfernen` | Team | Dienstnummern verwalten (siehe 6.7) |
| `/einstellungen bewerbung` · `bewerbungs-kanaele` | „Server verwalten“ | Einstellungen ohne Neustart |

Interaktions-IDs (Präfix `quali:`): `pick`, `apply`, `start`, `cancel`, `ans`, `skip`, `rb` (Roblox bestätigen),
`decide`, `reason`/`reasonsubmit`, `status`, `history`, `ticket`, `withdraw`. Formular für die Texte: `appadmin:texts:<art>`.

---

## 12. Daten und Dateien

Gespeichert wird in `data/db.json` (keine externe Datenbank):

| Bereich | Inhalt |
|---|---|
| `apps[guildId][nummer]` | Bewerbung: Art, Status, Antworten (`[{ key, question, type, answer, ms, cpm }]`), Discord, Roblox, Dauer, Server-Beitritt, gewählte Rollen, KI-Ergebnis, Entscheider/Zeitpunkt/Grund, Verlauf, Team-Nachricht/Thread, Version |
| `appBans[guildId][id]` | Sperren: Discord-ID, Roblox-ID/-Name, Bereiche, Grund, Ablauf, aufgehoben |
| `appProgress[guildId]` | angefangene Bewerbungen („in Bearbeitung“) |
| `appSessions[userId]` | laufende DM-Bewerbungen (überstehen einen Neustart) |
| `appTypes[guildId]` | selbst erstellte Bewerbungen des Servers |
| `serviceNumbers[guildId][userId]` | vergebene Dienstnummern |
| `appPanels[guildId]` | gepostete Panels (zum automatischen Aktualisieren) |
| `appPanelDefs[guildId]` | Panels: Name, Überschrift, Text, Bild, enthaltene Bewerbungen |
| `appTypes[guildId]` | selbst erstellte Bewerbungen mit ihren Fragen und Texten (gelöschte mit alten Bewerbungen: `archived`) |
| `settings` | per `/einstellungen` geänderte Werte |

| Datei | Inhalt |
|---|---|
| `src/lib/applications/store.js` | Status, Datensätze, Prüfungen, Sperren, „in Bearbeitung“ |
| `src/lib/applications/flow.js` | DM-Ablauf, Einreichen |
| `src/lib/applications/decide.js` | Entscheidungen, Statusschritte, Rückzug, Verlauf, Ticket, Verlassen |
| `src/lib/applications/messages.js` | Panels und Team-Nachricht |
| `src/lib/applications/forms.js` | Fragetypen, Prüfung, Texte/Variablen, Konfigurationsprüfung |
| `src/lib/applications/aiCheck.js` | KI-Checker |
| `src/lib/applications/stats.js` | Statistik |
| `src/lib/applications/roblox.js` | Roblox-Suche |
| `src/lib/applications/roles.js` | Rollen geben/nehmen |
| `src/lib/applications/normalize.js` | Standardwerte (`defaults`) auf alle Arten anwenden |
| `src/lib/applications/manage.js` | Bewerbungen und Fragen anlegen, ändern, löschen |
| `src/lib/applications/legacyTypes.json` | die früher eingebauten Bewerbungen – nur für das Update älterer Server |
| `src/commands/applications/` | `/bewerbung`, `/bewerbung-verwalten`, `/bewerbungspanel`, `/bewerbungen`, `/bewerbungssperre` |
| `src/lib/applications/panels.js` | Panels anlegen, ändern, löschen; Übernahme der alten festen Panels |
| `src/lib/applications/discordOverview.js` | Übersicht mit Buttons in Discord (`dash:`) |
| `src/lib/applications/dashboard.js` | Daten und Aktionen für das Dashboard der Plattform |

---

## 13. Nicht enthalten

Diese Teile der Web-Version fehlen oder sind durch Discord-Funktionen ersetzt:

| Web-Version | Hier |
|---|---|
| Browser-Formular mit signiertem Link (`mode: 'WEB'`) | nicht enthalten – nur Fragen per DM |
| öffentliche Seite `/apply` ohne Discord | nicht enthalten |
| Dashboard (Liste, Einrichtung, Statistik, Sperren) | Dashboard der Plattform (Altmodule → Bewerbungen) |
| Rechte-System mit Konten (`applications.decide` …) | Staff + Manager-Rollen je Bewerbung |
| Benachrichtigungen und Audit-Log im Dashboard | Team-Kanal, Team-Thread, Mod-Log (Dashboard-Aktionen werden dort auch gemeldet) |
| Team-Chance (Bewerbungsphasen) | enthalten: `/bewerbung-verwalten phase` (siehe 6.6) |
| Personal-/Dienstnummern-Automatik | enthalten: `/bewerbung-verwalten dienstnummer`, `/dienstnummer` (siehe 6.7) |
| SEK-Mitgliedschaft über verknüpftes Konto | Rolle per `acceptAdd` |
| Einstellungen je Discord-Server (`…@guildId`) | enthalten: Bewerbungen, Einstellungen und Daten sind je Server getrennt |

---

## 14. Schnellstart

1. Per `/einstellungen bewerbungs-kanaele` den **Team-Kanal** für neue Bewerbungen setzen.
2. `/bewerbung-verwalten uebersicht` (oder das Dashboard) → **➕ Neue Bewerbung**, danach Fragen hinzufügen.
   Texte der DMs optional über **💬 Texte**.
3. Je Bewerbung mindestens die **Manager-Rolle** und die **Annahme-Rolle** setzen:
   `/einstellungen bewerbung art:… manager_rolle:@Ausbilder annahme_rolle:@Polizeianwärter`.
4. **🗂️ Panels** → **➕ Neues Panel** → Bewerbungen auswählen → in einen Kanal posten.
5. Eine Testbewerbung mit einem zweiten Konto durchspielen:
   - DM-Fragen beantworten
   - Bewerbung erscheint im Team-Kanal
   - Annehmen
   - DM und Rollen prüfen
6. Optional: Sperren, Wartezeit, Zeitlimit, Team-Threads, Aktion beim Verlassen.

> Hinweis: Die Abläufe sind mit nachgebauten Discord-Objekten durchgetestet, aber noch **nicht gegen echtes Discord**.
