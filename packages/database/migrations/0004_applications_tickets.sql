-- Bewerbungen und Support

CREATE TYPE application_status AS ENUM ('submitted', 'in_review', 'accepted', 'rejected', 'withdrawn');

CREATE TABLE applications (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  faction_id     uuid NOT NULL REFERENCES factions(id) ON DELETE RESTRICT,
  status         application_status NOT NULL DEFAULT 'submitted',
  assigned_to    uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  decision_reason text,
  submitted_at   timestamptz NOT NULL DEFAULT now(),
  decided_at     timestamptz,
  CONSTRAINT applications_decision CHECK ((status IN ('accepted', 'rejected')) = (decided_at IS NOT NULL))
);
-- Eine offene Bewerbung je Nutzer und Fraktion
CREATE UNIQUE INDEX applications_open_uq ON applications (user_id, faction_id) WHERE status IN ('submitted', 'in_review');
CREATE INDEX applications_faction_status_idx ON applications (faction_id, status, submitted_at);

CREATE TABLE application_answers (
  application_id bigint NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  question_key   text NOT NULL CHECK (question_key ~ '^[a-z0-9_]{1,32}$'),
  question       text NOT NULL,
  answer         text NOT NULL CHECK (length(answer) <= 4000),
  PRIMARY KEY (application_id, question_key)
);

CREATE TYPE ticket_status AS ENUM ('open', 'claimed', 'closed');

CREATE TABLE tickets (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  guild_id       text NOT NULL,
  channel_id     text UNIQUE,
  category       text NOT NULL CHECK (category ~ '^[a-z0-9_]{1,32}$'),
  creator_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  claimed_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  status         ticket_status NOT NULL DEFAULT 'open',
  -- bei Spielermeldungen (/report): gemeldeter Nutzer
  reported_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  close_reason   text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  closed_at      timestamptz,
  CONSTRAINT tickets_closed CHECK ((status = 'closed') = (closed_at IS NOT NULL))
);
CREATE INDEX tickets_status_idx ON tickets (status, created_at);
CREATE INDEX tickets_creator_idx ON tickets (creator_id, created_at DESC);

CREATE TABLE ticket_messages (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ticket_id      bigint NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  discord_message_id text,
  content        text NOT NULL CHECK (length(content) <= 4000),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ticket_messages_discord_uq UNIQUE (discord_message_id)
);
CREATE INDEX ticket_messages_ticket_idx ON ticket_messages (ticket_id, created_at);
