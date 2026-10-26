-- Roblox-Integration: Server, Ereignisse, Admin-Aufträge

CREATE TABLE game_servers (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- game.JobId der Roblox-Serverinstanz
  job_id           text NOT NULL UNIQUE CHECK (length(job_id) BETWEEN 1 AND 64),
  place_id         bigint NOT NULL,
  place_version    integer,
  player_count     integer NOT NULL DEFAULT 0 CHECK (player_count >= 0),
  max_players      integer CHECK (max_players >= 0),
  maintenance      boolean NOT NULL DEFAULT false,
  first_seen_at    timestamptz NOT NULL DEFAULT now(),
  last_heartbeat_at timestamptz NOT NULL DEFAULT now(),
  shutdown_at      timestamptz
);
CREATE INDEX game_servers_heartbeat_idx ON game_servers (last_heartbeat_at DESC);

-- Aktuelle Spieler je Server (aus Heartbeats), für /server players
CREATE TABLE game_server_players (
  game_server_id   uuid NOT NULL REFERENCES game_servers(id) ON DELETE CASCADE,
  roblox_user_id   bigint NOT NULL,
  joined_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (game_server_id, roblox_user_id)
);

CREATE TABLE game_events (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  game_server_id   uuid NOT NULL REFERENCES game_servers(id) ON DELETE CASCADE,
  -- vom Spielserver erzeugte eindeutige ID (HttpService:GenerateGUID) => Idempotenz
  event_id         text NOT NULL CHECK (length(event_id) BETWEEN 8 AND 64),
  type             text NOT NULL CHECK (type ~ '^[a-z_.]{1,48}$'),
  roblox_user_id   bigint,
  payload          jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at      timestamptz NOT NULL,
  received_at      timestamptz NOT NULL DEFAULT now(),
  processing_result text,
  CONSTRAINT game_events_event_uq UNIQUE (event_id)
);
CREATE INDEX game_events_type_idx ON game_events (type, received_at DESC);
CREATE INDEX game_events_user_idx ON game_events (roblox_user_id, received_at DESC);

CREATE TYPE command_job_status AS ENUM ('pending', 'claimed', 'succeeded', 'failed', 'expired', 'cancelled');

CREATE TABLE command_jobs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type             text NOT NULL CHECK (type IN ('announce', 'kick', 'ban', 'unban', 'restart_announce')),
  payload          jsonb NOT NULL,
  -- NULL = beliebiger Server darf ausführen; für Broadcasts siehe fanout
  target_job_id    text,
  -- broadcast: jeder aktive Server führt aus und meldet separat (command_job_results)
  broadcast        boolean NOT NULL DEFAULT false,
  status           command_job_status NOT NULL DEFAULT 'pending',
  created_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  claimed_by       text,
  claimed_at       timestamptz,
  lease_until      timestamptz,
  attempts         integer NOT NULL DEFAULT 0,
  completed_at     timestamptz,
  result           jsonb,
  CONSTRAINT command_jobs_expiry CHECK (expires_at > created_at AND expires_at <= created_at + interval '1 hour')
);
CREATE INDEX command_jobs_pending_idx ON command_jobs (created_at) WHERE status IN ('pending', 'claimed');

-- Ergebnis je Server bei Broadcast-Aufträgen (idempotent über PK)
CREATE TABLE command_job_results (
  command_job_id   uuid NOT NULL REFERENCES command_jobs(id) ON DELETE CASCADE,
  job_id           text NOT NULL,
  success          boolean NOT NULL,
  message          text,
  reported_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (command_job_id, job_id)
);

-- Globale Spieleinstellungen, die jeder Server mit der Heartbeat-Antwort erhält (z. B. Wartungsmodus).
CREATE TABLE game_settings (
  key              text PRIMARY KEY CHECK (key ~ '^[a-z_]{1,32}$'),
  value            jsonb NOT NULL,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid REFERENCES users(id) ON DELETE SET NULL
);
INSERT INTO game_settings (key, value) VALUES ('maintenance', '{"enabled": false, "message": null}');

ALTER TABLE duty_sessions ADD CONSTRAINT duty_sessions_server_fk FOREIGN KEY (game_server_id) REFERENCES game_servers(id) ON DELETE SET NULL;
ALTER TABLE moderation_cases ADD CONSTRAINT moderation_cases_job_fk FOREIGN KEY (command_job_id) REFERENCES command_jobs(id) ON DELETE SET NULL;
