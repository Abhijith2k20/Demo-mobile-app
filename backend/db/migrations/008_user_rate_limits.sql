-- Per-person rate limits (messages and other changes, uploads, search, invites), counted in Postgres like the
-- Cards API limit so they hold across API processes. One row per person, kind and window; old rows are cleaned up hourly.
CREATE TABLE user_calls (
  user_id text NOT NULL REFERENCES users ON DELETE CASCADE,
  kind    text NOT NULL,
  window_start timestamptz NOT NULL,
  calls   int NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, kind, window_start)
);
