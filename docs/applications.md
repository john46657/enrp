# Bewerbungssystem

Übersicht über das Bewerbungssystem des Bots: Polizei-Bewerbung, Bewerbungen für Einheiten/Qualifikationen
(SEK, Flugstaffel, Ausbilder …), Fragen per Direktnachricht, Entscheidungen im Team-Kanal, Sperren, KI-Checker und Statistik.

> Kurzfassung: Bewerber klicken in Discord auf ein Panel → der Bot stellt die Fragen per Direktnachricht → die Bewerbung
> landet mit Annehmen/Ablehnen-Buttons im Team-Kanal → die Entscheidung geht per DM an die Person, Rollen werden
> automatisch vergeben/entfernt.

Alles läuft in Discord. Zusätzlich gibt es einen optionalen Web-Teil mit Browser-Formular und Dashboard
([6.8](#68-web-teil-browser-formular-und-dashboard)). Den Vergleich mit der Web-Version findest du unter
[13. Vergleich mit der Web-Version](#13-vergleich-mit-der-web-version).

---

## 1. Bewerbungsarten

Alle Bewerbungsarten stehen in `config.json` unter `applications.types` (Vorlage für alle Server). Werte, die eine Art
nicht selbst setzt, kommen aus `applications.defaults`. Jeder Server kann mit `/bewerbungsart` eigene Arten anlegen und
die vorhandenen ändern ([6.5](#65-in-discord-bearbeiten-bewerbungsart)).

| Art | `workflow` | Nummer | Statusablauf |
|---|---|---|---|
| **Polizei-Bewerbung** | `police` | `APP-0001` | `SUBMITTED → SCREENING → INTERVIEW → PENDING_DECISION → ACCEPTED \| REJECTED \| WITHDRAWN` |
| **Einheit / Qualifikation** (SEK, Flugstaffel, Ausbilder, eigene) | `simple` | `Q-0001` | `OPEN → ACCEPTED \| REJECTED \| WITHDRAWN` |

Das Präfix der Nummer legt `numberPrefix` fest. Gezählt wird je Präfix und Server.

Mit `panel` bestimmst du, wo eine Art erscheint: im **Bewerbungs-Panel** (`apply`, z. B. Polizei) oder im
**Qualifikations-Panel** (`quali`, Standard).

Erlaubte Statuswechsel der Polizei-Bewerbung (`POLICE_TRANSITIONS` in `src/lib/applications/store.js`):

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
   - Ist die Bewerbung aktiviert (`enabled`) und läuft die **Bewerbungsphase** ([6.6](#66-bewerbungsphasen-team-chance))?
   - **Rollen-Voraussetzungen**: *erforderliche* Rollen (`requiredMode`: `all` oder `any`) und *gesperrte* Rollen
     (`blockedMode`)
   - **Bewerbungssperre** (siehe 7.)
   - Gibt es schon eine **offene Bewerbung** derselben Art auf diesem Server?
   - Ist die **Wartezeit** (`cooldownMinutes`) seit der letzten Bewerbung dieser Art vorbei?
   Steht die Art auf Browser-Formular (`mode: "WEB"`) und läuft der Web-Teil, bekommt die Person stattdessen einen
   persönlichen Link ([6.8](#68-web-teil-browser-formular-und-dashboard)) und die Schritte 3–5 entfallen.
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

> Laufende DM-Bewerbungen liegen in `data/db.json` und überstehen einen Neustart: Der Bot meldet sich danach per DM
> und stellt die aktuelle Frage noch einmal. Ändert das Team währenddessen die Fragen, wird die Bewerbung abgebrochen
> und die Person gebeten, neu zu starten.

---

## 3. Prüfungen beim Einreichen

`submitApplication()` in `src/lib/applications/flow.js` (für DM und Browser-Formular) wiederholt alle Prüfungen vom Start, weil sich in der Zwischenzeit etwas
geändert haben kann (Rolle verloren, gesperrt, Bewerbung geschlossen). Dazu kommen:

1. Jede Antwort gegen ihre Frage (`checkAnswer()` in `src/lib/applications/forms.js`): Pflichtfeld, Länge, gültige
   Auswahl, gültiger Roblox-Name. Bestätigte Roblox-Konten werden als `Name (ID 123)` gespeichert.
2. **Bewerbungssperre** per Discord-ID **oder** Roblox-ID
3. **Keine zweite offene Bewerbung** derselben Art (je Server; Polizei zusätzlich je Roblox-ID)

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
| **Status-Menü** (nur Polizei) | nächster Prüfschritt (In Prüfung, Gespräch, Entscheidung ausstehend) oder Zurückziehen |

**Wer klicken darf:** Staff (Rolle `roles.staff` oder „Server verwalten“) **oder** eine der **Manager-Rollen**
(`roles.managers`) dieser Bewerbung. Über die eigene Bewerbung kann niemand entscheiden. Doppelte Klicks sind
abgesichert: Wer als Zweiter klickt, sieht „bereits entschieden von …“.

### Was bei der Entscheidung passiert
- Status, Entscheider, Zeitpunkt und ggf. Grund werden gespeichert, inklusive Verlauf (`history`).
- **DM an die Person** mit dem eingestellten Annahme- oder Ablehnungstext (Variablen siehe 6.3).
- **Dienstnummer bei Annahme:** Ist die Automatik an, bekommt die Person die nächste freie Nummer
  ([6.7](#67-dienstnummern)). Sie steht in der DM, in der Team-Nachricht und optional im Nickname.
- **Rollen bei Annahme:** `acceptAdd` sowie die in ROLE-Fragen gewählten Rollen werden vergeben. `acceptRemove` und
  `pending` werden genommen.
- **Rollen bei Ablehnung:** `rejectAdd` wird vergeben. `rejectRemove` und `pending` werden genommen.
- **Team-Nachricht:** Sie wird aktualisiert (Farbe, Status, wer, Grund), die Entscheidungs-Buttons verschwinden. Bei
  aktivem Team-Thread kommt dort ein Hinweis.
- **Archiv:** Ist `channels.accepted` bzw. `channels.rejected` gesetzt, wird die Bewerbung zusätzlich dorthin gepostet.

### Zurückziehen
- **Bewerber:** Button in der Abschluss-DM.
- **Team:** „Zurückziehen“ im Status-Menü (nur Polizei).

In beiden Fällen bekommt die Person eine DM und die Rolle „ausstehend“ wird genommen.

### Person verlässt den Server
`onLeave` je Bewerbungsart: `NONE` (nichts), `DENY` (automatisch ablehnen) oder `WITHDRAW` (zurückziehen, Standard).
Grund: „Hat den Discord-Server verlassen.“ Eine laufende DM-Bewerbung wird abgebrochen und die Dienstnummer wieder
frei (abschaltbar). Dafür braucht der Bot den *Server Members Intent*.

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

## 6. Einrichtung

Einstellen kannst du per `config.json` (Vorlage für alle Server) oder direkt in Discord, ohne Neustart und nur für den
jeweiligen Server: `/einstellungen bewerbung` und `/einstellungen bewerbungs-kanaele` für Kanäle, Rollen und Fristen,
`/bewerbungsart` für Arten, Fragen, Texte, Rollen-Listen, Phasen und Dienstnummern.

### 6.1 Panels
- **Bewerbungs-Panel** (`applications.panels.apply`: Titel, Beschreibung, Bild): Bei einer Art erscheint der Button
  *Jetzt bewerben*, bei mehreren ein Auswahlmenü. Posten mit `/bewerbungspanel`.
- **Qualifikations-Panel** (`applications.panels.quali`): Beschreibung jeder Einheit plus Auswahlmenü. Posten mit
  `/qualipanel`.
- Gepostete Panels aktualisieren sich automatisch: beim Bot-Start, nach Änderungen in Discord und wenn eine
  Bewerbungsphase öffnet, schließt oder ein Platz vergeben wird.

### 6.2 Bewerbungsarten
`id` (Schlüssel, `a-z0-9_-`, 2–24 Zeichen), `name`, `emoji`, `description`, `panel`, `workflow`, `numberPrefix`,
Fragen (max. 50) und alle Einstellungen aus 6.4. Mitgeliefert: Polizei, SEK, Flugstaffel, Ausbilder.

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

Optional ist bei jeder Frage `description` (Zusatztext unter der Frage). Mitgelieferte Polizei-Fragen: Roblox-Name,
Erfahrung im Polizei-RP, Aktivität, Motivation, gutes Roleplay, ER:LC-Kenntnisse, Umgang mit Konflikten.

### 6.4 Einstellungen je Bewerbung

**Grundlegendes:** `enabled`, `name` (`{applicationName}`), `channels.open` / `accepted` / `rejected`.

**Texte** (`messages.start`, `finish`, `accept`, `reject`), mit den Variablen
`{applicationName}`, `{user}` = Entscheider, `{applicant}`, `{number}`, `{reason}`, `{questionCount}`, `{timeLimit}`
und `{serviceNumber}`. Fehlt `{reason}` bzw. `{serviceNumber}` im Text, wird ein vorhandener Grund bzw. die vergebene
Dienstnummer automatisch angehängt. In Discord bearbeitest du die Texte mit `/bewerbungsart texte`.

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
| `mode` | `DM` (Fragen per Direktnachricht, Standard) oder `WEB` (Browser-Formular, siehe 6.8) |
| `phase` | Bewerbungsphase: `opensAt`, `closesAt`, `maxApplications` (siehe 6.6) |
| `serviceNumber` | Dienstnummer-Automatik (siehe 6.7) |

`npm run check` und der Bot-Start prüfen die Bewerbungsarten und melden Fehler wie doppelte Schlüssel, fehlende
Optionen oder ungültige Werte. Änderungen über `/bewerbungsart` werden vor dem Speichern genauso geprüft.

### 6.5 In Discord bearbeiten (`/bewerbungsart`)

Nur mit „Server verwalten“. Alles gilt sofort und nur für den Server, auf dem du es änderst.

| Unterbefehl | Wirkung |
|---|---|
| `erstellen` | neue Art mit Schlüssel, Name, Emoji, Beschreibung, Panel, Ablauf und Nummern-Präfix |
| `bearbeiten` | Name, Emoji, Beschreibung, Ablauf, Präfix, Formular (Direktnachricht oder Browser) |
| `loeschen` | Art entfernen. Geht nur ohne offene Bewerbungen; entschiedene bleiben in Verlauf und Statistik |
| `anzeigen` | alle Einstellungen und Fragen einer Art |
| `texte` | Start-, Abschluss-, Annahme- und Ablehnungstext in einem Formular |
| `frage-hinzufuegen` | Typ, Text, Pflicht, Mindest-/Höchstlänge, Optionen, Mehrfachauswahl, Hinweis, Position |
| `frage-bearbeiten` · `frage-entfernen` · `frage-verschieben` | Frage über ihre Nummer ändern |
| `rollen` | Rolle zu einer Rollen-Liste hinzufügen, entfernen oder die Liste leeren (alle Listen aus 6.4), dazu `requiredMode`/`blockedMode` |
| `phase` | Bewerbungsphase (siehe 6.6) |
| `dienstnummer` | Dienstnummer-Automatik (siehe 6.7) |

Optionen einer Auswahl-Frage schreibst du als `Täglich; Mehrmals pro Woche; Selten`, bei einer Rollen-Auswahl als
`Streife = @Rolle; SEK = @Rolle`. Der Schlüssel (`key`) einer Frage entsteht automatisch aus ihrem Text.

Wer gerade eine Bewerbung ausfüllt, deren Fragen geändert werden, bekommt eine DM und muss neu starten.

> Sobald du auf einem Server eine Art anlegst oder löschst, hat dieser Server seine eigene Liste der Arten. Spätere
> Änderungen an `applications.types` in der `config.json` kommen dort nicht mehr an.
> `/einstellungen zuruecksetzen` stellt die Vorlage wieder her.

### 6.6 Bewerbungsphasen (Team-Chance)

Mit `/bewerbungsart phase` (oder `phase` in der `config.json`) öffnet und schließt eine Bewerbung von selbst:

| Option | Feld | Bedeutung |
|---|---|---|
| `oeffnet` | `phase.opensAt` | ab wann Bewerbungen möglich sind, z. B. `24.12.2026 18:00` (deutsche Zeit) |
| `schliesst` | `phase.closesAt` | ab wann nicht mehr |
| `plaetze` | `phase.maxApplications` | höchstens so viele Bewerbungen in dieser Phase, `0` = unbegrenzt |

`-` leert ein Datum. In der `config.json` schreibst du Zeitpunkte als ISO-Text, z. B. `"2026-12-24T18:00:00+01:00"`.
Das Panel zeigt den Zustand („öffnet in 2 Tagen“, „offen bis …“, „3 von 10 Plätzen frei“, „geschlossen“) und
aktualisiert sich innerhalb einer Minute, wenn sich etwas ändert. Gezählt werden die Bewerbungen seit `opensAt`.
`enabled: false` schließt eine Art unabhängig von der Phase.

### 6.7 Dienstnummern

Mit `/bewerbungsart dienstnummer` (oder `serviceNumber` in der `config.json`) vergibt der Bot bei Annahme automatisch
die kleinste freie Nummer:

| Option | Feld | Bedeutung |
|---|---|---|
| `aktiv` | `enabled` | Automatik an/aus |
| `format` | `format` | z. B. `PD-{n}`; `{n}` ist die Nummer |
| `stellen` | `digits` | Stellen der Nummer, `2` → `07` |
| `start` / `ende` | `start` / `end` | Bereich, `ende: 0` = offen |
| `nickname` | `nickname` | Nickname bei Vergabe, z. B. `[{serviceNumber}] {name}`; leer = nicht ändern |
| `freigeben_bei_verlassen` | `releaseOnLeave` | Nummer wieder frei, wenn die Person den Server verlässt (Standard: ja) |

`{name}` ist der bestätigte Roblox-Name, sonst der Discord-Name; es gibt auch `{roblox}` und `{username}`. Jede Person
hat je Server höchstens eine Dienstnummer und behält sie bei weiteren Annahmen. Für den Nickname braucht der Bot
„Nicknames verwalten“ und muss in der Rollen-Liste über der Person stehen; beim Server-Besitzer geht es nie.

`/dienstnummer anzeigen [user]` zeigt die eigene oder eine fremde Nummer. Das Team hat zusätzlich `liste`,
`setzen <user> [nummer] [art]` und `entfernen <user>`.

### 6.8 Web-Teil: Browser-Formular und Dashboard

Der Web-Teil ist optional und startet nur, wenn in der `.env` `WEB_URL` steht (öffentliche Adresse des Bots), dazu
`WEB_PORT` (Standard 8080) und optional `WEB_SECRET`. Er braucht keine zusätzlichen Pakete und kein eigenes Login –
der Zugang kommt immer aus Discord, als signierter Link.

**Browser-Formular** (`mode: "WEB"`, `/bewerbungsart bearbeiten formular:Im Browser`): Nach den Vorabprüfungen bekommt
die Person in Discord den Button **Formular öffnen**. Der Link gilt nur für sie und nur für die Dauer des Zeitlimits.
Alle Fragen stehen auf einer Seite, Roblox-Namen werden beim Absenden geprüft, danach laufen dieselben Prüfungen wie
bei der DM-Bewerbung. Der KI-Checker arbeitet hier ohne Tipp-Tempo. Läuft der Web-Teil nicht, kommen die Fragen per DM.

**Dashboard** (`/dashboard`, nur Team): Der Link ist 10 Minuten gültig, die Anmeldung danach 12 Stunden.

| Seite | Inhalt |
|---|---|
| Bewerbungen | Liste mit Filter (Status, Art, Suche) und Detailseite mit allen Antworten, KI-Checker und Verlauf |
| Entscheiden | Annehmen, Ablehnen, Zurückziehen und die Polizei-Zwischenschritte, mit optionalem Grund – wirkt wie die Buttons in Discord (DM, Rollen, Team-Nachricht, Dienstnummer) |
| Statistik | Kennzahlen mit Vorperiode, Eingänge je Tag, je Bewerbungsart, Top-Prüfer |
| Sperren | aktive Sperren, neue Sperre, aufheben (mit Mod-Log) |
| Dienstnummern | alle vergebenen Nummern |
| Protokoll | die letzten 200 Statusänderungen |
| Einrichtung | Zustand aller Arten; Staff kann Bewerbungen öffnen/schließen |

Es gelten dieselben Rechte wie in Discord (Staff bzw. Manager-Rollen je Art). Sie werden bei jedem Seitenaufruf
neu geprüft: Wer die Rolle verliert, ist sofort draußen. Verwende nach Möglichkeit HTTPS, sonst wird der Zugang
unverschlüsselt übertragen.

---

## 7. Bewerbungssperren (`/bewerbungssperre`)

- `hinzufuegen`: Sperrt eine Person per **Discord-Nutzer und/oder Roblox-Name** (wird bei Roblox nachgeschlagen).
  - Bereich: alle Bewerbungen, die Polizei-Bewerbung oder eine bestimmte Einheit.
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
| alle | sich bewerben (`/bewerbung`, Panels), eigene Bewerbung zurückziehen, `/dienstnummer anzeigen` |
| **Manager-Rollen** einer Art | diese Art entscheiden, Statusschritte, Verlauf, Ticket öffnen; `/bewerbungen` (außer löschen), `/bewerbungssperre`, `/dienstnummer`, `/dashboard` |
| **Staff** (`roles.staff` oder „Server verwalten“) | alles oben für alle Arten, dazu `/bewerbungen loeschen` und Öffnen/Schließen im Dashboard |
| „Server verwalten“ | `/bewerbungspanel`, `/qualipanel`, `/einstellungen`, `/bewerbungsart` |

---

## 11. Discord-Befehle

| Befehl | Wer | Wirkung |
|---|---|---|
| `/bewerbung [art]` | alle | Bewerbung starten (ohne Angabe: die Art aus dem Bewerbungs-Panel) |
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
| `/bewerbungsart …` | „Server verwalten“ | Arten, Fragen, Texte, Rollen, Phasen, Dienstnummern (siehe 6.5) |
| `/dienstnummer …` | alle / Team | Dienstnummern anzeigen und verwalten (siehe 6.7) |
| `/dashboard` | Team | persönlicher Link zum Dashboard (siehe 6.8) |

Die Option `art` schlägt die Bewerbungsarten des jeweiligen Servers vor (Autocomplete).

Interaktions-IDs (Präfix `quali:`): `pick`, `apply`, `start`, `cancel`, `ans`, `skip`, `rb` (Roblox bestätigen),
`decide`, `reason`/`reasonsubmit`, `status`, `history`, `ticket`, `withdraw`. Dazu `apptype:texts` (Formular aus
`/bewerbungsart texte`).

---

## 12. Daten und Dateien

Gespeichert wird in `data/db.json` (keine externe Datenbank):

| Bereich | Inhalt |
|---|---|
| `apps[guildId][nummer]` | Bewerbung: Art, Status, Antworten (`[{ key, question, type, answer, ms, cpm }]`), Discord, Roblox, Dauer, Server-Beitritt, gewählte Rollen, KI-Ergebnis, Entscheider/Zeitpunkt/Grund, Verlauf, Team-Nachricht/Thread, Version |
| `appBans[guildId][id]` | Sperren: Discord-ID, Roblox-ID/-Name, Bereiche, Grund, Ablauf, aufgehoben |
| `appProgress[guildId]` | angefangene Bewerbungen („in Bearbeitung“) |
| `appSessions[userId]` | laufende DM-Bewerbungen mit den bisherigen Antworten (für das Fortsetzen nach einem Neustart) |
| `serviceNumbers[guildId][userId]` | vergebene Dienstnummern |
| `webSecret` | Geheimnis für signierte Links, falls `WEB_SECRET` nicht gesetzt ist |
| `appPanels[guildId]` | gepostete Panels (zum automatischen Aktualisieren) |
| `settings[guildId]` | per `/einstellungen` und `/bewerbungsart` geänderte Werte |

| Datei | Inhalt |
|---|---|
| `src/lib/applications/store.js` | Status, Datensätze, Prüfungen, Bewerbungsphasen, Sperren, „in Bearbeitung“ |
| `src/lib/applications/flow.js` | DM-Ablauf, Einreichen |
| `src/lib/applications/decide.js` | Entscheidungen, Statusschritte, Rückzug, Verlauf, Ticket, Verlassen |
| `src/lib/applications/messages.js` | Panels und Team-Nachricht |
| `src/lib/applications/forms.js` | Fragetypen, Prüfung, Texte/Variablen, Konfigurationsprüfung |
| `src/lib/applications/aiCheck.js` | KI-Checker |
| `src/lib/applications/stats.js` | Statistik |
| `src/lib/applications/roblox.js` | Roblox-Suche |
| `src/lib/applications/roles.js` | Rollen geben/nehmen |
| `src/lib/applications/normalize.js` | Standardwerte (`defaults`) auf alle Arten anwenden |
| `src/lib/applications/serviceNumbers.js` | Dienstnummern |
| `src/lib/applications/choices.js` | Vorschläge für die Option `art` |
| `src/lib/web.js` | Adresse des Web-Teils und signierte Links |
| `src/web/` | Webserver (`server.js`), Browser-Formular (`form.js`), Dashboard (`dashboard.js`), HTML (`html.js`) |
| `src/commands/applications/` | `/bewerbung`, `/bewerbungspanel`, `/qualipanel`, `/bewerbungen`, `/bewerbungssperre`, `/bewerbungsart`, `/dienstnummer`, `/dashboard` |
| `test/` | Abläufe mit nachgebauten Discord-Objekten (`npm test`) |

---

## 13. Vergleich mit der Web-Version

| Web-Version | Hier |
|---|---|
| Browser-Formular mit signiertem Link (`mode: 'WEB'`) | ✅ enthalten, wenn der Web-Teil läuft (6.8) |
| Dashboard (Liste, Einrichtung, Statistik, Sperren) | ✅ enthalten (6.8), dazu `/bewerbungen`, `/bewerbungsart`, `/einstellungen`, `/bewerbungssperre` |
| Benachrichtigungen und Audit-Log im Dashboard | ✅ Protokoll im Dashboard; Benachrichtigungen über Team-Kanal, Team-Thread und Mod-Log |
| Team-Chance (Bewerbungsphasen) | ✅ enthalten (6.6) |
| Personal-/Dienstnummern-Automatik | ✅ enthalten (6.7) |
| Einstellungen je Discord-Server (`…@guildId`) | ✅ jeder Server hat eigene Einstellungen, Arten und Daten |
| Rechte-System mit Konten (`applications.decide` …) | bewusst anders: Staff + Manager-Rollen je Bewerbung, Anmeldung über Discord statt Konten mit Passwort |
| SEK-Mitgliedschaft über verknüpftes Konto | bewusst anders: Rolle per `acceptAdd` |
| öffentliche Seite `/apply` ohne Discord | ❌ bewusst nicht enthalten |

**Warum es keine Bewerbung ohne Discord gibt:** Ohne Anmeldung könnte jeder im Namen einer anderen Person eine
Bewerbung abschicken, und Sperren, Wartezeiten und Rollen-Voraussetzungen ließen sich umgehen. Außerdem gehen Zusage,
Absage und Rollen über das Discord-Konto. Das Browser-Formular ist deshalb immer an einen Link aus Discord gebunden.

---

## 14. Schnellstart

1. In `config.json` oder per `/einstellungen bewerbungs-kanaele` den **Bewerbungs-Kanal** und den
   **Qualifikations-Kanal** setzen.
2. Je Bewerbungsart mindestens die **Manager-Rolle** und die **Annahme-Rolle** setzen:
   `/einstellungen bewerbung art:Polizei-Bewerbung manager_rolle:@Ausbilder annahme_rolle:@Polizeianwärter`.
   Fragen und Texte passt du in der `config.json` an.
3. Im Panel-Kanal `/bewerbungspanel` bzw. `/qualipanel` ausführen.
4. Eine Testbewerbung mit einem zweiten Konto durchspielen:
   - DM-Fragen beantworten
   - Bewerbung erscheint im Team-Kanal
   - Annehmen
   - DM und Rollen prüfen
5. Optional: Sperren, Wartezeit, Zeitlimit, Team-Threads, Aktion beim Verlassen, Bewerbungsphase, Dienstnummern,
   Browser-Formular und Dashboard.

> Hinweis: Die Abläufe sind mit nachgebauten Discord-Objekten durchgetestet (`npm test`, inklusive Browser-Formular und
> Dashboard über echtes HTTP), aber noch **nicht gegen echtes Discord**. Spiele deshalb Schritt 4 einmal durch.
