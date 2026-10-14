-- MTG Event backend schema (MySQL 8 / MariaDB 10.4+)
-- Import once in cPanel -> phpMyAdmin -> (your database) -> Import.
-- Safe to re-run: every table uses IF NOT EXISTS.

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS users (
  id            CHAR(36)     NOT NULL,
  email         VARCHAR(190) NOT NULL,
  name          VARCHAR(100) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at    BIGINT       NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- one row per signed-in device; only a SHA-256 of the token is stored
CREATE TABLE IF NOT EXISTS sessions (
  token_hash   CHAR(64)     NOT NULL,
  user_id      CHAR(36)     NOT NULL,
  device_name  VARCHAR(100) NOT NULL DEFAULT '',
  created_at   BIGINT       NOT NULL,
  last_used_at BIGINT       NOT NULL,
  PRIMARY KEY (token_hash),
  KEY ix_sessions_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS login_attempts (
  id         BIGINT      NOT NULL AUTO_INCREMENT,
  ip         VARCHAR(64) NOT NULL,
  created_at BIGINT      NOT NULL,
  PRIMARY KEY (id),
  KEY ix_attempts_ip (ip, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- a league = one group/bar. "groups" is a reserved word in MySQL 8, hence "leagues"
CREATE TABLE IF NOT EXISTS leagues (
  id         CHAR(36)     NOT NULL,
  slug       VARCHAR(60)  NOT NULL,
  name       VARCHAR(120) NOT NULL,
  is_public  TINYINT(1)   NOT NULL DEFAULT 1,
  seq        BIGINT       NOT NULL DEFAULT 0,  -- change counter used by sync
  created_by CHAR(36)     NOT NULL,
  created_at BIGINT       NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_leagues_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS memberships (
  league_id  CHAR(36)    NOT NULL,
  user_id    CHAR(36)    NOT NULL,
  role       VARCHAR(16) NOT NULL,  -- 'owner' | 'organizer'
  created_at BIGINT      NOT NULL,
  PRIMARY KEY (league_id, user_id),
  KEY ix_memberships_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS invites (
  code       VARCHAR(16) NOT NULL,
  league_id  CHAR(36)    NOT NULL,
  role       VARCHAR(16) NOT NULL,
  created_by CHAR(36)    NOT NULL,
  created_at BIGINT      NOT NULL,
  expires_at BIGINT      NOT NULL,
  uses_left  INT         NOT NULL,
  PRIMARY KEY (code),
  KEY ix_invites_league (league_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- synced documents ----------------------------------------------------------

CREATE TABLE IF NOT EXISTS players (
  league_id  CHAR(36)     NOT NULL,
  id         CHAR(36)     NOT NULL,
  name       VARCHAR(120) NOT NULL,
  legacy     TEXT         NULL,       -- JSON
  created_at BIGINT       NOT NULL,
  updated_at BIGINT       NOT NULL,   -- client clock, used to pick the newer edit
  seq        BIGINT       NOT NULL,   -- league change counter when last written
  PRIMARY KEY (league_id, id),
  KEY ix_players_seq (league_id, seq)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS events (
  league_id  CHAR(36)    NOT NULL,
  id         CHAR(36)    NOT NULL,
  status     VARCHAR(16) NOT NULL,
  date       BIGINT      NOT NULL,
  data       LONGTEXT    NOT NULL,    -- the whole event as JSON
  updated_at BIGINT      NOT NULL,
  seq        BIGINT      NOT NULL,
  runner_device VARCHAR(100) NULL,    -- which phone is running it (hand-off)
  PRIMARY KEY (league_id, id),
  KEY ix_events_seq (league_id, seq),
  KEY ix_events_status (league_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS deletions (
  league_id  CHAR(36)    NOT NULL,
  kind       VARCHAR(16) NOT NULL,    -- 'event' | 'player'
  id         CHAR(36)    NOT NULL,
  deleted_at BIGINT      NOT NULL,
  seq        BIGINT      NOT NULL,
  PRIMARY KEY (league_id, kind, id),
  KEY ix_deletions_seq (league_id, seq)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- league-wide settings shared by every organizer (e.g. 'seasons')
CREATE TABLE IF NOT EXISTS league_settings (
  league_id  CHAR(36)    NOT NULL,
  name       VARCHAR(60) NOT NULL,
  value      MEDIUMTEXT  NOT NULL,    -- JSON
  updated_at BIGINT      NOT NULL,
  seq        BIGINT      NOT NULL,
  PRIMARY KEY (league_id, name),
  KEY ix_settings_seq (league_id, seq)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
