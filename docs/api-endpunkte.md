# API-Endpunkte (generiert)

Automatisch aus den Routen-Schemas erzeugt (`pnpm --filter @enrp/api openapi`). Vollständige Schemas: [openapi.json](openapi.json),
interaktiv unter `/api/docs` (außerhalb der Produktion oder mit `ENABLE_API_DOCS=true`).

## Sonstiges

| Methode | Pfad | Zweck |
|---|---|---|
| `GET` | `/health` |  |
| `GET` | `/health/ready` |  |
| `GET` | `/metrics` |  |

## Authentifizierung

| Methode | Pfad | Zweck |
|---|---|---|
| `GET` | `/api/v1/auth/discord/login` | Dashboard-Login über Discord starten |
| `GET` | `/api/v1/auth/discord/callback` | OAuth-Callback von Discord |
| `POST` | `/api/v1/auth/logout` | Abmelden |
| `GET` | `/api/v1/auth/me` | Aktuelle Person, Rechte und CSRF-Token |
| `GET` | `/api/v1/auth/sessions` | Eigene aktive Sitzungen |

## Verifizierung

| Methode | Pfad | Zweck |
|---|---|---|
| `POST` | `/api/v1/verification/start` | /verify – persönlichen Verifizierungslink erzeugen |
| `GET` | `/api/v1/verification/begin` | Verifizierungslink öffnen |
| `GET` | `/api/v1/verification/discord/callback` | Discord-Bestätigung (Callback) |
| `GET` | `/api/v1/verification/roblox/callback` | Roblox-OAuth (Callback) |
| `GET` | `/api/v1/verification/status` | /verify status |
| `POST` | `/api/v1/verification/unlink` | /verify unlink |
| `GET` | `/api/v1/verification/links` | Kontoverknüpfungen |
| `GET` | `/api/v1/verification/attempts` | Letzte Verifizierungsversuche |

## Spieler

| Methode | Pfad | Zweck |
|---|---|---|
| `GET` | `/api/v1/players` | Spielersuche |
| `GET` | `/api/v1/players/me` | Eigenes Profil |
| `GET` | `/api/v1/players/roblox/{robloxUserId}` | Profil nach Roblox-ID |
| `GET` | `/api/v1/players/discord/{discordUserId}` | Profil nach Discord-ID |
| `GET` | `/api/v1/players/history` | Änderungshistorie eines Profils |

## Ranglisten

| Methode | Pfad | Zweck |
|---|---|---|
| `GET` | `/api/v1/leaderboards/playtime` | Rangliste Spielzeit (öffentlich) |
| `GET` | `/api/v1/leaderboards/duty` | Rangliste Dienstzeit (öffentlich) |

## Fraktionen

| Methode | Pfad | Zweck |
|---|---|---|
| `GET` | `/api/v1/factions` | Fraktionsübersicht (öffentlich) |
| `GET` | `/api/v1/factions/stats` | Fraktionsstatistiken |
| `GET` | `/api/v1/factions/{key}` | Fraktion |
| `PATCH` | `/api/v1/factions/{key}` | Fraktion konfigurieren (Name, Farbe, Discord-Rolle, aktiv) |
| `GET` | `/api/v1/factions/{key}/members` | Mitgliederliste |
| `POST` | `/api/v1/factions/{key}/members` | Aufnehmen oder versetzen |
| `GET` | `/api/v1/factions/{key}/history` | Änderungshistorie der Mitgliedschaften |
| `POST` | `/api/v1/factions/members/remove` | Aus Fraktion entfernen |

## Dienstsystem

| Methode | Pfad | Zweck |
|---|---|---|
| `GET` | `/api/v1/duty/status/{robloxUserId}` | Aktueller Dienststatus (öffentlich) |
| `GET` | `/api/v1/duty/on-duty` | Anzahl im Dienst je Fraktion |
| `GET` | `/api/v1/duty/stats` | Dienststatistik (Person oder Fraktion) |
| `GET` | `/api/v1/duty/sessions` | Historie der Dienstsessions |
| `POST` | `/api/v1/duty/sessions/{id}/correct` | Dienstsession korrigieren oder ungültig machen |
| `GET` | `/api/v1/duty/sessions/{id}/corrections` | Korrekturen einer Session |

