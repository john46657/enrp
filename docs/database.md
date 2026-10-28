# Datenbank und Migrationen

> **Geplant für Phase 2.** In Phase 1 gibt es noch keine Datenbank; `/ready` meldet sie als
> `not_configured`.

Vorgesehen:

- **PostgreSQL 16+**, Verbindung über `DATABASE_URL` (Platzhalter steht auskommentiert in `.env.example`).
- **Versionierte Migrationen** im Repository; jede Änderung am Schema ist eine neue, nummerierte
  Migrationsdatei. Bereits ausgerollte Migrationen werden nie nachträglich geändert.
- Die Datenzugriffsbibliothek wird zu Beginn von Phase 2 anhand aktueller Pflege und TypeScript-Unterstützung
  ausgewählt und hier begründet.
- Befehle für „Migrationen ausführen“, „Status anzeigen“ und das Vorgehen bei Rollbacks werden mit
  Phase 2 hier dokumentiert.
- Tests für Migrationen laufen gegen eine echte, temporäre PostgreSQL-Datenbank.
