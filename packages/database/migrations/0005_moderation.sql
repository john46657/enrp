-- Moderationsfälle (Discord und Spiel)

CREATE TYPE moderation_action AS ENUM ('warn', 'timeout', 'game_kick', 'game_ban');
CREATE TYPE case_status AS ENUM ('active', 'expired', 'revoked', 'appealed');

CREATE TABLE moderation_cases (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  guild_id         text NOT NULL,
  action           moderation_action NOT NULL,
  target_user_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  target_discord_id text,
  target_roblox_id bigint,
  moderator_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  reason           text NOT NULL CHECK (length(reason) BETWEEN 3 AND 1000),
  status           case_status NOT NULL DEFAULT 'active',
  expires_at       timestamptz,
  command_job_id   uuid,
  appeal_text      text,
  appealed_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT moderation_cases_target CHECK (target_user_id IS NOT NULL OR target_discord_id IS NOT NULL OR target_roblox_id IS NOT NULL)
);
CREATE INDEX moderation_cases_target_idx ON moderation_cases (target_user_id, created_at DESC);
CREATE INDEX moderation_cases_roblox_idx ON moderation_cases (target_roblox_id, created_at DESC);
