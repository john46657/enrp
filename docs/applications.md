# Bewerbungssystem

Übersicht über das Bewerbungssystem des Bots: Bewerbungen für **alles** – Fraktionen (Polizei, Feuerwehr,
Rettungsdienst …), Server-Team (Supporter, Moderator …), Einheiten, Partnerschaften, Entbannungsanträge oder ganz eigene.
Jede Bewerbungsart lässt sich **komplett in Discord** anlegen und bearbeiten. Dazu kommen Fragen per Direktnachricht,
Entscheidungen im Team-Kanal, Sperren, KI-Checker und Statistik.

> Kurzfassung: Bewerber klicken in Discord auf ein Panel → der Bot stellt die Fragen per Direktnachricht → die Bewerbung
> landet mit Annehmen/Ablehnen-Buttons im Team-Kanal → die Entscheidung geht per DM an die Person, Rollen werden
> automatisch vergeben/entfernt.

Alles läuft in Discord. Was die Web-Version zusätzlich kann (Browser-Formular, Dashboard, …), steht unter
[13. Nicht enthalten](#13-nicht-enthalten).

---

## 1. Bewerbungsarten

Jede Bewerbungsart hat:

| Feld | Bedeutung |
|---|---|
| **ID** (`id`) | eindeutiger Schlüssel, z. B. `feuerwehr` (2–24 Zeichen `a-z0-9_-`). Darüber findest du sie in Befehlen und Sperren. |
| **Nummern-Präfix** (`numberPrefix`) | z. B. `FW` → Bewerbungsnummern `FW-0001`, `FW-0002` … Gezählt wird je Präfix und Server. |
| **Panel** (`panel`) | in welchem Panel sie erscheint (siehe 6.1) |
| **Prüfschritte** (`stages`) | eigene Zwischenschritte, z. B. „In Prüfung → Gespräch“, oder keine |
| Name, Emoji, Beschreibung, Fragen, Texte, Rollen, Kanäle, Wartezeit … | siehe 6.4 |

Statusablauf jeder Bewerbung:

```
Eingereicht → (eigene Prüfschritte, beliebig wechselbar) → Angenommen | Abgelehnt | Zurückgezogen
```

Über die Buttons **Annehmen/Ablehnen** wird aus **jedem offenen Status** direkt entschieden. Die Prüfschritte und
„Zurückziehen“ wählt das Team im Status-Menü unter der Bewerbung. Hat eine Art keine Prüfschritte, steht dort nur
„Zurückziehen“.

Wo die Bewerbungsarten herkommen:
- `config.json` unter `applications.types` ist die **Vorlage für alle Server**. Werte, die eine Art nicht selbst setzt,
  kommen aus `applications.defaults`.
- Sobald du auf einem Server mit `/bewerbungsart` etwas änderst, gilt dort die **eigene Liste dieses Servers**.
  Spätere Änderungen an den Bewerbungsarten in der `config.json` wirken dort dann nicht mehr.

> Ältere Konfigurationen mit `workflow: "police"` bekommen automatisch die Prüfschritte In Prüfung → Gespräch →
> Entscheidung ausstehend, `workflow: "simple"` keine. Bestehende Bewerbungen und Sperren laufen unverändert weiter.

---

## 1a. Bewerbungen selbst bearbeiten (`/bewerbungsart`)

Alles geht in Discord, ohne Neustart und nur für den Server, auf dem du es machst. Du brauchst „Server verwalten“.

| Befehl | Wirkung |
|---|---|
| `/bewerbungsart liste` | alle Arten nach Panels, mit ID, Präfix und Anzahl Fragen |
| `/bewerbungsart erstellen id:<id> [name] [vorlage] [kopie_von] [panel] [praefix] [emoji]` | neue Art, leer, aus einer Vorlage oder als Kopie einer vorhandenen |
| `/bewerbungsart bearbeiten art:<art>` | öffnet den Editor |
| `/bewerbungsart loeschen art:<art>` | löscht die Art (nur ohne offene Bewerbungen; alte Bewerbungen bleiben abrufbar) |

**Vorlagen:** Leer · Polizei · Feuerwehr · Rettungsdienst · Abschleppdienst · Justiz · Firma/Zivil · Einheit ·
Supporter · Moderator · Entwickler · Event-Team · Content Creator · Partnerschaft · Entbannungsantrag
(`src/lib/applications/templates.js`). Vorlagen bringen Fragen, Texte und Prüfschritte mit, aber keine Rollen oder Kanäle.

**Der Editor** ist eine private Nachricht mit Buttons:

| Button | Was du einstellst |
|---|---|
| ✏️ Name, ID & Präfix | Name, ID, Nummern-Präfix, Emoji, Beschreibung |
| 💬 Texte | Start-, Abschluss-, Annahme- und Ablehnungsnachricht |
| 🔁 Ablauf & Prüfschritte | Prüfschritte (einer je Zeile), Wartezeit, Zeitlimit, Verhalten beim Verlassen, Team-Thread |
| #️⃣ Kanäle & Panel | Panel, Kanal für neue Bewerbungen, Archiv-Kanäle für angenommene/abgelehnte |
| ❓ Fragen | Fragen hinzufügen, bearbeiten, verschieben, löschen |
| 🏷️ Rollen: Zugang / Entscheidung / Team | alle Rollen aus 6.4, direkt aus Discord auswählbar |
| 🔒 Öffnen / Schließen · ⬆️⬇️ · 🗑️ | Bewerbung annehmen oder nicht, Reihenfolge im Panel, Löschen |

**ID ändern:** Bisherige Bewerbungen, Sperren und „in Bearbeitung“ werden auf die neue ID umgestellt. Solange jemand
die Bewerbung gerade ausfüllt, geht das nicht.

**Fragen während laufender Bewerbungen ändern:** Wer schon angefangen hat, bekommt die Fragen vom Zeitpunkt des Starts.
Neue Fragen gelten ab der nächsten Bewerbung.

`/einstellungen bewerbung` gibt es weiterhin für schnelle Änderungen (aktiv, Kanäle, je eine Rolle …).
`/einstellungen zuruecksetzen` lässt selbst angelegte Bewerbungsarten und Panels stehen, außer du setzt
`bewerbungen_auch: True`.

---

## 2. Ablauf für Bewerber (Fragen per Direktnachricht)

1. Person klickt im Panel auf **Jetzt bewerben**, wählt eine Art im Auswahlmenü oder nutzt `/bewerbung [art]`
   (ohne `art` zeigt der Bot alle offenen Bewerbungen zur Auswahl).
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
3. **Keine zweite offene Bewerbung** derselben Art (je Server; bei Arten mit Roblox-Frage zusätzlich je Roblox-ID)

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
| **Status-Menü** | Prüfschritt der Art wechseln (z. B. In Prüfung, Gespräch) oder Zurückziehen |

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
- **Team:** „Zurückziehen“ im Status-Menü.

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
  (und notfalls Fragen) gekürzt, und die vollständigen Antworten hängen als `bewerbung-FW-0001.txt` an.
- **Ping:** die Ping-Rollen (`roles.ping`) werden markiert. Mit `teamThreads: true` wird zusätzlich ein Thread
  geöffnet.

Kanal für neue Bewerbungen: `channels.open` der Art. Ist er leer, gilt der **Team-Kanal ihres Panels**
(`/bewerbungspanel bearbeiten`), danach die älteren Felder `applications.channel` (Panel `apply`) bzw.
`applications.qualiChannel` (Panel `quali`).

---

## 6. Einrichtung

Einstellen kannst du per `config.json` (alles, Vorlage für alle Server) oder per `/einstellungen bewerbung` und
`/einstellungen bewerbungs-kanaele` (die wichtigsten Werte, ohne Neustart, nur für den jeweiligen Server).

### 6.1 Panels (`/bewerbungspanel`)

Ein Panel ist eine Nachricht mit Titel, Text, optionalem Bild und – je nach Anzahl der Arten – dem Button
*Jetzt bewerben* oder einem Auswahlmenü. Du kannst **beliebig viele** anlegen, z. B. „Fraktionen“, „Server-Team“,
„Einheiten“. Mitgeliefert sind `apply` (Bewerbung) und `quali` (Einheiten & Qualifikationen).

| Befehl | Wirkung |
|---|---|
| `/bewerbungspanel posten [panel]` | Panel in den aktuellen Kanal posten |
| `/bewerbungspanel erstellen id:<id> [titel]` | neues Panel |
| `/bewerbungspanel bearbeiten panel:<panel>` | Formular: Titel, Beschreibung, Bild, Text im Auswahlmenü, Team-Kanal |
| `/bewerbungspanel bearbeiten panel:<panel> liste_anzeigen:<ja/nein>` | Arten mit Beschreibung im Panel auflisten |
| `/bewerbungspanel loeschen panel:<panel> [verschieben_nach]` | Panel löschen, Arten in ein anderes verschieben |
| `/bewerbungspanel liste` | alle Panels mit ihren Arten |

Felder in `config.json` (`applications.panels.<id>`): `title`, `description`, `image`, `placeholder`, `channel`,
`showList`. Gepostete Panels aktualisieren sich beim Bot-Start und nach jeder Änderung automatisch.
`/qualipanel` postet weiterhin das Panel `quali`.

### 6.2 Bewerbungsarten in der `config.json`
`id`, `name`, `emoji`, `description`, `panel`, `numberPrefix`, `stages` (`[{ "id": "SCREENING", "label": "In Prüfung" }]`),
Fragen (max. 50) und alle Einstellungen aus 6.4. Mitgeliefert: Polizei, SEK, Flugstaffel, Ausbilder.
Bequemer geht es mit `/bewerbungsart` (siehe 1a).

### 6.3 Fragen
```json
{ "key": "motivation", "type": "TEXT", "label": "Warum möchtest du zur Polizei?", "required": true, "min": 50, "max": 1000 }
```

| `type` | Beschreibung |
|---|---|
| `TEXT` | Freitext; `required`, `min`, `max` (bis 5000) |
| `CHOICE` | Auswahl aus `options` (max. 25, `{ "label": "Täglich" }`); `multiple` für Mehrfachauswahl |
| `ROLE` | wie CHOICE, aber jede Option hat `roleId`. Die gewählten Rollen werden **bei Annahme** vergeben |
| `ROBLOX` | Roblox-Benutzer: wird bei Roblox gesucht und muss bestätigt werden |

Optional ist bei jeder Frage `description` (Zusatztext unter der Frage). Im Editor legst du Auswahl-Optionen als eine
Zeile je Option an (optional `Name | Beschreibung`), Rollen-Optionen wählst du direkt aus den Server-Rollen.

### 6.4 Einstellungen je Bewerbung

**Grundlegendes:** `enabled`, `name` (`{applicationName}`), `numberPrefix`, `panel`, `stages`,
`channels.open` / `accepted` / `rejected`.

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
  - Bereich: alle Bewerbungen oder eine bestimmte Bewerbungsart.
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
| „Server verwalten“ | `/bewerbungsart`, `/bewerbungspanel`, `/qualipanel`, `/einstellungen` |

---

## 11. Discord-Befehle

| Befehl | Wer | Wirkung |
|---|---|---|
| `/bewerbung [art]` | alle | Bewerbung starten (ohne `art`: Auswahl aller offenen) |
| `/bewerbungsart liste · erstellen · bearbeiten · loeschen` | „Server verwalten“ | Bewerbungsarten verwalten (siehe 1a) |
| `/bewerbungspanel posten · erstellen · bearbeiten · loeschen · liste` | „Server verwalten“ | Panels verwalten (siehe 6.1) |
| `/qualipanel` | „Server verwalten“ | Panel `quali` in den Kanal posten |
| `/bewerbungen offen [art]` | Team | offene Bewerbungen mit Links |
| `/bewerbungen in-bearbeitung` | Team | gerade laufende DM-Bewerbungen |
| `/bewerbungen anzeigen <nummer>` | Team | Bewerbung mit allen Antworten (auch als `.txt`) |
| `/bewerbungen verlauf <user>` | Team | alle Bewerbungen einer Person |
| `/bewerbungen loeschen <nummer>` | Staff | Bewerbung und Team-Nachricht löschen (Mod-Log) |
| `/bewerbungen statistik` | Team | Statistik (siehe 9.) |
| `/bewerbungssperre …` | Team | Sperren (siehe 7.) |
| `/einstellungen bewerbung` · `bewerbungs-kanaele` | „Server verwalten“ | Einstellungen ohne Neustart |

Alle Befehle mit `art` oder `panel` schlagen die Arten und Panels **dieses Servers** vor (Autovervollständigung).

Interaktions-IDs (Präfix `quali:`): `pick`, `apply`, `start`, `cancel`, `ans`, `skip`, `rb` (Roblox bestätigen),
`decide`, `reason`/`reasonsubmit`, `status`, `history`, `ticket`, `withdraw`. Editor: Präfix `appedit:`,
Panel-Formular: `apppanel:`.

---

## 12. Daten und Dateien

Gespeichert wird in `data/db.json` (keine externe Datenbank):

| Bereich | Inhalt |
|---|---|
| `apps[guildId][nummer]` | Bewerbung: Art, Status, Antworten (`[{ key, question, type, answer, ms, cpm }]`), Discord, Roblox, Dauer, Server-Beitritt, gewählte Rollen, KI-Ergebnis, Entscheider/Zeitpunkt/Grund, Verlauf, Team-Nachricht/Thread, Version |
| `appBans[guildId][id]` | Sperren: Discord-ID, Roblox-ID/-Name, Bereiche, Grund, Ablauf, aufgehoben |
| `appProgress[guildId]` | angefangene Bewerbungen („in Bearbeitung“) |
| `appPanels[guildId]` | gepostete Panels (zum automatischen Aktualisieren) |
| `settings` | per `/einstellungen`, `/bewerbungsart` und `/bewerbungspanel` geänderte Werte (je Server; eigene Arten unter `applications.types`, Panels unter `applications.panels`) |

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
| `src/lib/applications/normalize.js` | Standardwerte (`defaults`) auf alle Arten und Panels anwenden, ältere `workflow`-Angaben umsetzen |
| `src/lib/applications/admin.js` | Arten und Panels anlegen, ändern, umbenennen, löschen (mit Prüfung) |
| `src/lib/applications/templates.js` | Vorlagen für neue Arten |
| `src/lib/applications/autocomplete.js` | Autovervollständigung für Arten und Panels |
| `src/commands/applications/` | `/bewerbung`, `/bewerbungsart` (Editor), `/bewerbungspanel`, `/qualipanel`, `/bewerbungen`, `/bewerbungssperre` |

---

## 13. Nicht enthalten

Diese Teile der Web-Version brauchen einen Webserver mit Datenbank und Login. Der Bot hat keinen, deshalb fehlen sie
oder sind durch Discord-Funktionen ersetzt:

| Web-Version | Hier |
|---|---|
| Browser-Formular mit signiertem Link (`mode: 'WEB'`) | nicht enthalten – nur Fragen per DM |
| öffentliche Seite `/apply` ohne Discord | nicht enthalten |
| Dashboard (Liste, Einrichtung, Statistik, Sperren) | `/bewerbungsart`, `/bewerbungspanel`, `/bewerbungen`, `/bewerbungssperre` – ein Web-Dashboard ist geplant |
| Rechte-System mit Konten (`applications.decide` …) | Staff + Manager-Rollen je Bewerbung |
| Benachrichtigungen und Audit-Log im Dashboard | Team-Kanal, Team-Thread, Mod-Log |
| Team-Chance (Bewerbungsphasen) | nicht enthalten – `enabled` per `/einstellungen bewerbung` umschalten |
| Personal-/Dienstnummern-Automatik | nicht enthalten |
| SEK-Mitgliedschaft über verknüpftes Konto | Rolle per `acceptAdd` |

---

## 14. Schnellstart

1. Panel anlegen (oder die mitgelieferten `apply`/`quali` nutzen):
   `/bewerbungspanel erstellen id:fraktionen titel:🚓 Fraktionen`, danach mit `/bewerbungspanel bearbeiten` den
   **Team-Kanal** setzen.
2. Bewerbungsart anlegen:
   `/bewerbungsart erstellen id:feuerwehr vorlage:Fraktion: Feuerwehr panel:fraktionen`
3. Im Editor mindestens **Rollen: Team → Manager** und **Rollen: Entscheidung → Bei Annahme geben** setzen, Fragen
   und Texte prüfen.
4. Im Panel-Kanal `/bewerbungspanel posten panel:fraktionen` ausführen.
5. Eine Testbewerbung mit einem zweiten Konto durchspielen:
   - DM-Fragen beantworten
   - Bewerbung erscheint im Team-Kanal
   - Annehmen
   - DM und Rollen prüfen
6. Optional: Sperren, Wartezeit, Zeitlimit, Prüfschritte, Team-Threads, Aktion beim Verlassen.

> Hinweis: Die Abläufe und der Editor sind mit nachgebauten Discord-Objekten durchgetestet (`npm run check`), aber
> noch **nicht gegen echtes Discord**. Der Editor nutzt Auswahlmenüs in Formularen (Rollen, Kanäle). Die zeigen nur
> aktuelle Discord-Apps an.