## Fahrzeuge

| Methode | Pfad | Zweck |
|---|---|---|
| `GET` | `/api/v1/vehicles/categories` | Fahrzeugkategorien |
| `POST` | `/api/v1/vehicles/categories` | Kategorie anlegen |
| `GET` | `/api/v1/vehicles` | Fahrzeugübersicht |
| `POST` | `/api/v1/vehicles` | Fahrzeug anlegen |
| `GET` | `/api/v1/vehicles/{id}` | Fahrzeugdetails mit Zuweisungen |
| `PATCH` | `/api/v1/vehicles/{id}` | Fahrzeug bearbeiten |
| `POST` | `/api/v1/vehicles/{id}/delete` | Fahrzeug löschen |
| `POST` | `/api/v1/vehicles/{id}/assign` | Fahrzeug zuweisen |
| `POST` | `/api/v1/vehicles/assignments/{id}/unassign` | Zuweisung entfernen |

## Tickets

| Methode | Pfad | Zweck |
|---|---|---|
| `POST` | `/api/v1/tickets` | Ticket erstellen |
| `GET` | `/api/v1/tickets` | Tickets (eigene oder alle mit tickets:view) |
| `POST` | `/api/v1/tickets/sync` | Spiegelung aus dem Discord-Ticketpanel (nur Bot) |
| `GET` | `/api/v1/tickets/{id}` | Ticket mit Verlauf |
| `POST` | `/api/v1/tickets/{id}/actions` | Übernehmen, zuweisen, Status, Priorität, schließen, wieder öffnen |
| `POST` | `/api/v1/tickets/{id}/messages` | Nachricht oder interne Notiz |

## Reports

| Methode | Pfad | Zweck |
|---|---|---|
| `POST` | `/api/v1/reports` | Spieler melden |
| `GET` | `/api/v1/reports` | Reports |
| `GET` | `/api/v1/reports/{id}` | Report mit Verlauf |
| `PATCH` | `/api/v1/reports/{id}` | Report bearbeiten / abschließen |

## Fallberichte

| Methode | Pfad | Zweck |
|---|---|---|
| `POST` | `/api/v1/cases` | Fallbericht anlegen |
| `GET` | `/api/v1/cases` | Fallberichte |
| `GET` | `/api/v1/cases/{id}` | Fallbericht |
| `PATCH` | `/api/v1/cases/{id}` | Notiz, Referenz, schließen, wieder öffnen |

## Moderation

| Methode | Pfad | Zweck |
|---|---|---|
| `POST` | `/api/v1/moderation/actions` | Verwarnung, Timeout, Kick, Bann oder Notiz |
| `GET` | `/api/v1/moderation/actions` | Moderationshistorie mit Filtern |
| `GET` | `/api/v1/moderation/actions/mine` | Eigene Moderationsvorgänge (für Einsprüche) |
| `GET` | `/api/v1/moderation/actions/{id}` | Moderationsaktion |
| `POST` | `/api/v1/moderation/actions/{id}/revoke` | Aktion aufheben |
| `POST` | `/api/v1/moderation/unban` | Bann aufheben |
| `POST` | `/api/v1/moderation/appeals` | Einspruch einlegen |
| `GET` | `/api/v1/moderation/appeals` | Einsprüche |
| `POST` | `/api/v1/moderation/appeals/{id}/decide` | Einspruch entscheiden |

## Community

