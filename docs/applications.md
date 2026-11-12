# Bewerbungssystem

Übersicht über das Bewerbungssystem des Bots: **eigene Bewerbungen und Fragen in Discord anlegen** (es gibt keine
vorgefertigten), Fragen per Direktnachricht, Entscheidungen im Team-Kanal, Sperren, KI-Checker und Statistik.

> Kurzfassung: Bewerber klicken in Discord auf ein Panel → der Bot stellt die Fragen per Direktnachricht → die Bewerbung
> landet mit Annehmen/Ablehnen-Buttons im Team-Kanal → die Entscheidung geht per DM an die Person, Rollen werden
> automatisch vergeben/entfernt.

Alles läuft in Discord. Was die Web-Version zusätzlich kann (Browser-Formular, Dashboard, …), steht unter
[13. Nicht enthalten](#13-nicht-enthalten).

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

Mit `panel` bestimmst du, wo eine Bewerbung erscheint: im **Bewerbungs-Panel** (`apply`, Standard) oder im
**Qualifikations-Panel** (`quali`, z. B. für Einheiten).

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

> Laufende DM-Bewerbungen liegen im Speicher des Bots. Ein Neustart bricht sie ab, die Anzeige „in Bearbeitung“
> wird beim Start geleert.

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

Kanal für neue Bewerbungen: `channels.open` der Art. Ist er leer, gilt bei Arten im Bewerbungs-Panel
`applications.channel`, sonst `applications.qualiChannel`.

---

## 6. Bewerbungen selbst erstellen (`/bewerbung-verwalten`)

Alles in Discord, ohne Neustart und nur für den jeweiligen Server. Dafür braucht man „Server verwalten“.
Bei `art` schlägt Discord beim Tippen die Bewerbungen des Servers vor.

| Unterbefehl | Wirkung |
|---|---|
| `liste` | alle Bewerbungen mit Status, Anzahl Fragen, Panel, Ablauf und Nummer |
| `erstellen name [emoji] [beschreibung] [panel] [ablauf] [kuerzel]` | neue Bewerbung anlegen |
| `bearbeiten art …` | dieselben Felder ändern (nur angegebene; `beschreibung:-` leert) |
| `loeschen art bestaetigen` | löschen. Gibt es noch offene Bewerbungen oder füllt sie gerade jemand aus, geht das nicht. Alte Bewerbungen bleiben mit `/bewerbungen` lesbar |
| `texte art` | Formular für die vier DM-Texte (Start, Einreichen, Annahme, Ablehnung). Leer = Standardtext |
| `fragen art` | alle Fragen mit Nummer, Typ und Einstellungen |
| `frage-hinzufuegen art typ frage [hinweis] [pflicht] [min_zeichen] [max_zeichen] [optionen] [mehrfach] [position]` | Frage hinzufügen (Standard: Pflicht, ans Ende) |
| `frage-bearbeiten art nummer …` | Frage ändern (nur angegebene Optionen) |
| `frage-entfernen art nummer` | Frage entfernen |
| `frage-verschieben art nummer position` | Reihenfolge ändern |

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
/bewerbungspanel
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
- **Bewerbungs-Panel** (`applications.panels.apply`: Titel, Beschreibung, Bild): Bei einer Art erscheint der Button
  *Jetzt bewerben*, bei mehreren ein Auswahlmenü. Posten mit `/bewerbungspanel`.
- **Qualifikations-Panel** (`applications.panels.quali`): Beschreibung jeder Einheit plus Auswahlmenü. Posten mit
  `/qualipanel`.
- Gepostete Panels aktualisieren sich beim Bot-Start, nach `/einstellungen bewerbung` und nach `/bewerbung-verwalten`
  automatisch.

### 6.2 Aufbau einer Bewerbung
So speichert der Bot eine Bewerbung (in `data/db.json` unter `appTypes`): `id` (wird aus dem Namen gebildet, `a-z0-9_-`,
2–24 Zeichen), `name`, `emoji`, `description`, `panel`, `workflow`, `numberPrefix`, `questions` (max. 50) und alle
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
| „Server verwalten“ | `/bewerbungspanel`, `/qualipanel`, `/einstellungen` |

---

## 11. Discord-Befehle

| Befehl | Wer | Wirkung |
|---|---|---|
| `/bewerbung [art]` | alle | Bewerbung starten (Standard: die erste im Bewerbungs-Panel) |
| `/bewerbung-verwalten …` | „Server verwalten“ | Bewerbungen und Fragen anlegen, ändern, löschen (siehe 6.) |
| `/bewerbungspanel` | „Server verwalten“ | Bewerbungs-Panel in den Kanal posten |
| `/qualipanel` | „Server verwalten“ | Qualifikations-Panel in den Kanal posten |
| `/bewerbungen offen [art]` | Team | offene Bewerbungen mit Links |
| `/bewerbungen in-bearbeitung` | Team | gerade laufende DM-Bewerbungen |
| `/bewerbungen anzeigen <nummer>` | Team | Bewerbung mit allen Antworten (auch als `.txt`) |
| `/bewerbungen verlauf <user>` | Team | alle Bewerbungen einer Person |
| `/bewerbungen loeschen <nummer>` | Staff | Bewerbung und Team-Nachricht löschen (Mod-Log) |
| `/bewerbungen statistik` | Team | Statistik (siehe 9.) |
| `/bewerbungssperre …` | Team | Sperren (siehe 7.) |
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
| `appPanels[guildId]` | gepostete Panels (zum automatischen Aktualisieren) |
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
| `src/commands/applications/` | `/bewerbung`, `/bewerbung-verwalten`, `/bewerbungspanel`, `/qualipanel`, `/bewerbungen`, `/bewerbungssperre` |

---

## 13. Nicht enthalten

Diese Teile der Web-Version brauchen einen Webserver mit Datenbank und Login. Der Bot hat keinen, deshalb fehlen sie
oder sind durch Discord-Funktionen ersetzt:

| Web-Version | Hier |
|---|---|
| Browser-Formular mit signiertem Link (`mode: 'WEB'`) | nicht enthalten – nur Fragen per DM |
| öffentliche Seite `/apply` ohne Discord | nicht enthalten |
| Dashboard (Liste, Einrichtung, Statistik, Sperren) | `/bewerbungen`, `/bewerbung-verwalten`, `/einstellungen`, `/bewerbungssperre` |
| Rechte-System mit Konten (`applications.decide` …) | Staff + Manager-Rollen je Bewerbung |
| Benachrichtigungen und Audit-Log im Dashboard | Team-Kanal, Team-Thread, Mod-Log |
| Team-Chance (Bewerbungsphasen) | nicht enthalten – `enabled` per `/einstellungen bewerbung` umschalten |
| Personal-/Dienstnummern-Automatik | nicht enthalten |
| SEK-Mitgliedschaft über verknüpftes Konto | Rolle per `acceptAdd` |
| Einstellungen je Discord-Server (`…@guildId`) | enthalten: Bewerbungen, Einstellungen und Daten sind je Server getrennt |

---

## 14. Schnellstart

1. In `config.json` oder per `/einstellungen bewerbungs-kanaele` den **Bewerbungs-Kanal** und den
   **Qualifikations-Kanal** setzen.
2. Bewerbung anlegen und Fragen hinzufügen: `/bewerbung-verwalten erstellen name:…`, dann
   `/bewerbung-verwalten frage-hinzufuegen` für jede Frage (Beispiel in [6.](#6-bewerbungen-selbst-erstellen-bewerbung-verwalten)).
   Texte der DMs optional mit `/bewerbung-verwalten texte`.
3. Je Bewerbung mindestens die **Manager-Rolle** und die **Annahme-Rolle** setzen:
   `/einstellungen bewerbung art:… manager_rolle:@Ausbilder annahme_rolle:@Polizeianwärter`.
4. Im Panel-Kanal `/bewerbungspanel` bzw. `/qualipanel` ausführen.
5. Eine Testbewerbung mit einem zweiten Konto durchspielen:
   - DM-Fragen beantworten
   - Bewerbung erscheint im Team-Kanal
   - Annehmen
   - DM und Rollen prüfen
6. Optional: Sperren, Wartezeit, Zeitlimit, Team-Threads, Aktion beim Verlassen.

> Hinweis: Die Abläufe sind mit nachgebauten Discord-Objekten durchgetestet, aber noch **nicht gegen echtes Discord**.
