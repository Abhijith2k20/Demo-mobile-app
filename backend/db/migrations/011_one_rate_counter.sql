-- One counter for every rate limit (per person, and the Cards API per company), instead of a table each.
-- Counts only live for their window, so nothing needs copying.
CREATE TABLE call_counts (
  subject      text NOT NULL,        -- a person's id or a company's id
  kind         text NOT NULL,        -- which limit (services/limits.py)
  window_start timestamptz NOT NULL,
  calls        int NOT NULL DEFAULT 0,
  PRIMARY KEY (subject, kind, window_start)
);
DROP TABLE api_calls;
DROP TABLE user_calls;