| Methode | Pfad | Zweck |
|---|---|---|
| `POST` | `/api/v1/suggestions` | Vorschlag einreichen |
| `GET` | `/api/v1/suggestions` | Vorschläge |
| `POST` | `/api/v1/suggestions/{id}/vote` | Abstimmen (1, -1, 0 = zurückziehen) |
| `POST` | `/api/v1/suggestions/{id}/status` | Status setzen |
| `POST` | `/api/v1/suggestions/{id}/message` | Discord-Nachricht verknüpfen (Bot) |
| `GET` | `/api/v1/suggestions/{id}` | Vorschlag mit Stimmen |
| `POST` | `/api/v1/polls` | Umfrage erstellen |
| `GET` | `/api/v1/polls` | Umfragen |
| `GET` | `/api/v1/polls/{id}` | Umfrageergebnis |
| `POST` | `/api/v1/polls/{id}/vote` | Abstimmen |
| `POST` | `/api/v1/polls/{id}/close` | Umfrage beenden |
| `POST` | `/api/v1/polls/{id}/message` | Discord-Nachricht verknüpfen (Bot) |
| `POST` | `/api/v1/giveaways` | Giveaway erstellen |
| `GET` | `/api/v1/giveaways` | Giveaways |
| `POST` | `/api/v1/giveaways/{id}/enter` | Teilnehmen |
| `POST` | `/api/v1/giveaways/{id}/draw` | Gewinner ziehen |
| `POST` | `/api/v1/giveaways/{id}/cancel` | Abbrechen |
| `POST` | `/api/v1/giveaways/{id}/message` | Discord-Nachricht verknüpfen (Bot) |
| `GET` | `/api/v1/community/stats` | Statistiken zu Community-Aktivitäten |

## Ankündigungen

| Methode | Pfad | Zweck |
|---|---|---|
| `POST` | `/api/v1/announcements` | Ankündigung / Changelog-Eintrag anlegen |
| `GET` | `/api/v1/announcements` | Ankündigungen |
| `GET` | `/api/v1/changelog` | Veröffentlichter Changelog (öffentlich) |
| `POST` | `/api/v1/announcements/{id}/publish` | Veröffentlichen |
| `GET` | `/api/v1/maintenance` | Wartungsstatus (öffentlich) und geplante Fenster |
| `POST` | `/api/v1/maintenance` | Wartung planen |
| `POST` | `/api/v1/maintenance/{id}/status` | Wartungsstatus ändern |

## Regelwerk

| Methode | Pfad | Zweck |
|---|---|---|
| `GET` | `/api/v1/rules` | Aktuelles Regelwerk (öffentlich) |
| `POST` | `/api/v1/rules` | Entwurf anlegen |
| `GET` | `/api/v1/rules/versions` | Alle Versionen |
| `POST` | `/api/v1/rules/{id}/publish` | Version veröffentlichen |
| `POST` | `/api/v1/rules/accept` | Regelwerk bestätigen |
| `GET` | `/api/v1/rules/acceptance` | Eigener Bestätigungsstatus |

## Codes & Rewards

| Methode | Pfad | Zweck |
|---|---|---|
| `GET` | `/api/v1/codes` | Codes (ohne Klartext) |
| `POST` | `/api/v1/codes` | Code anlegen (Klartext wird nur einmal angezeigt) |
| `POST` | `/api/v1/codes/{id}/status` | Code aktivieren/deaktivieren |

## Roblox-Spielserver

| Methode | Pfad | Zweck |
|---|---|---|
| `POST` | `/api/v1/game/heartbeat` | Heartbeat mit Spielerliste; liefert Steuerdaten |
| `POST` | `/api/v1/game/events` | Spielereignisse (idempotent je Ereignis-ID) |
| `POST` | `/api/v1/game/shutdown` | Server fährt herunter |
| `POST` | `/api/v1/game/players/access` | Zugangsprüfung beim Betreten (Bann, Fraktion, Fahrzeuge) |
| `POST` | `/api/v1/game/redeem` | Code einlösen (Idempotency-Key-Header erforderlich) |
| `POST` | `/api/v1/game/sanctions/{id}/ack` | Ausführung einer Roblox-Sanktion bestätigen |

## Roblox-Verwaltung

