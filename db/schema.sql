-- ═══════════════════════════════════════════════════════════════
--  NUBIFLY — Esquema PostgreSQL (reemplazo de Firebase RTDB)
--  Ejecuta este archivo completo en tu base de datos Postgres.
--  El usuario cuyo email == ADMIN_EMAIL (variable de entorno) recibe
--  rol 'admin' automáticamente al registrarse / iniciar sesión.
-- ═══════════════════════════════════════════════════════════════

-- ─────────────── USUARIOS ───────────────
CREATE TABLE IF NOT EXISTS users (
  uid           TEXT PRIMARY KEY,
  type          TEXT NOT NULL DEFAULT 'user',      -- 'user' | 'guest'
  name          TEXT,
  username      TEXT UNIQUE,
  email         TEXT UNIQUE,
  avatar        TEXT,
  banner        TEXT,
  bio           TEXT,
  birthday      TEXT,
  location      TEXT,
  website       TEXT,
  is_online     BOOLEAN DEFAULT FALSE,
  last_seen     BIGINT,
  guest_data    JSONB,
  created_at    BIGINT,
  updated_at    BIGINT
);

-- controlUsers/{uid}: cuenta, seguridad, plan, permisos, moderación, ADMIN
CREATE TABLE IF NOT EXISTS control_users (
  uid             TEXT PRIMARY KEY REFERENCES users(uid) ON DELETE CASCADE,
  account_status  TEXT DEFAULT 'active',            -- active | suspended | banned | inactive
  role            TEXT DEFAULT 'user',              -- 'user' | 'admin'
  plan_type       TEXT DEFAULT 'gratis',            -- gratis | basico | pro | enterprise
  is_premium      BOOLEAN DEFAULT FALSE,
  plan_purchased_at BIGINT,
  plan_amount_paid  INTEGER,
  plan_currency   TEXT,
  plan_stripe     JSONB,
  max_api_keys       INTEGER DEFAULT 2,
  monthly_requests   BIGINT DEFAULT 1000,
  max_file_size_mb   INTEGER DEFAULT 50,
  password_hash      TEXT,
  login_attempts     INTEGER DEFAULT 0,
  last_failed_attempt BIGINT,
  last_login         BIGINT,
  last_ip            TEXT,
  device_count       INTEGER DEFAULT 0,
  two_factor_enabled BOOLEAN DEFAULT FALSE,
  two_factor_secret  TEXT,
  susp_is_suspended  BOOLEAN DEFAULT FALSE,
  susp_reason        TEXT,
  susp_until         BIGINT,
  susp_created_at    BIGINT,
  ban_is_banned      BOOLEAN DEFAULT FALSE,
  ban_reason         TEXT,
  ban_created_at     BIGINT,
  permissions   JSONB,
  verification  JSONB,
  moderation    JSONB,
  created_at    BIGINT,
  updated_at    BIGINT
);

-- ─────────────── PROYECTOS ───────────────
CREATE TABLE IF NOT EXISTS projects (
  project_id    TEXT PRIMARY KEY,
  owner_id      TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT,
  tags          JSONB,
  deadline      TEXT,
  access        TEXT DEFAULT 'private',
  api_key       TEXT,
  storage_used  BIGINT DEFAULT 0,
  created_at    BIGINT,
  updated_at    BIGINT
);
CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_id);

CREATE TABLE IF NOT EXISTS project_data (
  project_id  TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  data_key    TEXT NOT NULL,
  value       JSONB,
  PRIMARY KEY (project_id, data_key)
);

CREATE TABLE IF NOT EXISTS project_invites (
  invite_id   TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  from_uid    TEXT REFERENCES users(uid) ON DELETE SET NULL,
  to_uid      TEXT REFERENCES users(uid) ON DELETE SET NULL,
  status      TEXT DEFAULT 'pending',
  created_at  BIGINT
);
CREATE INDEX IF NOT EXISTS idx_invites_to ON project_invites(to_uid);

-- ─────────────── API KEYS ───────────────
CREATE TABLE IF NOT EXISTS user_api_keys (
  key_id           TEXT PRIMARY KEY,
  uid              TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  name             TEXT,
  api_key          TEXT,
  active           BOOLEAN DEFAULT TRUE,
  perm             TEXT,
  permissions      JSONB,
  project_id       TEXT REFERENCES projects(project_id) ON DELETE SET NULL,
  calls            BIGINT DEFAULT 0,
  uploads_count    BIGINT DEFAULT 0,
  last_used        BIGINT,
  last_upload_at   BIGINT,
  last_upload_name TEXT,
  created_at       BIGINT
);
CREATE INDEX IF NOT EXISTS idx_userkeys_uid ON user_api_keys(uid);

CREATE TABLE IF NOT EXISTS user_api_key_trash (
  key_id     TEXT PRIMARY KEY,
  uid        TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  data       JSONB,
  deleted_at BIGINT
);

