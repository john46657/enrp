-- Emden Network – Kern: Nutzer, Account-Verknüpfungen, OAuth-Sessions, Audit, Konfiguration, Outbox.
-- Alle Zeitstempel sind timestamptz (intern UTC). Discord- und Roblox-IDs sind Snowflakes bzw.
-- 64-Bit-Ganzzahlen und werden als Text (Discord) bzw. bigint (Roblox) gespeichert.

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  discord_id    text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_discord_id_format CHECK (discord_id ~ '^[0-9]{17,20}$'),
  CONSTRAINT users_discord_id_unique UNIQUE (discord_id)
);

-- Verknüpfung Discord-Nutzer <-> Roblox-Account. Historie bleibt erhalten (revoked_at),
-- aktiv ist eine Verknüpfung genau dann, wenn revoked_at NULL ist.
CREATE TABLE discord_links (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  roblox_user_id       bigint NOT NULL CHECK (roblox_user_id > 0),
  -- Anzeigedaten aus dem userinfo-Endpunkt. Veränderlich, NIE als Identifikator verwenden.
  roblox_username      text,
  roblox_display_name  text,
  linked_at            timestamptz NOT NULL DEFAULT now(),
  revoked_at           timestamptz,
  revoked_reason       text,
  CONSTRAINT discord_links_revoked_reason CHECK (revoked_at IS NULL OR revoked_reason IS NOT NULL)
);
-- Eindeutigkeit aktiver Verknüpfungen in beide Richtungen.
CREATE UNIQUE INDEX discord_links_active_roblox_uq ON discord_links (roblox_user_id) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX discord_links_active_user_uq   ON discord_links (user_id)        WHERE revoked_at IS NULL;
CREATE INDEX discord_links_roblox_idx ON discord_links (roblox_user_id);

-- created: Link erzeugt | started: Weiterleitung zu Roblox | exchanging: Callback angenommen (einmalig) | completed/failed: Endzustand
CREATE TYPE oauth_session_status AS ENUM ('created', 'started', 'exchanging', 'completed', 'failed');

-- Kurzlebige OAuth-Sessions. Es werden nur Hashes von start_token, state und Browser-Bindung gespeichert.
-- Der PKCE-code_verifier muss für den Token-Austausch im Klartext vorliegen und wird nach
-- Abschluss sofort auf NULL gesetzt.
CREATE TABLE oauth_verification_sessions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  discord_id            text NOT NULL CHECK (discord_id ~ '^[0-9]{17,20}$'),
  guild_id              text NOT NULL CHECK (guild_id ~ '^[0-9]{17,20}$'),
  status                oauth_session_status NOT NULL DEFAULT 'created',
  start_token_hash      bytea NOT NULL,
  state_hash            bytea,
  browser_binding_hash  bytea,
  code_verifier         text,
  failure_code          text,
  roblox_user_id        bigint,
  created_at            timestamptz NOT NULL DEFAULT now(),
  started_at            timestamptz,
  completed_at          timestamptz,
  expires_at            timestamptz NOT NULL,
  CONSTRAINT oauth_sessions_start_token_uq UNIQUE (start_token_hash),
  CONSTRAINT oauth_sessions_state_uq UNIQUE (state_hash),
  CONSTRAINT oauth_sessions_started_has_state CHECK (status <> 'started' OR (state_hash IS NOT NULL AND code_verifier IS NOT NULL AND browser_binding_hash IS NOT NULL)),
  CONSTRAINT oauth_sessions_finished_no_verifier CHECK (status NOT IN ('completed', 'failed') OR code_verifier IS NULL)
);
CREATE INDEX oauth_sessions_discord_idx ON oauth_verification_sessions (discord_id, created_at DESC);
CREATE INDEX oauth_sessions_expires_idx ON oauth_verification_sessions (expires_at);

-- Audit-Log: append-only. Personenbezug nur über interne/Discord-IDs, keine Freitext-Secrets.
CREATE TABLE audit_logs (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at      timestamptz NOT NULL DEFAULT now(),
  actor_type       text NOT NULL CHECK (actor_type IN ('discord_user', 'system', 'game_server', 'api')),
  actor_id         text,
  action           text NOT NULL CHECK (action ~ '^[a-z0-9_.]+$'),
  target_type      text,
  target_id        text,
  guild_id         text,
  outcome          text NOT NULL DEFAULT 'success' CHECK (outcome IN ('success', 'denied', 'failure')),
  reason           text,
  metadata         jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX audit_logs_occurred_idx ON audit_logs (occurred_at DESC);
CREATE INDEX audit_logs_actor_idx    ON audit_logs (actor_type, actor_id, occurred_at DESC);
CREATE INDEX audit_logs_target_idx   ON audit_logs (target_type, target_id, occurred_at DESC);
CREATE INDEX audit_logs_action_idx   ON audit_logs (action, occurred_at DESC);

-- Konfiguration je Discord-Server. Rollen-IDs werden hier hinterlegt (nicht im Code).
CREATE TABLE guild_config (
  guild_id             text PRIMARY KEY CHECK (guild_id ~ '^[0-9]{17,20}$'),
  verified_role_id     text CHECK (verified_role_id ~ '^[0-9]{17,20}$'),
  unverified_role_id   text CHECK (unverified_role_id ~ '^[0-9]{17,20}$'),
  -- Zuordnung Berechtigungsrolle -> Discord-Rollen-ID, z. B. {"owner":"123...","moderator":"456..."}
  role_map             jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(role_map) = 'object'),
  audit_channel_id     text CHECK (audit_channel_id ~ '^[0-9]{17,20}$'),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           text
);

-- Transaktionale Outbox: Nebenwirkungen (Rollenvergabe, DMs) werden in derselben Transaktion wie die
-- fachliche Änderung angelegt und von einem Worker mit Wiederholungen abgearbeitet.
CREATE TYPE outbox_status AS ENUM ('pending', 'processing', 'done', 'failed');

CREATE TABLE outbox_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type             text NOT NULL CHECK (type ~ '^[a-z0-9_.]+$'),
  payload          jsonb NOT NULL,
  status           outbox_status NOT NULL DEFAULT 'pending',
  attempts         integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts     integer NOT NULL DEFAULT 8 CHECK (max_attempts > 0),
  available_at     timestamptz NOT NULL DEFAULT now(),
  locked_until     timestamptz,
  last_error       text,
  dedupe_key       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  processed_at     timestamptz
);
CREATE INDEX outbox_events_pending_idx ON outbox_events (available_at) WHERE status IN ('pending', 'processing');
CREATE UNIQUE INDEX outbox_events_dedupe_uq ON outbox_events (dedupe_key) WHERE dedupe_key IS NOT NULL AND status IN ('pending', 'processing');

-- Nicht benötigt: verification_codes. Die Verifizierung läuft ausschließlich über Roblox OAuth 2.0;
-- ein Code-basierter Ersatzprozess (z. B. Code ins Profil schreiben) ist bewusst nicht umgesetzt.
