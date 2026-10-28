-- Emden Network – Migration 0001: Rollen, Berechtigungen, Benutzer, Sitzungen und Audit-Log
--
-- Regeln für Migrationen:
--   * Eine bereits angewendete Migration wird NIE mehr verändert (das Migrationsprogramm erkennt das
--     anhand einer Prüfsumme und bricht ab). Änderungen am Schema kommen immer in eine neue Datei.
--   * Jede Datei läuft in einer eigenen Transaktion: entweder vollständig oder gar nicht.

-- ---------------------------------------------------------------------------------------------------
-- Rollen und Berechtigungen
-- ---------------------------------------------------------------------------------------------------

CREATE TABLE roles (
  key          text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]{1,31}$'),
  name         text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 64),
  description  text NOT NULL DEFAULT '',
  -- Höherer Rang = mehr Befugnis. Verwaltet werden darf nur, wer einen niedrigeren Rang hat.
  rank         smallint NOT NULL UNIQUE CHECK (rank BETWEEN 1 AND 1000),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE permissions (
  key          text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  category     text NOT NULL,
  description  text NOT NULL
);

CREATE TABLE role_permissions (
  role_key        text NOT NULL REFERENCES roles (key) ON DELETE CASCADE,
  permission_key  text NOT NULL REFERENCES permissions (key) ON DELETE CASCADE,
  PRIMARY KEY (role_key, permission_key)
);

-- ---------------------------------------------------------------------------------------------------
-- Benutzer des Control Centers (Anmeldung per Discord, daher kein Passwort)
-- ---------------------------------------------------------------------------------------------------

CREATE TABLE users (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Discord-Benutzer-IDs ("Snowflakes") sind Zahlen mit 17 bis 20 Stellen.
  discord_user_id  text NOT NULL UNIQUE CHECK (discord_user_id ~ '^[0-9]{17,20}$'),
  display_name     text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 64),
  role_key         text NOT NULL REFERENCES roles (key),
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  last_login_at    timestamptz,
  created_by       uuid REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX users_role_key_idx ON users (role_key);

CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------------------------------
-- Sitzungen: gespeichert wird nur ein SHA-256-Hash des Sitzungstokens, nie das Token selbst.
-- ---------------------------------------------------------------------------------------------------

CREATE TABLE sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash    text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  CHECK (expires_at > created_at)
);

CREATE INDEX sessions_user_id_idx ON sessions (user_id);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);

-- ---------------------------------------------------------------------------------------------------
-- Audit-Log: nachvollziehbare Protokollierung kritischer Aktionen
-- ---------------------------------------------------------------------------------------------------

CREATE TABLE audit_log (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  -- user = angemeldeter Benutzer, system = das Backend selbst, cli = Befehl im Terminal
  actor_type     text NOT NULL CHECK (actor_type IN ('user', 'system', 'cli')),
  -- RESTRICT: Benutzer mit Audit-Einträgen können nicht gelöscht, nur gesperrt werden.
  actor_user_id  uuid REFERENCES users (id) ON DELETE RESTRICT,
  -- Name zum Zeitpunkt der Aktion, damit der Eintrag auch später lesbar bleibt.
  actor_label    text NOT NULL CHECK (char_length(actor_label) BETWEEN 1 AND 128),
  action         text NOT NULL CHECK (action ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  outcome        text NOT NULL CHECK (outcome IN ('success', 'denied', 'failure')),
  target_type    text,
  target_id      text,
  -- Nur unkritische Zusatzinformationen, niemals Tokens oder Geheimnisse.
  details        jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  request_id     text,
  CHECK ((actor_type = 'user') = (actor_user_id IS NOT NULL))
);

CREATE INDEX audit_log_occurred_at_idx ON audit_log (occurred_at DESC);
CREATE INDEX audit_log_actor_user_id_idx ON audit_log (actor_user_id);
CREATE INDEX audit_log_action_idx ON audit_log (action);

-- Audit-Einträge sind unveränderlich. Löschen ist nur für die Aufbewahrungsfrist vorgesehen.
CREATE FUNCTION audit_log_prevent_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Audit-Einträge dürfen nicht verändert werden';
END;
$$;

CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_prevent_update();

-- ---------------------------------------------------------------------------------------------------
-- Startdaten: Systemrollen, Berechtigungen und deren Standardzuordnung
-- (muss zu packages/shared/src/permissions.ts passen – ein Test prüft das)
-- ---------------------------------------------------------------------------------------------------

INSERT INTO roles (key, name, description, rank) VALUES
  ('owner', 'Owner', 'Vollzugriff auf alles. Wird nur über die gesicherte Ersteinrichtung vergeben.', 100),
  ('administrator', 'Administrator', 'Verwaltet Benutzer, Rollen und Berechtigungen.', 80),
  ('moderator', 'Moderator', 'Moderiert Spiel und Discord.', 60),
  ('support', 'Support', 'Hilft Spielern und sieht Informationen ein.', 40),
  ('viewer', 'Viewer', 'Darf das Control Center nur ansehen.', 20);

INSERT INTO permissions (key, category, description) VALUES
  ('users.read', 'Benutzer und Rollen', 'Benutzerliste ansehen'),
  ('users.manage', 'Benutzer und Rollen', 'Benutzer freischalten, sperren und Rollen zuweisen'),
  ('roles.read', 'Benutzer und Rollen', 'Rollen und ihre Berechtigungen ansehen'),
  ('roles.manage', 'Benutzer und Rollen', 'Berechtigungen von Rollen ändern'),
  ('audit.read', 'Audit-Log', 'Audit-Log ansehen');

INSERT INTO role_permissions (role_key, permission_key) VALUES
  ('administrator', 'users.read'),
  ('administrator', 'users.manage'),
  ('administrator', 'roles.read'),
  ('administrator', 'roles.manage'),
  ('administrator', 'audit.read'),
  ('moderator', 'users.read'),
  ('moderator', 'roles.read'),
  ('support', 'users.read');
