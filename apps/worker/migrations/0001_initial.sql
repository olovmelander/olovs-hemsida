-- Banvy D1 initial schema: Better Auth core tables + player stats & sync tables.
-- Applied locally via `npm run db:migrate:local` and remotely via `npm run db:migrate:remote`.

PRAGMA foreign_keys = ON;

-- ------------------------------------------------------------------ Better Auth
CREATE TABLE IF NOT EXISTS user (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  email_verified INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY NOT NULL,
  expires_at INTEGER NOT NULL,
  token TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_session_user_id ON session(user_id);

CREATE TABLE IF NOT EXISTS account (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  access_token TEXT,
  refresh_token TEXT,
  id_token TEXT,
  access_token_expires_at INTEGER,
  refresh_token_expires_at INTEGER,
  scope TEXT,
  password TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_account_user_id ON account(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_account_provider_account ON account(provider_id, account_id);

CREATE TABLE IF NOT EXISTS verification (
  id TEXT PRIMARY KEY NOT NULL,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER,
  updated_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_verification_identifier ON verification(identifier);

-- ---------------------------------------------------------- Banvy player data
-- Synced cross-device state: handicap and caddie bag. Graphics/display
-- preferences stay strictly local per device.
CREATE TABLE IF NOT EXISTS player_profile (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  handicap INTEGER,
  handicap_updated_at INTEGER NOT NULL DEFAULT 0,
  bag_json TEXT,
  bag_updated_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

-- Completed/edited IRL rounds. Normalized summary columns enable SQL analytics
-- and course leaderboards while record_json preserves exact map-rounds.mjs shape.
CREATE TABLE IF NOT EXISTS rounds (
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  course_slug TEXT NOT NULL,
  round_id INTEGER NOT NULL,
  course_name TEXT NOT NULL,
  played_date TEXT NOT NULL,
  ended_at INTEGER,
  tee TEXT,
  handicap INTEGER,
  hole_count INTEGER NOT NULL DEFAULT 18,
  holes_played INTEGER NOT NULL DEFAULT 0,
  strokes INTEGER NOT NULL DEFAULT 0,
  to_par INTEGER NOT NULL DEFAULT 0,
  points INTEGER,
  putts INTEGER NOT NULL DEFAULT 0,
  fairways_hit INTEGER NOT NULL DEFAULT 0,
  fairways_tried INTEGER NOT NULL DEFAULT 0,
  greens_hit INTEGER NOT NULL DEFAULT 0,
  greens_tried INTEGER NOT NULL DEFAULT 0,
  record_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  PRIMARY KEY (user_id, course_slug, round_id)
);
CREATE INDEX IF NOT EXISTS idx_rounds_user_date ON rounds(user_id, played_date DESC);
CREATE INDEX IF NOT EXISTS idx_rounds_user_updated ON rounds(user_id, updated_at DESC);

-- Versioned shot-set metadata per (user, course, round) so deletes and edits
-- (like changing a club or putt count) sync atomically without resurrecting shots.
CREATE TABLE IF NOT EXISTS round_shot_sets (
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  course_slug TEXT NOT NULL,
  round_id INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  PRIMARY KEY (user_id, course_slug, round_id)
);

-- Individual GPS-locked shots for a round. Normalized columns allow SQL club
-- distance/penalty queries; shot_json preserves exact map-shots.mjs fields.
CREATE TABLE IF NOT EXISTS shots (
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  course_slug TEXT NOT NULL,
  round_id INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  hole INTEGER NOT NULL,
  club TEXT NOT NULL,
  at INTEGER NOT NULL,
  length_m REAL,
  outcome TEXT NOT NULL,
  penalty INTEGER NOT NULL DEFAULT 0,
  is_putt INTEGER NOT NULL DEFAULT 0,
  suspect INTEGER NOT NULL DEFAULT 0,
  from_lie TEXT,
  to_lie TEXT,
  shot_json TEXT NOT NULL,
  PRIMARY KEY (user_id, course_slug, round_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_shots_user_club ON shots(user_id, club);
