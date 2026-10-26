# Emden Network – Web-Dashboard (Phase 6, noch nicht umgesetzt)

Dieses Verzeichnis ist für das spätere Next.js-Dashboard reserviert. Es enthält absichtlich **keinen** Code:
ein halbfertiges Dashboard mit Platzhalter-Login wäre ein Sicherheitsrisiko.

Geplante Eckpunkte:

- Next.js (App Router) als eigenes Workspace-Paket `@emden-network/dashboard`.
- Anmeldung über **Discord OAuth 2.0** (Scope `identify`), serverseitige Sessions, Rollen über
  `guild_config.role_map` + Discord-Rollen des Nutzers (identische Matrix wie der Bot, `@emden-network/shared`).
- Geschäftslogik ausschließlich über `@emden-network/core`. Jede Aktion prüft dort die Berechtigung erneut.
- Ansichten: Fraktionsübersicht, Dienststatistiken, Audit-Log, Moderationsfälle, Serverstatus, Konfiguration.
