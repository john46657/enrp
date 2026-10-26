# Discord-App einrichten

Diese Werte erzeugst du selbst im [Discord Developer Portal](https://discord.com/developers/applications).

1. **New Application** → Name z. B. „Emden Network“.
2. **General Information** → *Application ID* kopieren → `DISCORD_APPLICATION_ID`.
3. **Bot** → *Reset Token* → Token kopieren → `DISCORD_TOKEN`. Niemals teilen oder committen. Bei Verdacht sofort
   neu erzeugen.
4. **Bot → Privileged Gateway Intents:** alle **aus** lassen. Der Bot nutzt nur den nicht-privilegierten
   `Guilds`-Intent und fragt Mitglieder gezielt per REST ab.
5. **Bot → Public Bot:** ausschalten, damit niemand sonst den Bot einladen kann.
6. **OAuth2 → URL Generator:** Scopes `bot` und `applications.commands`. Bot-Berechtigungen (minimal):
   - *Manage Roles* (Rolle „Verifiziert“ vergeben/entziehen)
   - *Moderate Members* (nur für `/timeout`)
   - *Send Messages*, *Embed Links*, *Attach Files* (Ankündigungen, CSV-Export)
   Nicht *Administrator* vergeben.
7. Mit der erzeugten URL den Bot auf den Server einladen.
8. Discord → *Einstellungen → Erweitert → Entwicklermodus*. Dann Rechtsklick auf den Server → *ID kopieren* →
   `DISCORD_GUILD_ID`.
9. **Servereinstellungen → Rollen:** Die Rollen anlegen (`Owner`, `Management`, `Polizeileitung`,
   `Feuerwehrleitung`, `Rettungsdienstleitung`, `Moderator`, `Fraktionsmitglied`, `Verifiziert`, `Unverified`).
   Die **Bot-Rolle über „Verifiziert“ und „Unverified“** ziehen, sonst schlägt die Rollenvergabe mit
   „Missing Permissions“ fehl. Der Fehler steht dann dauerhaft in der Outbox und im Audit-Log.
10. Commands registrieren: `pnpm bot:register` (Guild-Commands sind sofort verfügbar).
11. Bot starten und als Server-Eigentümer die Rollen zuordnen:
    `/system config role schluessel:<Rolle> rolle:@<Discord-Rolle>` für jede Rolle, danach `/system config show`.

Optional: Unter *Servereinstellungen → Integrationen → Emden Network* kannst du die Sichtbarkeit einzelner
Commands einschränken. Das ist nur Komfort, die Berechtigungen prüft der Bot bei jeder Ausführung selbst.

## Was passiert bei `/verify`?

1. Der Bot prüft, ob bereits eine Verknüpfung besteht, und legt sonst eine OAuth-Session für **deine** Discord-ID an.
2. Du erhältst eine nur für dich sichtbare Nachricht mit dem Button **„Mit Roblox verbinden“** (Link, 10 min gültig,
   einmalig).
3. Nach der Anmeldung bei Roblox zeigt die Ergebnisseite Erfolg oder Fehler. Der Bot vergibt die Rolle
   **Verifiziert** innerhalb weniger Sekunden und schickt dir eine DM (falls DMs erlaubt sind).
4. Bei Abbruch oder Ablauf einfach `/verify` erneut ausführen. Ältere Links werden dabei ungültig.
