# Rollen und Berechtigungen – Emden Network

## Grundsätze

- Rollen im Code sind **abstrakte Schlüssel** (`owner`, `management`, `polizeileitung`, …). Welche Discord-Rolle
  dazu gehört, legt der Owner mit `/system config role` fest (gespeichert in `guild_config.role_map`).
- Jede Berechtigung wird **bei der Ausführung serverseitig** geprüft (`authorize()` in `packages/core/src/authz.ts`),
  unabhängig davon, ob ein Command in Discord sichtbar ist. Verweigerte Versuche landen als
  `permission.denied` im Audit-Log.
- Die Rollen des Aufrufers werden aus den Rollen-IDs abgeleitet, die Discord **mit der Interaktion** liefert
  (aktueller Stand zum Zeitpunkt der Aktion).
- `verifiziert` ergibt sich verbindlich aus einer **aktiven Verknüpfung in der Datenbank**, nicht nur aus der
  Discord-Rolle.
- Der Discord-Server-Eigentümer gilt immer als `owner` (für die Ersteinrichtung).
- Fraktionsleitungen haben leitungsbezogene Rechte **nur für die eigene Fraktion**.
- Der Bot vergibt nach erfolgreicher Roblox-Verifizierung **ausschließlich** die Rolle `Verifiziert` (und entfernt
  optional `Unverified`). Fraktionsrollen werden manuell vergeben und nie aus OAuth-Daten abgeleitet.

## Matrix

✅ = erlaubt · 🔸 = nur für die eigene Fraktion · – = nicht erlaubt.
`Fraktionsmitglied` ist eine reine Discord-Rolle ohne zusätzliche Rechte; die Mitgliedschaft wird über die
Datenbank geprüft (z. B. beim Dienstbeginn).

<!-- matrix:start -->
| Berechtigung | Beschreibung | Owner | Management | Polizeileitung | Feuerwehrleitung | Rettungsdienstleitung | Moderator | Fraktionsmitglied | Verifiziert | Unverified |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `self.read` | Eigene Daten einsehen | ✅ | ✅ | – | – | – | ✅ | – | ✅ | – |
| `player.read_any` | Profile anderer Spieler einsehen | ✅ | ✅ | 🔸 | 🔸 | 🔸 | ✅ | – | – | – |
| `faction.read` | Fraktionsinfos und Dienstplan einsehen | ✅ | ✅ | – | – | – | ✅ | – | ✅ | – |
| `faction.manage_members` | Mitglieder aufnehmen, entfernen, Ränge ändern | ✅ | ✅ | 🔸 | 🔸 | 🔸 | – | – | – | – |
| `faction.announce` | Fraktionsankündigung senden | ✅ | ✅ | 🔸 | 🔸 | 🔸 | – | – | – | – |
| `faction.audit` | Fraktions-Audit einsehen | ✅ | ✅ | 🔸 | 🔸 | 🔸 | – | – | – | – |
| `duty.self` | Eigenen Dienst starten/beenden | ✅ | ✅ | – | – | – | – | – | ✅ | – |
| `duty.view_faction` | Dienststatus und Statistiken einer Fraktion | ✅ | ✅ | 🔸 | 🔸 | 🔸 | – | – | – | – |
| `duty.correct` | Dienstsitzungen korrigieren | ✅ | ✅ | 🔸 | 🔸 | 🔸 | – | – | – | – |
| `duty.export` | Dienstzeiten exportieren | ✅ | ✅ | 🔸 | 🔸 | 🔸 | – | – | – | – |
| `applications.submit` | Bewerbung einreichen | – | – | – | – | – | – | – | ✅ | – |
| `applications.review` | Bewerbungen bearbeiten | ✅ | ✅ | 🔸 | 🔸 | 🔸 | – | – | – | – |
| `training.manage` | Ausbildungen anlegen und abschließen | ✅ | ✅ | 🔸 | 🔸 | 🔸 | – | – | – | – |
| `training.attend` | An Ausbildung teilnehmen | – | – | – | – | – | – | – | ✅ | – |
| `ticket.create` | Ticket/Meldung erstellen | ✅ | ✅ | – | – | – | ✅ | – | ✅ | ✅ |
| `ticket.staff` | Tickets übernehmen und schließen | ✅ | ✅ | – | – | – | ✅ | – | – | – |
| `moderation.warn` | Verwarnen | ✅ | ✅ | – | – | – | ✅ | – | – | – |
| `moderation.timeout` | Discord-Timeout | ✅ | ✅ | – | – | – | ✅ | – | – | – |
| `moderation.case_view` | Moderationsfälle einsehen | ✅ | ✅ | – | – | – | ✅ | – | – | – |
| `moderation.game_kick` | Spieler aus dem Spiel kicken | ✅ | ✅ | – | – | – | ✅ | – | – | – |
| `moderation.game_ban` | Spieler im Spiel bannen | ✅ | ✅ | – | – | – | – | – | – | – |
| `server.view` | Serverstatus einsehen | ✅ | ✅ | – | – | – | ✅ | – | ✅ | – |
| `server.announce` | Ingame-Ankündigungen | ✅ | ✅ | – | – | – | – | – | – | – |
| `server.maintenance` | Wartungsmodus setzen | ✅ | ✅ | – | – | – | – | – | – | – |
| `gameevent.manage` | Spielevents verwalten | ✅ | ✅ | – | – | – | – | – | – | – |
| `system.health` | Systemzustand einsehen | ✅ | ✅ | – | – | – | ✅ | – | – | – |
| `system.audit` | Audit-Log einsehen | ✅ | ✅ | – | – | – | – | – | – | – |
| `system.config` | Konfiguration ändern | ✅ | – | – | – | – | – | – | – | – |
| `verification.revoke_any` | Verknüpfung anderer Nutzer aufheben | ✅ | ✅ | – | – | – | – | – | – | – |
<!-- matrix:end -->

