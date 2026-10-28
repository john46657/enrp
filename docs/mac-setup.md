# Emden Network auf dem Mac einrichten

Diese Anleitung ist für Einsteiger. Du brauchst dafür kein Vorwissen.
Alles, was du eingeben sollst, steht in grauen Kästen. Du kannst es kopieren (⌘ + C) und im Terminal
einfügen (⌘ + V). Danach drückst du die **Eingabetaste** (↩).

> **Sicherheit vorab:** Du gibst dein Mac-Passwort nur in Fenster von macOS selbst ein (zum Beispiel bei
> einer Installation), niemals in einen Chat. Passwörter, API-Schlüssel und Discord-Tokens kopierst du
> nie in den Chat mit Claude. Sie gehören ausschließlich in die Datei `.env` auf deinem Mac.

## 1. Terminal öffnen

1. Drücke **⌘ + Leertaste** (Spotlight).
2. Tippe `Terminal` und drücke ↩.

Es öffnet sich ein Fenster mit einer Zeile wie `deinname@MacBook ~ %`. Das `%` bedeutet:
„Ich warte auf einen Befehl.“ Das `~` steht für deinen Benutzerordner (zum Beispiel `/Users/deinname`).

## 2. Mac prüfen

Kopiere diesen ganzen Block ins Terminal und drücke ↩:

```bash
pwd
sw_vers
uname -m
xcode-select -p
git --version
node -v
npm -v
claude --version
ls -d "/Applications/Visual Studio Code.app"
ls -la ~/EmdenNetwork
```

Was die Befehle tun:

| Befehl                                         | Bedeutung                                                           | So sieht „vorhanden“ aus                                                                                                    | So sieht „fehlt“ aus                                                     |
| ---------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `pwd`                                          | Zeigt, in welchem Ordner du gerade bist („print working directory“) | `/Users/deinname`                                                                                                           | –                                                                        |
| `sw_vers`                                      | Zeigt deine macOS-Version                                           | `ProductVersion: …`                                                                                                         | –                                                                        |
| `uname -m`                                     | Prozessor: `arm64` = Apple Silicon (M1, M2 …), `x86_64` = Intel     | `arm64`                                                                                                                     | –                                                                        |
| `xcode-select -p`                              | Prüft die „Command Line Tools“ von Apple (enthalten Git)            | ein Pfad wie `/Library/Developer/CommandLineTools` (oder `/Applications/Xcode.app/…`, wenn das volle Xcode installiert ist) | eine Meldung mit `error` oder ein Installationsfenster                   |
| `git --version`                                | Versionsverwaltung Git                                              | `git version 2.…`                                                                                                           | `command not found` oder ein Installationsfenster                        |
| `node -v`                                      | Node.js, führt das Projekt aus                                      | `v24.…` oder `v22.12` und höher                                                                                             | `zsh: command not found: node`                                           |
| `npm -v`                                       | Paketverwaltung, kommt mit Node.js                                  | `11.…` oder `10.…`                                                                                                          | `zsh: command not found: npm`                                            |
| `claude --version`                             | Claude Code im Terminal                                             | eine Versionsnummer                                                                                                         | `zsh: command not found: claude`                                         |
| `ls -d "/Applications/Visual Studio Code.app"` | Ist VS Code im Ordner „Programme“?                                  | der Pfad wird angezeigt                                                                                                     | `No such file or directory`                                              |
| `ls -la ~/EmdenNetwork`                        | Gibt es den Projektordner schon, und was liegt darin?               | eine Dateiliste                                                                                                             | `No such file or directory` (dann ist alles in Ordnung, siehe Schritt 4) |

> **Tipp:** Du kannst mir die komplette Ausgabe dieser Befehle in den Chat kopieren. Sie enthält keine
> Passwörter. Dann erkläre ich dir genau, was bei dir fehlt.

## 3. Fehlendes installieren

Installiere nur, was in Schritt 2 gefehlt hat, und zwar in dieser Reihenfolge.

### 3a. Apple Command Line Tools (enthalten Git)

```bash
xcode-select --install
```

Es erscheint ein Fenster von macOS. Klicke auf **Installieren** und bestätige die Lizenz. Das dauert je
nach Internetverbindung einige Minuten. Danach prüfst du:

```bash
git --version
```

