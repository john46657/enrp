# Datenschutz und Aufbewahrung

Grundsatz: Es werden nur Daten gespeichert, die für Verifizierung, Fraktionsverwaltung, Dienstzeiten und
Moderation nötig sind. Keine Passwörter, keine E-Mail-Adressen, keine Roblox-Tokens.

| Daten | Zweck | Aufbewahrung | Umsetzung |
|---|---|---|---|
| OAuth-Sessions (Hashes, PKCE-Verifier) | Verifizierung | Verifier bis Abschluss (max. 10 min), Session 24 h | `VerificationService.cleanup` (alle 10 min) |
| Roblox-Access-/Refresh-Token | Identitätsprüfung | **nicht gespeichert**; Refresh-Token wird sofort widerrufen | `verification.ts` |
| Discord-ID, Roblox-ID, Benutzer-/Anzeigename | Verknüpfung | solange verknüpft; aufgehobene Verknüpfungen 365 Tage (Missbrauchsnachweis) | `purgeExpiredData` |
| Fraktion, Rang, Dienstsitzungen | Fraktionsbetrieb | solange Mitglied bzw. bis Löschanfrage | – |
| Spielereignisse (Join/Leave/Dienst) | Spielzeit, Nachvollziehbarkeit | 180 Tage | `purgeExpiredData` (alle 6 h) |
| Outbox-Events (erledigt/fehlgeschlagen) | technische Zustellung | 30 Tage | dto. |
| Admin-Aufträge | Nachvollziehbarkeit | 90 Tage | dto. |
| Audit-Logs | Sicherheit, Nachweis | 365 Tage | dto. |
| Moderationsfälle | Moderation | unbegrenzt bis Löschanfrage/Entscheidung des Teams | – |

„Spielzeit gesamt“ bezieht sich daher auf die letzten 180 Tage.

## Auskunft und Löschung

- `/privacy` informiert Spieler, `/unlink` hebt die Verknüpfung sofort auf.
- **Vollständige Löschung** einer Person (nach Prüfung durch das Team): `DELETE FROM users WHERE discord_id = '…';`
  entfernt per `ON DELETE CASCADE` Verknüpfungen, Mitgliedschaften, Dienstzeiten, Bewerbungen, Tickets. Bei
  Moderationsfällen wird der Bezug auf `NULL` gesetzt, die Discord-ID bleibt dort als Nachweis gespeichert. Ob sie
  ebenfalls entfernt wird, entscheidet das Team im Einzelfall (berechtigtes Interesse). Diese Aktion ist
  irreversibel und wird bewusst nicht als Bot-Command angeboten.
- Audit-Einträge enthalten Discord-/Roblox-IDs, aber keine Freitext-Secrets.

Die Fristen sind Vorschläge und in `packages/core/src/retention.ts` zentral anpassbar. Eine rechtliche Prüfung
(DSGVO, Datenschutzerklärung für die Roblox-App-Prüfung) ist Aufgabe des Betreibers.