| Methode | Pfad | Zweck |
|---|---|---|
| `GET` | `/api/v1/roblox/servers` | Serverstatus und -historie |
| `GET` | `/api/v1/roblox/keys` | API-Schlüssel (ohne Klartext) |
| `POST` | `/api/v1/roblox/keys` | API-Schlüssel erzeugen (Klartext nur einmal) |
| `POST` | `/api/v1/roblox/keys/{id}/revoke` | API-Schlüssel widerrufen |
| `GET` | `/api/v1/roblox/events` | Letzte Spielereignisse |

## Berechtigungen

| Methode | Pfad | Zweck |
|---|---|---|
| `GET` | `/api/v1/permissions/catalog` | Berechtigungskatalog und Befehlsrechte |
| `GET` | `/api/v1/permissions/roles` | Rollen mit Rechten und Zuweisungen |
| `POST` | `/api/v1/permissions/roles` | Rolle anlegen |
| `PUT` | `/api/v1/permissions/roles/{id}/grants` | Rechte einer Rolle setzen (ggf. Freigabe erforderlich) |
| `POST` | `/api/v1/permissions/bindings` | Rolle einer Discord-Rolle oder Person zuweisen |
| `POST` | `/api/v1/permissions/bindings/{id}/remove` | Zuweisung entfernen |
| `GET` | `/api/v1/permissions/commands` | Befehls-Overrides |
| `POST` | `/api/v1/permissions/commands/override` | /permissions grant|revoke |
| `POST` | `/api/v1/permissions/commands/reset` | /permissions reset – Overrides entfernen |
| `POST` | `/api/v1/permissions/check` | Befehlszugriff der handelnden Person prüfen |
| `POST` | `/api/v1/permissions/test` | /permissions test – Zugriff einer anderen Person prüfen |

## Konfiguration

| Methode | Pfad | Zweck |
|---|---|---|
| `GET` | `/api/v1/settings` | Alle Einstellungen |
| `PUT` | `/api/v1/settings/{key}` | Einstellung ändern |
| `GET` | `/api/v1/config/history` | Konfigurationshistorie |
| `GET` | `/api/v1/config/history/{scope}/{version}` | Einzelne Version |

## Feature-Flags

| Methode | Pfad | Zweck |
|---|---|---|
| `GET` | `/api/v1/flags` | Feature-Flags |
| `PUT` | `/api/v1/flags/{key}` | Flag setzen (auch kill_switch, maintenance_mode) |
| `GET` | `/api/v1/flags/{key}/history` | Änderungshistorie |

## Monitoring

| Methode | Pfad | Zweck |
|---|---|---|
| `GET` | `/api/v1/overview` | Dashboard-Übersicht (nur echte Werte) |
| `GET` | `/api/v1/monitoring/health` | /ops health |
| `GET` | `/api/v1/monitoring/metrics` | /ops metrics |
| `GET` | `/api/v1/monitoring/dependencies` | /ops dependencies |
| `GET` | `/api/v1/monitoring/queues` | /ops queue |
| `POST` | `/api/v1/monitoring/queues/{queue}/jobs/{jobId}/retry` | Fehlgeschlagenen Job erneut ausführen |
| `GET` | `/api/v1/monitoring/alerts` | /ops alerts |
| `GET` | `/api/v1/monitoring/jobs` | Jobhistorie |
| `POST` | `/api/v1/monitoring/heartbeat` | Lebenszeichen eines Dienstes (Bot) |
| `GET` | `/api/v1/status` | Öffentlicher Status (aggregiert) |

## Vorfälle

| Methode | Pfad | Zweck |
|---|---|---|
| `POST` | `/api/v1/incidents` | Vorfall erstellen |
| `GET` | `/api/v1/incidents` | Vorfälle |
| `GET` | `/api/v1/incidents/{id}` | Vorfall mit Verlauf |
| `PATCH` | `/api/v1/incidents/{id}` | Status, Priorität, Zuweisung, Kommentar |
| `POST` | `/api/v1/incidents/{id}/resolve` | Vorfall abschließen |

