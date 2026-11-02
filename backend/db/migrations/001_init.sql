-- Siteline schema (spec §7.1). Ids are text (UUIDv7 made by the server or the app).
-- Global tables have no company; every per-company table has company_id and row-level security,
-- so a query that forgets to filter returns nothing instead of another company's rows (§10.4).

-- ---------- Global ----------

CREATE TABLE users (
  id           text PRIMARY KEY,
  name         text NOT NULL,
  email        text UNIQUE,               -- lower case
  phone        text UNIQUE,               -- E.164
  avatar_color text NOT NULL,
  language     text NOT NULL DEFAULT 'en',
  notify       jsonb NOT NULL DEFAULT '{"level": "all", "quietFrom": "21:00", "quietTo": "07:00"}',
  is_bot       boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,
  CHECK (is_bot OR deleted_at IS NOT NULL OR email IS NOT NULL OR phone IS NOT NULL)
);

CREATE TABLE companies (
  id            text PRIMARY KEY,
  name          text NOT NULL,
  slug          text NOT NULL UNIQUE,
  time_zone     text NOT NULL DEFAULT 'Asia/Kolkata',
  setup         jsonb NOT NULL,
  pm_company_id text,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE pm_links (
  company_id     text PRIMARY KEY REFERENCES companies ON DELETE CASCADE,
  kind           text NOT NULL CHECK (kind IN ('mock', 'http')),
  base_url       text,
  api_key        text,                    -- encrypted (services/secrets.py)
  webhook_secret text,                    -- encrypted
  options        jsonb NOT NULL DEFAULT '{}',
  last_sync_at   timestamptz,
  last_error     text
);

CREATE TABLE memberships (
  company_id text NOT NULL REFERENCES companies ON DELETE CASCADE,
  user_id    text NOT NULL REFERENCES users,
  role       text NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'guest')),
  status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deactivated')),
  joined_at  timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, user_id)
);
CREATE UNIQUE INDEX memberships_one_owner ON memberships (company_id) WHERE role = 'owner' AND status = 'active';
CREATE INDEX memberships_by_user ON memberships (user_id);

CREATE TABLE invites (
  id          text PRIMARY KEY,
  company_id  text NOT NULL REFERENCES companies ON DELETE CASCADE,
  identifier  text NOT NULL,              -- email (lower case) or phone (E.164)
  name        text NOT NULL,
  role        text NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'guest')),
  channel_ids jsonb NOT NULL DEFAULT '[]',
  invited_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled'))
);
CREATE UNIQUE INDEX invites_one_pending ON invites (company_id, identifier) WHERE status = 'pending';
CREATE INDEX invites_by_identifier ON invites (identifier) WHERE status = 'pending';

