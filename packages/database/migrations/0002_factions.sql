-- Fraktionen, Ränge und Mitgliedschaften. Fraktionsrollen werden manuell verwaltet,
-- niemals aus OAuth-Daten abgeleitet.

CREATE TABLE factions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key                text NOT NULL UNIQUE CHECK (key ~ '^[a-z_]{2,32}$'),
  name               text NOT NULL,
  -- Berechtigungsrolle der Fraktionsleitung (Schlüssel aus guild_config.role_map), NULL bei Zivilisten
  leadership_role    text,
  discord_role_id    text CHECK (discord_role_id ~ '^[0-9]{17,20}$'),
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE faction_ranks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  faction_id    uuid NOT NULL REFERENCES factions(id) ON DELETE CASCADE,
  key           text NOT NULL CHECK (key ~ '^[a-z0-9_]{1,32}$'),
  name          text NOT NULL,
  -- höher = ranghöher
  level         integer NOT NULL CHECK (level BETWEEN 1 AND 100),
  CONSTRAINT faction_ranks_key_uq UNIQUE (faction_id, key),
  CONSTRAINT faction_ranks_level_uq UNIQUE (faction_id, level),
  CONSTRAINT faction_ranks_id_faction_uq UNIQUE (id, faction_id)
);

CREATE TABLE faction_members (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  faction_id    uuid NOT NULL REFERENCES factions(id) ON DELETE RESTRICT,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rank_id       uuid NOT NULL,
  joined_at     timestamptz NOT NULL DEFAULT now(),
  left_at       timestamptz,
  left_reason   text,
  -- Rang muss zur Fraktion gehören
  CONSTRAINT faction_members_rank_fk FOREIGN KEY (rank_id, faction_id) REFERENCES faction_ranks(id, faction_id) ON DELETE RESTRICT,
  CONSTRAINT faction_members_left CHECK (left_at IS NULL OR left_at >= joined_at)
);
-- Ein Nutzer ist höchstens in einer Fraktion gleichzeitig aktiv.
CREATE UNIQUE INDEX faction_members_active_user_uq ON faction_members (user_id) WHERE left_at IS NULL;
CREATE INDEX faction_members_faction_idx ON faction_members (faction_id) WHERE left_at IS NULL;

-- Stammdaten der vier Fraktionen von Emden Network
INSERT INTO factions (key, name, leadership_role) VALUES
  ('polizei', 'Polizei', 'polizeileitung'),
  ('feuerwehr', 'Feuerwehr', 'feuerwehrleitung'),
  ('rettungsdienst', 'Rettungsdienst', 'rettungsdienstleitung'),
  ('zivil', 'Zivilisten', NULL);

INSERT INTO faction_ranks (faction_id, key, name, level)
SELECT f.id, r.key, r.name, r.level FROM factions f
JOIN (VALUES
  ('polizei', 'anwaerter', 'Polizeianwärter', 1),
  ('polizei', 'kommissar', 'Polizeikommissar', 10),
  ('polizei', 'oberkommissar', 'Polizeioberkommissar', 20),
  ('polizei', 'hauptkommissar', 'Polizeihauptkommissar', 30),
  ('polizei', 'rat', 'Polizeirat', 40),
  ('feuerwehr', 'anwaerter', 'Feuerwehrmann-Anwärter', 1),
  ('feuerwehr', 'feuerwehrmann', 'Feuerwehrmann', 10),
  ('feuerwehr', 'oberfeuerwehrmann', 'Oberfeuerwehrmann', 20),
  ('feuerwehr', 'brandmeister', 'Brandmeister', 30),
  ('feuerwehr', 'brandinspektor', 'Brandinspektor', 40),
  ('rettungsdienst', 'helfer', 'Rettungshelfer', 1),
  ('rettungsdienst', 'sanitaeter', 'Rettungssanitäter', 10),
  ('rettungsdienst', 'notfallsanitaeter', 'Notfallsanitäter', 20),
  ('rettungsdienst', 'notarzt', 'Notarzt', 30),
  ('rettungsdienst', 'leitender_notarzt', 'Leitender Notarzt', 40),
  ('zivil', 'buerger', 'Bürger', 1)
) AS r(faction_key, key, name, level) ON r.faction_key = f.key;
