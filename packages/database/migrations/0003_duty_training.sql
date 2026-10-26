-- Dienstsystem und Ausbildungen

CREATE TYPE duty_source AS ENUM ('discord', 'game');

CREATE TABLE duty_sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  faction_id         uuid NOT NULL REFERENCES factions(id) ON DELETE RESTRICT,
  source             duty_source NOT NULL,
  started_at         timestamptz NOT NULL,
  ended_at           timestamptz,
  -- Idempotenz: Event-IDs des Spielservers bzw. der Discord-Interaktion
  start_event_id     text,
  end_event_id       text,
  game_server_id     uuid,
  corrected_at       timestamptz,
  corrected_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  correction_reason  text,
  original_started_at timestamptz,
  original_ended_at  timestamptz,
  CONSTRAINT duty_sessions_time_order CHECK (ended_at IS NULL OR ended_at >= started_at),
  -- Plausibilitätsgrenze: eine Sitzung dauert höchstens 24 Stunden
  CONSTRAINT duty_sessions_max_length CHECK (ended_at IS NULL OR ended_at - started_at <= interval '24 hours'),
  CONSTRAINT duty_sessions_correction CHECK (corrected_at IS NULL OR correction_reason IS NOT NULL)
);
-- Höchstens eine offene Dienstsitzung je Nutzer
CREATE UNIQUE INDEX duty_sessions_open_user_uq ON duty_sessions (user_id) WHERE ended_at IS NULL;
CREATE UNIQUE INDEX duty_sessions_start_event_uq ON duty_sessions (start_event_id) WHERE start_event_id IS NOT NULL;
CREATE UNIQUE INDEX duty_sessions_end_event_uq ON duty_sessions (end_event_id) WHERE end_event_id IS NOT NULL;
CREATE INDEX duty_sessions_faction_open_idx ON duty_sessions (faction_id) WHERE ended_at IS NULL;
CREATE INDEX duty_sessions_user_time_idx ON duty_sessions (user_id, started_at DESC);

CREATE TYPE training_status AS ENUM ('scheduled', 'running', 'completed', 'cancelled');

CREATE TABLE trainings (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  faction_id     uuid NOT NULL REFERENCES factions(id) ON DELETE RESTRICT,
  title          text NOT NULL CHECK (length(title) BETWEEN 3 AND 100),
  description    text CHECK (length(description) <= 2000),
  scheduled_at   timestamptz NOT NULL,
  status         training_status NOT NULL DEFAULT 'scheduled',
  created_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX trainings_faction_idx ON trainings (faction_id, scheduled_at DESC);

CREATE TYPE attendance_status AS ENUM ('registered', 'attended', 'passed', 'failed');

CREATE TABLE training_attendance (
  training_id    uuid NOT NULL REFERENCES trainings(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status         attendance_status NOT NULL DEFAULT 'registered',
  registered_at  timestamptz NOT NULL DEFAULT now(),
  completed_at   timestamptz,
  completed_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (training_id, user_id)
);
