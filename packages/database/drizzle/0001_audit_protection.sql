-- Schutz des Audit-Logs: Änderungen und Löschungen sind nur in einer ausdrücklich markierten
-- Wartungssitzung erlaubt (SET LOCAL enrp.audit_maintenance = 'on'), z. B. für Aufbewahrungsfristen.
-- In Produktion zusätzlich: Die Anwendung verbindet sich mit einer Rolle ohne UPDATE/DELETE/TRUNCATE
-- auf audit_events (siehe docs/security.md). Die Hash-Kette erkennt Manipulationen unabhängig davon.
CREATE OR REPLACE FUNCTION enrp_protect_audit() RETURNS trigger AS $$
BEGIN
  IF coalesce(current_setting('enrp.audit_maintenance', true), '') = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    IF TG_OP = 'TRUNCATE' THEN RETURN NULL; END IF;
    RAISE EXCEPTION 'audit_events ist unveränderlich (auch in Wartungssitzungen sind nur Löschungen erlaubt)';
  END IF;
  RAISE EXCEPTION 'audit_events ist unveränderlich (% blockiert)', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_events_no_update BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION enrp_protect_audit();
--> statement-breakpoint
CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION enrp_protect_audit();