## Freigabezentrum

| Methode | Pfad | Zweck |
|---|---|---|
| `GET` | `/api/v1/approvals` | Freigabeanfragen |
| `POST` | `/api/v1/approvals` | /approval create – generische Freigabe beantragen |
| `GET` | `/api/v1/approvals/{id}` | Freigabeanfrage |
| `POST` | `/api/v1/approvals/{id}/decide` | Genehmigen oder ablehnen |
| `POST` | `/api/v1/approvals/{id}/cancel` | Eigene Anfrage zurückziehen |

## Releases & Umgebungen

| Methode | Pfad | Zweck |
|---|---|---|
| `GET` | `/api/v1/environments` | /env status |
| `GET` | `/api/v1/environments/compare` | /env compare |
| `GET` | `/api/v1/releases` | /deploy history |
| `POST` | `/api/v1/releases` | /deploy prepare, /deploy rollback, /env promote |
| `POST` | `/api/v1/releases/{id}/approve` | /deploy approve (Vier-Augen-Prinzip) |
| `POST` | `/api/v1/releases/{id}/cancel` | Vorbereitetes Release abbrechen |
| `POST` | `/api/v1/releases/{id}/result` | Pipeline-Rückmeldung (Header X-Release-Secret) |

## Backups

| Methode | Pfad | Zweck |
|---|---|---|
| `GET` | `/api/v1/backups` | Backup-Status und -Historie |
| `POST` | `/api/v1/backups/run` | Backup jetzt ausführen |
| `POST` | `/api/v1/backups/{id}/restore` | Wiederherstellung beantragen (Vorschau + Freigabe) |

## Automatisierungen

| Methode | Pfad | Zweck |
|---|---|---|
| `GET` | `/api/v1/automations` | /automation list |
| `POST` | `/api/v1/automations` | /automation create |
| `POST` | `/api/v1/automations/{id}/enabled` | /automation pause|resume |
| `POST` | `/api/v1/automations/{id}/delete` | Löschen |
| `POST` | `/api/v1/automations/{id}/test` | /automation test (Probelauf ohne Wirkung) |
| `GET` | `/api/v1/automations/history` | /automation history |

## Datenschutz

| Methode | Pfad | Zweck |
|---|---|---|
| `POST` | `/api/v1/privacy/inspect` | /data inspect |
| `POST` | `/api/v1/privacy/export` | /data export |
| `GET` | `/api/v1/privacy/exports/{id}` | Datenauskunft herunterladen |
| `POST` | `/api/v1/privacy/deletion` | /data deletion-request (Vier-Augen-Freigabe) |
| `GET` | `/api/v1/privacy/requests` | Datenschutzanfragen |
| `GET` | `/api/v1/privacy/retention` | /data retention & /data cleanup-preview |

## Audit

| Methode | Pfad | Zweck |
|---|---|---|
| `GET` | `/api/v1/audit` | /audit search |
| `GET` | `/api/v1/audit/verify` | /audit verify – Hash-Kette prüfen |
| `GET` | `/api/v1/audit/retention` | /audit retention |
| `GET` | `/api/v1/audit/{id}` | /audit diff |
| `POST` | `/api/v1/audit/export` | /audit export (max. 31 Tage, 10 000 Einträge) |

## Sicherheit

| Methode | Pfad | Zweck |
|---|---|---|
| `GET` | `/api/v1/security/events` | Sicherheitsereignisse |
| `GET` | `/api/v1/security/sessions` | Aktive Admin-Sitzungen |
| `POST` | `/api/v1/security/sessions/{id}/revoke` | Sitzung beenden |

## Echtzeit

| Methode | Pfad | Zweck |
|---|---|---|
| `GET` | `/api/v1/realtime/stream` | Live-Ereignisse (SSE) |

## Bot

| Methode | Pfad | Zweck |
|---|---|---|
| `GET` | `/api/v1/bot/config` | Bot-Konfiguration (nur Service-Token) |