CREATE TABLE otp_codes (
  identifier text PRIMARY KEY,
  code_hash  text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts   int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE otp_requests (               -- rate limits; rows older than an hour are deleted
  identifier text NOT NULL,
  ip         text NOT NULL,
  at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_requests_identifier ON otp_requests (identifier, at);
CREATE INDEX otp_requests_ip ON otp_requests (ip, at);

CREATE TABLE sessions (
  id                text PRIMARY KEY,
  user_id           text NOT NULL REFERENCES users,
  company_id        text REFERENCES companies ON DELETE CASCADE,  -- null: signed in, company not picked yet
  access_hash       text UNIQUE,
  access_expires_at timestamptz,
  refresh_hash      text UNIQUE,
  refresh_expires_at timestamptz,
  previous_refresh_hash text,             -- reusing a rotated refresh token revokes the session
  device            text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  last_used_at      timestamptz NOT NULL DEFAULT now(),
  revoked_at        timestamptz
);
CREATE INDEX sessions_by_user ON sessions (user_id) WHERE revoked_at IS NULL;

CREATE TABLE push_tokens (
  token      text PRIMARY KEY,
  user_id    text NOT NULL REFERENCES users ON DELETE CASCADE,
  platform   text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE platform_admins (
  email      text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id         text PRIMARY KEY,
  company_id text,
  actor      text NOT NULL,
  action     text NOT NULL,
  target     text,
  data       jsonb NOT NULL DEFAULT '{}',
  at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_by_company ON audit_log (company_id, at DESC);

CREATE TABLE jobs (                        -- §10.6; global so one worker serves every company
  id           text PRIMARY KEY,
  company_id   text REFERENCES companies ON DELETE CASCADE,
  kind         text NOT NULL,
  run_at       timestamptz NOT NULL,
  payload      jsonb NOT NULL DEFAULT '{}',
  dedupe_key   text UNIQUE,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'done', 'failed', 'cancelled')),
  attempts     int NOT NULL DEFAULT 0,
  locked_until timestamptz,
  last_error   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_due ON jobs (run_at) WHERE status IN ('pending', 'running');

CREATE TABLE events (                     -- live events; NOTIFY carries only the id (§10.7)
  id         bigserial PRIMARY KEY,
  company_id text NOT NULL,
  audience   jsonb NOT NULL,               -- user ids
  event      jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE worker_heartbeat (
  id      int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  seen_at timestamptz NOT NULL
);

-- ---------- Per company ----------

CREATE TABLE projects (
  id            text PRIMARY KEY,
  company_id    text NOT NULL REFERENCES companies ON DELETE CASCADE,
  pm_project_id text,
  name          text NOT NULL,
  client        text NOT NULL DEFAULT '',
  address       text NOT NULL DEFAULT '',
  pm_url        text,
  archived_at   timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, pm_project_id)
);

CREATE TABLE project_members (
  company_id text NOT NULL REFERENCES companies ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects ON DELETE CASCADE,
  user_id    text NOT NULL REFERENCES users,
  role       text NOT NULL CHECK (role IN ('manager', 'member')),
  job_title  text NOT NULL,
  source     text NOT NULL DEFAULT 'manual' CHECK (source IN ('pm', 'manual', 'guest')),
  joined_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE channels (
  id             text PRIMARY KEY,
  company_id     text NOT NULL REFERENCES companies ON DELETE CASCADE,
  project_id     text REFERENCES projects ON DELETE CASCADE,
  name           text NOT NULL,
  kind           text NOT NULL CHECK (kind IN ('project', 'company', 'dm', 'bot')),
  is_private     boolean NOT NULL DEFAULT false,
  posting_policy text NOT NULL DEFAULT 'everyone' CHECK (posting_policy IN ('everyone', 'admins')),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX channels_name_per_project ON channels (project_id, name) WHERE kind = 'project';

CREATE TABLE channel_members (
  company_id           text NOT NULL REFERENCES companies ON DELETE CASCADE,
  channel_id           text NOT NULL REFERENCES channels ON DELETE CASCADE,
  user_id              text NOT NULL REFERENCES users,
  last_read_message_id text,
  joined_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, user_id)
);
CREATE INDEX channel_members_by_user ON channel_members (user_id);

CREATE TABLE messages (
  id               text PRIMARY KEY,
  company_id       text NOT NULL REFERENCES companies ON DELETE CASCADE,
  channel_id       text NOT NULL REFERENCES channels ON DELETE CASCADE,
  sender_id        text NOT NULL REFERENCES users,
  type             text NOT NULL,
  body             text,
  data             jsonb,
  thread_parent_id text,
  reactions        jsonb NOT NULL DEFAULT '{}',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);
CREATE INDEX messages_by_channel ON messages (channel_id, created_at DESC, id DESC);
CREATE INDEX messages_by_thread ON messages (thread_parent_id) WHERE thread_parent_id IS NOT NULL;

CREATE TABLE checkins (
  id           text PRIMARY KEY,
  company_id   text NOT NULL REFERENCES companies ON DELETE CASCADE,
  task_id      text NOT NULL,             -- the task in the PM app
  task_name    text NOT NULL,
  project_id   text REFERENCES projects ON DELETE CASCADE,
  user_id      text NOT NULL REFERENCES users,
  asked_at     timestamptz NOT NULL DEFAULT now(),
  answer       jsonb,
  message_id   text,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  reminded_at  timestamptz,
  escalated_at timestamptz,
  pm_write     text CHECK (pm_write IN ('pending', 'saved', 'refused')),
  pm_error     text
);
CREATE INDEX checkins_by_user ON checkins (user_id, asked_at);

CREATE TABLE activities (
  id         text PRIMARY KEY,
  company_id text NOT NULL REFERENCES companies ON DELETE CASCADE,
  user_id    text NOT NULL REFERENCES users,
  kind       text NOT NULL,
  actor_id   text NOT NULL,
  project_id text,
  channel_id text,
  message_id text,
  task_ids   jsonb NOT NULL DEFAULT '[]',
  text       text NOT NULL,
  lines      jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at    timestamptz
);
CREATE INDEX activities_by_user ON activities (user_id, created_at DESC);

CREATE TABLE uploads (
  id           text PRIMARY KEY,
  company_id   text NOT NULL REFERENCES companies ON DELETE CASCADE,
  user_id      text NOT NULL REFERENCES users,
  key          text NOT NULL,             -- storage key; starts with the company id
  kind         text NOT NULL CHECK (kind IN ('image', 'voice', 'file')),
  name         text,
  content_type text NOT NULL,
  size         int NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Saved copy of the PM app's tasks, written only by sync and webhooks (§9.3).
CREATE TABLE pm_tasks (
  company_id     text NOT NULL REFERENCES companies ON DELETE CASCADE,
  pm_task_id     text NOT NULL,
  pm_project_id  text NOT NULL,
  name           text NOT NULL,
  planned_start  date NOT NULL,
  planned_finish date NOT NULL,
  owner_ref      text,
  owner_user_id  text,
  status         text NOT NULL,
  percent        int NOT NULL DEFAULT 0,
  pm_updated_at  timestamptz,
  removed_at     timestamptz,
  PRIMARY KEY (company_id, pm_task_id)
);
CREATE INDEX pm_tasks_by_owner ON pm_tasks (company_id, owner_user_id) WHERE removed_at IS NULL;

CREATE TABLE pm_events (                   -- webhook ids already handled
  company_id  text NOT NULL REFERENCES companies ON DELETE CASCADE,
  event_id    text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, event_id)
);

-- The mock PM app's own data (pm/mock.py), until each company's real PM app is linked.
CREATE TABLE pm_mock_projects (
  company_id text NOT NULL REFERENCES companies ON DELETE CASCADE,
  id         text NOT NULL,
  name       text NOT NULL,
  client     text NOT NULL DEFAULT '',
  address    text NOT NULL DEFAULT '',
  status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  url        text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, id)
);
CREATE TABLE pm_mock_members (
  company_id text NOT NULL REFERENCES companies ON DELETE CASCADE,
  project_id text NOT NULL,
  person_ref text NOT NULL,
  name       text NOT NULL,
  role       text NOT NULL CHECK (role IN ('manager', 'member')),
  role_name  text NOT NULL,
  PRIMARY KEY (company_id, project_id, person_ref)
);
CREATE TABLE pm_mock_tasks (
  company_id     text NOT NULL REFERENCES companies ON DELETE CASCADE,
  id             text NOT NULL,
  project_id     text NOT NULL,
  name           text NOT NULL,
  planned_start  date NOT NULL,
  planned_finish date NOT NULL,
  owner_ref      text,
  status         text NOT NULL DEFAULT 'not_started',
  percent        int NOT NULL DEFAULT 0,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz,
  PRIMARY KEY (company_id, id)
);
CREATE TABLE pm_mock_writes (
  company_id text NOT NULL REFERENCES companies ON DELETE CASCADE,
  key        text NOT NULL,
  result     jsonb NOT NULL,
  PRIMARY KEY (company_id, key)
);

-- ---------- Row-level security ----------
-- current_company() is the session's company, set per transaction by app/db.py; unset means no rows.

CREATE FUNCTION current_company() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.company_id', true), '') $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['projects', 'project_members', 'channels', 'channel_members', 'messages', 'checkins',
                           'activities', 'uploads', 'pm_tasks', 'pm_events', 'pm_mock_projects', 'pm_mock_members',
                           'pm_mock_tasks', 'pm_mock_writes']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY same_company ON %I USING (company_id = current_company()) '
                   'WITH CHECK (company_id = current_company())', t);
  END LOOP;
END $$;
