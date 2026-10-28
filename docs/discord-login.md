# Anmeldung mit Discord einrichten

Das Emden Network Control Center hat **keine Passwörter**. Man meldet sich mit dem eigenen Discord-Konto an.
Dafür braucht das Backend eine „Anwendung“ im Discord Developer Portal. Das ist kostenlos und dauert etwa fünf
Minuten.

> **Wichtig:** Das **Client Secret** ist geheim wie ein Passwort. Trage es nur in deine `.env` ein, niemals in
> einen Chat, eine Nachricht oder in den Code. Ist es doch einmal nach außen gelangt, erzeugst du im Portal mit
> **Reset Secret** einfach ein neues.

## 1. Anwendung im Discord Developer Portal anlegen

1. Öffne https://discord.com/developers/applications und melde dich mit deinem Discord-Konto an.
2. Klicke auf **New Application** und gib als Namen **Emden Network Control Center** ein.
   Diesen Namen sehen alle, die sich anmelden. Bestätige die Nutzungsbedingungen und klicke **Create**.
   (Du kannst auch die Anwendung deines bisherigen Bots verwenden. Dann sehen die Leute aber deren Namen.)
3. Wähle links **OAuth2**.
4. Unter **Redirects** klicke auf **Add Redirect** und trage **genau** diese Adresse ein:

   ```
   http://127.0.0.1:3000/api/auth/discord/callback
   ```

   Danach unten **Save Changes** klicken. Die Adresse muss Zeichen für Zeichen stimmen, sonst lehnt Discord die
   Anmeldung ab.

5. Unter **Client Information**:
   - **Client ID**: auf **Copy** klicken. Das ist eine lange Zahl, die nicht geheim ist.
   - **Client Secret**: auf **Reset Secret** klicken, bestätigen und den angezeigten Wert kopieren. Discord zeigt
     ihn nur dieses eine Mal an.

## 2. Deine eigene Discord-Benutzer-ID herausfinden

Damit du der erste **Owner** wirst, braucht das Backend deine Discord-ID:

1. Öffne Discord → **Benutzereinstellungen** (Zahnrad) → **Erweitert** → **Entwicklermodus** einschalten.
2. Klicke auf deinen eigenen Namen oder dein Profilbild → **Benutzer-ID kopieren**.

Die ID besteht aus 17 bis 20 Ziffern. Sie ist nicht geheim.

## 3. Werte in die `.env` eintragen

Öffne die Datei `.env` in deinem Projektordner, zum Beispiel mit VS Code oder im Terminal:

```bash
cd ~/EmdenNetwork
open -a TextEdit .env
```

Trage die drei Werte hinter dem `=` ein (ohne Leerzeichen, ohne Anführungszeichen). Fehlen die Zeilen in deiner
`.env`, weil sie aus einer älteren Vorlage stammt, kopiere sie aus `.env.example`:

```env
DISCORD_CLIENT_ID=deine-client-id
DISCORD_CLIENT_SECRET=dein-client-secret
OWNER_DISCORD_USER_ID=deine-discord-id
```

Speichern nicht vergessen (⌘ + S).

## 4. Backend neu starten und anmelden

1. Im Terminal-Tab mit dem Backend **Control + C** drücken und neu starten:

   ```bash
   npm run dev:api
   ```

   In der Ausgabe sollte stehen: `Ersteinrichtung: Owner angelegt (created)`. Startest du das Backend später
   erneut, steht dort `Es gibt bereits einen Owner – OWNER_DISCORD_USER_ID wird ignoriert`. Das ist richtig so.

2. Läuft auch das Dashboard (`npm run dev:dashboard`), öffne **http://127.0.0.1:3000**.
   Nicht `localhost`, denn der Browser speichert Anmelde-Cookies getrennt für jede Adresse.
3. Klicke **Mit Discord anmelden**. Discord fragt, ob die Anwendung dein Profil (Benutzername, Avatar) sehen darf.
   Mehr wird nicht abgefragt, insbesondere keine E-Mail-Adresse. Bestätige die Anfrage.
4. Du landest im Control Center. Unten in der Seitenleiste stehen dein Name und die Rolle **Owner**.

## 5. Weitere Personen freischalten

Unter **Benutzer und Rollen** → **Person freischalten** trägst du die Discord-ID der Person ein (sie findet sie wie
in Schritt 2), dazu einen Namen und eine Rolle. Danach kann sie sich mit ihrem Discord-Konto anmelden.
Alle anderen Discord-Konten werden abgelehnt.

| Rolle         | Darf standardmäßig                                                           |
| ------------- | ---------------------------------------------------------------------------- |
| Owner         | alles. Wird nur über die Ersteinrichtung vergeben                            |
| Administrator | Personen freischalten, sperren, Rollen und Rechte verwalten, Audit-Log lesen |
| Moderator     | Benutzerliste und Rollen ansehen                                             |
| Support       | Benutzerliste ansehen                                                        |
| Viewer        | nur die allgemeinen Seiten                                                   |

Die Rechte der Rollen kannst du unter **Rollen und Berechtigungen** anpassen. Jede Änderung steht im **Audit-Log**.

## Wenn etwas nicht klappt

| Was du siehst                                                                         | Ursache und Lösung                                                                                                               |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Discord zeigt „Ungültige OAuth2-Weiterleitungs-URI“ / „Invalid OAuth2 redirect_uri“   | Die Adresse aus Schritt 1.4 fehlt oder weicht ab. Genau so eintragen und **Save Changes** klicken.                               |
| „Die Anmeldung mit Discord ist noch nicht eingerichtet“                               | `DISCORD_CLIENT_ID` oder `DISCORD_CLIENT_SECRET` fehlt in der `.env`, oder das Backend wurde danach nicht neu gestartet.         |
| Backend startet nicht: „DISCORD_CLIENT_SECRET: sieht nicht wie ein Client Secret aus“ | Beim Kopieren ging etwas verloren oder es ist ein Leerzeichen dabei. Secret neu erzeugen und einfügen.                           |
| „Dieses Discord-Konto ist nicht freigeschaltet“                                       | Die Discord-ID ist nicht freigeschaltet. Beim ersten Mal `OWNER_DISCORD_USER_ID` prüfen und das Backend neu starten.             |
| „Die Anmeldung ist abgelaufen oder wurde in einem anderen Tab begonnen“               | Mehr als 10 Minuten bei Discord gewartet, oder das Control Center über `localhost` statt `127.0.0.1` geöffnet. Erneut versuchen. |
| „Discord ist gerade nicht erreichbar“                                                 | Störung bei Discord oder keine Internetverbindung. Später erneut versuchen.                                                      |

## Später: Online-Betrieb

Für den Betrieb im Internet (Phase 7) kommt im Portal eine zweite Redirect-Adresse dazu, zum Beispiel
`https://deine-domain.de/api/auth/discord/callback`. In der `.env` des Servers steht dann
`DASHBOARD_PUBLIC_URL=https://deine-domain.de`.