Diese Tabelle wird aus `packages/shared/src/permissions.ts` erzeugt (`pnpm docs:permissions`); ein Test schlägt
fehl, wenn Code und Dokumentation auseinanderlaufen.

## Commands

| Command | Berechtigung | Zusätzliche Prüfungen | Audit-Eintrag |
|---|---|---|---|
| `/verify` | – (jeder) | keine aktive Verknüpfung, max. 5 Links / 15 min | `verification.session_created`, `verification.linked`/`failed` |
| `/unlink` | – (eigene Verknüpfung) | Bestätigungs-Button nur für den Auslöser | `verification.revoked` |
| `/profile [spieler]` | `self.read` bzw. `player.read_any` | Leitung nur für Mitglieder der eigenen Fraktion | – (lesend) |
| `/playtime [spieler]` | wie `/profile` | | – |
| `/myfaction` | `self.read` | | – |
| `/help`, `/privacy` | – | | – |
| `/faction info`, `roster` | `faction.read` | | – |
| `/faction invite` | `faction.manage_members` | Ziel verifiziert, in keiner anderen Fraktion | `faction.member_added` |
| `/faction remove` | `faction.manage_members` (Fraktion des Ziels) | beendet laufenden Dienst | `faction.member_removed` |
| `/faction promote/demote/setrank` | `faction.manage_members` (Fraktion des Ziels) | Richtung der Rangänderung, kein eigener Rang | `faction.rank_*` |
| `/faction announce` | `faction.announce` | Massen-Pings werden entschärft | – (Nachricht ist öffentlich) |
| `/faction audit` | `faction.audit` | | – |
| `/duty start`, `stop` | `duty.self` | aktive Mitgliedschaft, eine offene Sitzung | `duty.started`, `duty.ended` |
| `/duty status [spieler]` | `self.read` bzw. `duty.view_faction` | | – |
| `/duty roster` | `faction.read` | | – |
| `/duty stats` | `duty.view_faction` | | – |
| `/duty correct` | `duty.correct` (Fraktion der Sitzung) | Ende ≥ Beginn, ≤ 24 h, nicht in der Zukunft; Originalwerte bleiben erhalten | `duty.corrected` |
| `/duty export` | `duty.export` | | `duty.exported` |
| `/warn` | `moderation.warn` | kein Selbst-/Team-Ziel (außer Owner) | `moderation.warn` |
| `/timeout` | `moderation.timeout` | Rollenhierarchie, kein Team-Ziel | `moderation.timeout` |
| `/case view` | `moderation.case_view` | | – |
| `/gamekick` | `moderation.game_kick` | Ziel verifiziert oder Roblox-ID | `game.job_created` + Moderationsfall |
| `/gameban` | `moderation.game_ban` | wie oben | `game.job_created` + Moderationsfall |
| `/server status` | `server.view` | | – |
| `/server players` | `moderation.case_view` | | – |
| `/server announce`, `restart-announce` | `server.announce` | Ingame-Textfilter | `game.job_created` |
| `/server maintenance` | `server.maintenance` | | `game.maintenance_set` |
| `/system health` | `system.health` | | – |
| `/system audit` | `system.audit` | | – |
| `/system config …` | `system.config` | keine verwalteten Rollen / @everyone | `system.config_changed` |

Noch nicht umgesetzte Commands (siehe [roadmap.md](roadmap.md)) haben ihre Berechtigungen bereits in der Matrix:
`applications.*`, `training.*`, `ticket.*`, `gameevent.manage`, `verification.revoke_any`.