-- Índices de búsqueda por clave (equivalen a apiKeyIndex / userApiKeyIndex)
CREATE TABLE IF NOT EXISTS api_key_index (
  api_key    TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(project_id) ON DELETE CASCADE,
  owner_id   TEXT REFERENCES users(uid) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS user_api_key_index (
  api_key  TEXT PRIMARY KEY,
  uid      TEXT REFERENCES users(uid) ON DELETE CASCADE,
  key_id   TEXT
);

-- ─────────────── ARCHIVOS / PUBLICACIONES ───────────────
CREATE TABLE IF NOT EXISTS files (
  file_id       TEXT PRIMARY KEY,
  owner_id      TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  project_id    TEXT REFERENCES projects(project_id) ON DELETE SET NULL,
  file_name     TEXT,
  original_name TEXT,
  title         TEXT,
  description   TEXT,
  author        TEXT,
  media_type    TEXT,           -- audio | video | image | file
  mime_type     TEXT,
  cover_url     TEXT,
  url           TEXT,
  storage_path  TEXT,
  file_size     BIGINT,
  source        TEXT,
  status        TEXT DEFAULT 'published',
  visibility    TEXT DEFAULT 'private',
  created_at    BIGINT,
  updated_at    BIGINT
);
CREATE INDEX IF NOT EXISTS idx_files_owner   ON files(owner_id);
CREATE INDEX IF NOT EXISTS idx_files_project ON files(project_id);
CREATE INDEX IF NOT EXISTS idx_files_type    ON files(media_type);

-- ─────────────── NOTIFICACIONES ───────────────
CREATE TABLE IF NOT EXISTS user_inbox (
  notif_id    TEXT PRIMARY KEY,
  uid         TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  tipo        TEXT,
  nivel       TEXT,
  origen      TEXT,
  emisor      TEXT,
  titulo      TEXT,
  mensaje     TEXT,
  accion      TEXT,
  recurso_id  TEXT,
  leida       BOOLEAN DEFAULT FALSE,
  read_at     BIGINT,
  expira      BIGINT,
  created_at  BIGINT
);
CREATE INDEX IF NOT EXISTS idx_inbox_uid ON user_inbox(uid);

CREATE TABLE IF NOT EXISTS notifications (
  notif_id    TEXT PRIMARY KEY,
  tipo        TEXT,
  nivel       TEXT,
  origen      TEXT DEFAULT 'sistema',
  titulo      TEXT,
  mensaje     TEXT,
  accion      TEXT,
  active      BOOLEAN DEFAULT TRUE,
  expira      BIGINT,
  created_by  TEXT REFERENCES users(uid) ON DELETE SET NULL,
  created_at  BIGINT
);

CREATE TABLE IF NOT EXISTS user_notifications (
  uid        TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  notif_id   TEXT NOT NULL,
  read       BOOLEAN DEFAULT FALSE,
  read_at    BIGINT,
  dismissed  BOOLEAN DEFAULT FALSE,
  PRIMARY KEY (uid, notif_id)
);

CREATE TABLE IF NOT EXISTS user_milestones (
  uid           TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  milestone_key TEXT NOT NULL,
  achieved      BOOLEAN DEFAULT TRUE,
  PRIMARY KEY (uid, milestone_key)
);

-- ─────────────── PAGOS / STRIPE ───────────────
CREATE TABLE IF NOT EXISTS stripe_processed (
  event_id    TEXT PRIMARY KEY,
  uid         TEXT REFERENCES users(uid) ON DELETE SET NULL,
  plan        TEXT,
  session_id  TEXT,
  email       TEXT,
  pending     BOOLEAN DEFAULT FALSE,
  ignored     BOOLEAN DEFAULT FALSE,
  ts          BIGINT
);

CREATE TABLE IF NOT EXISTS pending_upgrades (
  email_key    TEXT PRIMARY KEY,
  email        TEXT,
  plan         TEXT,
  plan_data    JSONB,
  limits       JSONB,
  session_id   TEXT,
  purchased_at BIGINT
);

-- ─────────────── SESIONES / SEGURIDAD ───────────────
CREATE TABLE IF NOT EXISTS guest_sessions (
  guest_id        TEXT PRIMARY KEY,
  uid             TEXT REFERENCES users(uid) ON DELETE CASCADE,
  token_hash      TEXT,
  device_id       TEXT,
  ip_address      TEXT,
  session_version INTEGER DEFAULT 1,
  created_at      BIGINT,
  expires_at      BIGINT
);

CREATE TABLE IF NOT EXISTS guest_rate_limit (
  ip_key       TEXT PRIMARY KEY,
  count        INTEGER DEFAULT 0,
  window_start BIGINT
);

CREATE TABLE IF NOT EXISTS token_blacklist (
  token_key  TEXT PRIMARY KEY,
  exp        BIGINT
);

CREATE TABLE IF NOT EXISTS user_token_revoke (
  uid         TEXT PRIMARY KEY REFERENCES users(uid) ON DELETE CASCADE,
  revoked_at  BIGINT
);

CREATE TABLE IF NOT EXISTS nonce_store (
  nonce  TEXT PRIMARY KEY,
  ts     BIGINT,
  exp    BIGINT
);

CREATE TABLE IF NOT EXISTS security_rl (
  rl_key  TEXT PRIMARY KEY,
  data    JSONB,
  updated BIGINT
);

CREATE TABLE IF NOT EXISTS security_events (
  event_id  TEXT PRIMARY KEY,
  kind      TEXT,
  ip        TEXT,
  details   JSONB,
  ts        BIGINT
);

-- ─────────────── USO / ACTIVIDAD ───────────────
CREATE TABLE IF NOT EXISTS user_api_activity (
  event_id     TEXT PRIMARY KEY,
  uid          TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  endpoint     TEXT,
  method       TEXT,
  status       TEXT,
  kind         TEXT,
  project_id   TEXT,
  file_id      TEXT,
  file_name    TEXT,
  api_key_id   TEXT,
  api_key_name TEXT,
  source       TEXT,
  ts           BIGINT,
  created_at   BIGINT
);
CREATE INDEX IF NOT EXISTS idx_activity_uid ON user_api_activity(uid);

CREATE TABLE IF NOT EXISTS api_usage (
  project_id  TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  period      TEXT NOT NULL,
  count       BIGINT DEFAULT 0,
  PRIMARY KEY (project_id, period)
);
