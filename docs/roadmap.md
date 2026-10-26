# Roadmap und offene Punkte

## Phase 1 – Grundsystem ✅
Monorepo, TypeScript, Bot-Grundgerüst und Registrierung, PostgreSQL-Migrationen (alle Tabellen),
Berechtigungs- und Audit-System, lokale Entwicklungsumgebung.

## Phase 2 – OAuth-Verifizierung ✅
PKCE-Flow, Callback, userinfo, Verknüpfung, Rolle „Verifiziert“ über Outbox, Fehlerbehandlung,
Sicherheitstests.
**Offen (manuell):** Roblox-App registrieren, im privaten Modus mit echten Accounts testen, zur Prüfung
einreichen.

## Phase 3 – GermanRP-System 🟡
| Funktion | Status |
|---|---|
| Fraktionen, Ränge, `/faction …` | ✅ |
| Spielerprofile, `/profile`, `/playtime`, `/myfaction` | ✅ |
| Dienstsystem `/duty …` | ✅ |
| Moderation `/warn`, `/timeout`, `/case view`, `/gamekick`, `/gameban` | ✅ |
| Bewerbungen `/apply`, `/applications list/view/accept/reject/assign` | ⏳ Tabellen + Rechte vorhanden |
| Ausbildungen `/training create/attend/complete` | ⏳ Tabellen + Rechte vorhanden |
| Tickets `/ticket create/claim/close`, `/report` | ⏳ Tabellen + Rechte vorhanden |
| `/case appeal` | ⏳ Spalten vorhanden |
| Aufhebung fremder Verknüpfungen per Command (`verification.revoke_any`) | ⏳ Service + API vorhanden |
| Benachrichtigungen in den Audit-Kanal | ⏳ Kanal konfigurierbar, Versand fehlt |
| Discord-Fraktionsrollen | bewusst manuell |

## Phase 4 – Roblox-Integration 🟡
Game-API vollständig und getestet. Luau-Skripte geschrieben. **Offen:** Test in Roblox Studio und einer
Test-Experience, `luau-analyze`, eigene Dienst-UI im Spiel.

## Phase 5 – Qualität und Livebetrieb 🟡
Tests, Sicherheitsübersicht, Backup-/Restore-Skripte, Monitoring-Endpunkte, Deployment-Anleitung vorhanden.
CI-Workflow (`.github/workflows/ci.yml`) angelegt, Lauf auf GitHub noch nicht beobachtet.
**Offen:** Docker-Build verifizieren, Staging aufsetzen,
Restore-Test protokollieren, externer Security-Review.

## Phase 6 – Erweiterungen ⏳
Web-Dashboard (Next.js, Login per Discord OAuth, nutzt `INTERNAL_API_TOKEN`-Routen bzw. eigene Session-Auth),
erweiterte Statistiken, Datenexport, Redis (verteilte Rate-Limits, Caching), Spielevents (`/gameevent …`),
erweiterte Berichte.
