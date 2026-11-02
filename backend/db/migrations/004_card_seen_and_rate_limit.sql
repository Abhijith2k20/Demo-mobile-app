-- card.seen webhooks (turned on per company) and the Cards API rate limit, counted in Postgres so it holds
-- across API processes.
ALTER TABLE integrations ADD COLUMN send_card_seen boolean NOT NULL DEFAULT false;

CREATE TABLE api_calls (
  company_id text NOT NULL REFERENCES companies ON DELETE CASCADE,
  minute     timestamptz NOT NULL,
  calls      int NOT NULL DEFAULT 0,
  PRIMARY KEY (company_id, minute)
);