Hinweis: Wenn bei `git --version` ein Installationsfenster aufgeht, ist das genau dieses Werkzeug. Du kannst
es dann direkt dort installieren. Eine separate Git-Installation von https://git-scm.com/ ist nicht nötig.

### 3b. Node.js (enthält npm)

1. Öffne https://nodejs.org/
2. Lade die Version mit der Bezeichnung **LTS** herunter, den **macOS-Installer (.pkg)**. Das Projekt
   braucht mindestens Node.js 22.12 und ist mit Node.js 22 und 24 (aktuelle LTS) getestet.
3. Öffne die heruntergeladene Datei per Doppelklick und klicke dich durch. macOS fragt nach deinem
   Mac-Passwort. Das ist normal, weil Node.js für alle Benutzer installiert wird.
4. **Schließe das Terminal-Fenster und öffne ein neues.** Erst dann kennt es den neuen Befehl.
5. Prüfe:

```bash
node -v
npm -v
```

### 3c. Visual Studio Code (Editor, empfohlen)

1. Öffne https://code.visualstudio.com/ und lade die Mac-Version herunter.
2. Entpacke die Datei (Doppelklick) und ziehe **Visual Studio Code** in den Ordner **Programme**.
3. Optional: Damit du VS Code mit `code .` aus dem Terminal öffnen kannst, öffne VS Code, drücke
   **⌘ + ⇧ + P**, tippe `Shell Command: Install 'code' command in PATH` und wähle es aus.

### 3d. Claude Code (optional, für die Arbeit direkt auf deinem Mac)

Offizielle Anleitung: https://code.claude.com/docs/en/overview

Du hast zwei Möglichkeiten:

- **Claude-Desktop-App:** Auf der offiziellen Seite gibt es die Mac-App (Apple Silicon und Intel). Sie
  enthält Claude Code im Tab **Code**. Laut Anleitung ist dafür ein kostenpflichtiges Abo nötig.
- **Terminal-Version:** Der offizielle Installationsbefehl für macOS lautet laut der Seite oben:

  ```bash
  curl -fsSL https://claude.ai/install.sh | bash
  ```

  Das lädt ein Installationsskript von Anthropic herunter und führt es aus. Solche Befehle solltest du nur
  von offiziellen Seiten übernehmen. Der Befehl zeigt keinen Fortschritt an, warte einfach, bis er fertig
  ist. Öffne danach **ein neues Terminal-Fenster** und prüfe mit `claude --version`.

Beim ersten Start mit `claude` führt dich Claude Code durch die Anmeldung. Laut Anleitung brauchst du ein
Claude-Abo oder ein Konto in der Anthropic Console. Dein Passwort gibst du nur auf der offiziellen
Anmeldeseite ein.

## 4. Projekt in den Ordner `~/EmdenNetwork` holen

Das Projekt liegt auf GitHub. Mit `git clone` lädst du eine Kopie davon auf deinen Mac.

**Zuerst prüfen**, ob der Ordner schon existiert:

```bash
ls -la ~/EmdenNetwork
```

- `No such file or directory`: Der Ordner existiert noch nicht. Gut, weiter mit dem nächsten Block.
- Nur die Einträge `.` und `..`: Der Ordner ist leer. Auch gut, weiter.
- **Es werden Dateien angezeigt: Stopp.** Lösche nichts. Schick mir die Liste, dann entscheiden wir
  gemeinsam, wie es weitergeht.

**Projekt herunterladen** (der Ordner wird dabei automatisch angelegt):

```bash
git clone --branch claude/emden-network-setup-ksafnr https://github.com/john46657/enrp.git ~/EmdenNetwork
cd ~/EmdenNetwork
pwd
```

Was passiert dabei:

- `git clone … ~/EmdenNetwork` lädt das Projekt von GitHub in den Ordner `EmdenNetwork` in deinem
  Benutzerordner. `--branch …` wählt den Entwicklungszweig, auf dem Phase 1 liegt.
- `cd ~/EmdenNetwork` („change directory“) wechselt in diesen Ordner.
- `pwd` zeigt zur Kontrolle, wo du jetzt bist. Erwartet wird `/Users/deinname/EmdenNetwork`.

Falls du den Ordner vorher selbst mit `mkdir -p ~/EmdenNetwork` angelegt hast, ist das kein Problem,
solange er leer ist. (`mkdir` = „make directory“, `-p` = keine Fehlermeldung, falls er schon existiert.)

