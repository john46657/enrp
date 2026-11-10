# Datenmodell

Schema: [`packages/database/src/schema`](../packages/database/src/schema) · Migrationen: [`packages/database/drizzle`](../packages/database/drizzle).
Alle Zeitpunkte sind `timestamptz` (UTC). Primärschlüssel sind UUIDs, außer Discord-IDs (Text, Snowflake),
Roblox-User-IDs (bigint – stabile ID, Namen ändern sich) und dem Audit-Log (bigserial für die Reihenfolge).

| Bereich | Tabellen | Wichtige Regeln |
|---|---|---|
| Identität | `discord_users`, `roblox_users`, `account_links`, `verifications`, `oauth_states`, `profile_events`, `play_sessions` | höchstens eine **aktive** Verknüpfung je Discord- und Roblox-Konto (partielle Unique-Indizes); OAuth-States nur gehasht, einmalig, 10–15 Min. gültig |
| Rechte | `app_roles`, `role_permissions`, `role_bindings`, `command_overrides`, `admin_sessions`, `api_keys`, `member_role_cache` | Sitzungs- und API-Schlüssel nur als SHA-256; Bindung entweder Discord-Rolle **oder** Person (Check-Constraint) |
| Spielwelt | `factions`, `faction_memberships`, `duty_sessions`, `duty_corrections`, `vehicles`, `vehicle_categories`, `vehicle_assignments`, `game_servers`, `game_events` | eine aktive Mitgliedschaft und eine aktive Dienstsession je Spieler; Spielereignisse eindeutig je Schlüssel + Ereignis-ID |
| Support | `tickets`, `reports`, `case_reports`, `case_references`, `record_events` | Anhänge nur als geprüfte HTTPS-Links/Referenzen; interne Notizen markiert |
| Moderation | `moderation_actions`, `appeals` | Ziel muss gesetzt sein; Einspruchsprüfer ≠ Antragsteller (Constraint) |
| Community | `suggestions`, `suggestion_votes`, `polls`, `poll_votes`, `giveaways`, `giveaway_entries`, `announcements`, `maintenance_windows`, `rule_sets`, `rule_acceptances`, `reward_codes`, `code_redemptions` | Codes nur als HMAC; Einlösungslimit per Check-Constraint und Zeilensperre; eine Stimme je Person |
| Betrieb & Kontrolle | `audit_events`, `security_events`, `incidents`, `feature_flags`, `settings`, `config_versions`, `approval_requests`, `environments`, `releases`, `backup_runs`, `restore_requests`, `automation_rules`, `automation_runs`, `job_runs`, `privacy_requests`, `service_heartbeats`, `idempotency_keys`, `request_nonces` | Audit unveränderlich (Trigger); Freigabe: Entscheider ≠ Antragsteller (Constraint); Release: Freigebender ≠ Vorbereiter (Constraint) |

## Löschregeln

- Löschen eines **Roblox-Kontos** kaskadiert auf Verknüpfungen, Spiel-/Dienstsessions, Korrekturen,
  Mitgliedschaften und Fahrzeugzuweisungen.
- **Fraktionen** können nicht gelöscht werden, solange Mitgliedschaften/Sessions existieren (`restrict`).
- **Moderationsaktionen** und **Einsprüche** bleiben bei Datenschutz-Löschungen erhalten (Durchsetzung von
  Sanktionen, berechtigtes Interesse) und werden über Aufbewahrungsfristen bereinigt.
- Tickets, Reports, Vorschläge und Nachrichten werden bei Löschanträgen **pseudonymisiert** (`deleted`).
- Das **Audit-Log** bleibt unverändert; es enthält IDs, aber keine Inhalte wie Ticketnachrichten.

## Aufbewahrung (Standard, im Dashboard änderbar)

| Daten | Frist |
|---|---|
| Audit-Log | 730 Tage (mind. 90) |
| Sicherheitsereignisse | 180 Tage |
| Spielereignisse (Rohdaten) | 30 Tage |
| Geschlossene Tickets | 365 Tage |
| Verifizierungsprotokoll | 180 Tage |
| Datenauskünfte (Inhalt) | 7 Tage |
| Jobhistorie | 30 Tage |
| Backups | `BACKUP_RETENTION_DAYS` (30) |
| OAuth-States, Nonces, Idempotenzschlüssel | 1–2 Tage |

Der Worker wendet die Fristen täglich an; `/data cleanup-preview` zeigt vorher, was gelöscht würde.