## 5. Projekt installieren und prüfen

```bash
cd ~/EmdenNetwork
npm install
cp -n .env.example .env
npm run check
```

- `npm install` lädt alle benötigten Bibliotheken in den Ordner `node_modules`, nur innerhalb des Projekts.
  Das sind etwa 650 MB und dauert ein bis zwei Minuten. Am Ende sollte `found 0 vulnerabilities` stehen.
- `cp -n .env.example .env` legt deine persönliche Konfigurationsdatei an. `-n` sorgt dafür, dass eine
  schon vorhandene `.env` nicht überschrieben wird. Die `.env` bleibt auf deinem Mac und wird nie
  hochgeladen.
- `npm run check` prüft alles: Formatierung, Codequalität, TypeScript, Tests und Build. Erfolgreich ist
  es, wenn unter anderem `Tests  37 passed (37)` und `✓ Compiled successfully` erscheinen und am Ende
  keine Zeile mit `npm error` steht.

## 6. Starten

Du brauchst **zwei** Terminal-Tabs. Einen neuen Tab öffnest du mit **⌘ + T**.

**Tab 1 – Backend:**

```bash
cd ~/EmdenNetwork
npm run dev:api
```

Warte auf die Zeile `Server listening at http://127.0.0.1:4000`.

**Tab 2 – Dashboard:**

```bash
cd ~/EmdenNetwork
npm run dev:dashboard
```

Warte auf `Local: http://127.0.0.1:3000` und `✓ Ready`. Öffne dann im Browser genau die Adresse, die
dort angezeigt wird: **http://127.0.0.1:3000**

Auf der Übersicht sollte jetzt **„Backend erreichbar“** stehen.

- **Beenden:** In dem jeweiligen Tab **Control + C** drücken (Control, nicht ⌘).
- Beide Server sind absichtlich nur auf deinem eigenen Mac erreichbar und nicht für andere Geräte im WLAN.
  In Phase 1 gibt es noch keine Anmeldung.

## 7. Wenn etwas nicht klappt

| Meldung                                                                  | Bedeutung und Lösung                                                                                     |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `zsh: command not found: node`                                           | Node.js fehlt, oder das Terminal wurde nach der Installation nicht neu geöffnet.                         |
| `npm warn EBADENGINE`                                                    | Node.js ist zu alt. Installiere die LTS-Version von nodejs.org.                                          |
| `fatal: destination path … already exists and is not an empty directory` | `~/EmdenNetwork` ist nicht leer. **Nichts löschen**, schick mir die Ausgabe von `ls -la ~/EmdenNetwork`. |
| `EACCES` oder `permission denied`                                        | Bitte **nicht** mit `sudo` wiederholen. Schick mir die Meldung.                                          |
| `EADDRINUSE`                                                             | Der Port ist belegt, meist läuft der Server schon in einem anderen Tab. Dort mit Control + C beenden.    |
| Dashboard zeigt „Backend nicht erreichbar“                               | Läuft Tab 1 (`npm run dev:api`)?                                                                         |
| Build-Fehler beim Laden von Schriftarten                                 | Keine Internetverbindung. Next.js lädt die Schriften beim ersten Start einmalig herunter.                |
| Fenster „Eingehende Netzwerkverbindungen für node erlauben?“             | Für die lokale Nutzung nicht nötig. Du kannst **Ablehnen** wählen.                                       |

Bei jeder anderen Meldung kopiere den Text aus dem Terminal (ohne Passwörter oder Tokens) und schick ihn mir.

## 8. Später: Repository privat schalten

Das GitHub-Repository `john46657/enrp` ist zurzeit **öffentlich**. Jeder kann den Code lesen. Es enthält
keine Geheimnisse, trotzdem empfiehlt sich „privat“, bevor das Projekt wächst:

GitHub → Repository öffnen → **Settings** → **General** → ganz unten **Danger Zone** →
**Change visibility** → **Make private**.

Folgen, die du kennen solltest:

- Zum Herunterladen (`git clone`) musst du dich danach bei GitHub anmelden.
- GitHub Actions (die automatischen Prüfungen) haben für private Repositories nur ein begrenztes
  kostenloses Monatskontingent. Das aktuelle Kontingent siehst du in deinen GitHub-Abrechnungseinstellungen.
