-- The Cards API (spec 2.1): the PM app decides what to ask; Siteline delivers cards and sends answers back.

-- The PM link becomes an integration the PM app calls with its own key.
ALTER TABLE pm_links RENAME TO integrations;
ALTER TABLE integrations DROP COLUMN base_url;
ALTER TABLE integrations DROP COLUMN api_key;
ALTER TABLE integrations DROP COLUMN last_sync_at;
ALTER TABLE integrations ADD COLUMN api_key_hash text UNIQUE;          -- the key the PM app calls Siteline with
ALTER TABLE integrations ADD COLUMN previous_key_hash text;            -- still accepted for 24 h after a rotation
ALTER TABLE integrations ADD COLUMN previous_key_until timestamptz;
ALTER TABLE integrations ADD COLUMN webhook_url text;                  -- where answers go (kind http)
ALTER TABLE integrations ADD COLUMN last_call_at timestamptz;

-- Siteline no longer keeps the PM app's tasks or asks on its own.
DROP TABLE checkins;
DROP TABLE pm_tasks;
DROP TABLE pm_events;

CREATE TABLE cards (
  id             text PRIMARY KEY,
  company_id     text NOT NULL REFERENCES companies ON DELETE CASCADE,
  ext_id         text NOT NULL,                     -- the PM app's id; the same id again is the same card
  user_id        text NOT NULL REFERENCES users,
  project_id     text REFERENCES projects ON DELETE SET NULL,
  message_id     text,
  content        jsonb NOT NULL,                    -- title, subtitle, badge, fields, scale, buttons, note, push
  ref            jsonb NOT NULL DEFAULT '{}',       -- handed back to the PM app untouched
  state          text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'answered', 'closed')),
  closed_text    text,
  answer         jsonb,
  answered_at    timestamptz,                       -- when the person tapped (they may have had no signal)
  received_at    timestamptz,                       -- when the answer reached Siteline
  seen_at        timestamptz,
  nudged_at      timestamptz,
  delivery       text CHECK (delivery IN ('pending', 'delivered', 'refused', 'failed')),
  delivery_error text,
  expires_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, ext_id)
);
CREATE INDEX cards_by_user ON cards (user_id, created_at);
CREATE INDEX cards_by_project ON cards (project_id, created_at);

ALTER TABLE cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE cards FORCE ROW LEVEL SECURITY;
CREATE POLICY same_company ON cards USING (company_id = current_company()) WITH CHECK (company_id = current_company());

-- The mock PM app remembers which card it sent for which task (the real PM app keeps its own record).
CREATE TABLE pm_mock_cards (
  company_id text NOT NULL REFERENCES companies ON DELETE CASCADE,
  card_id    text NOT NULL,                         -- the id the mock gave the card
  task_id    text NOT NULL,
  kind       text NOT NULL,                         -- checkin | summary
  sent_on    date NOT NULL,
  PRIMARY KEY (company_id, card_id)
);
ALTER TABLE pm_mock_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE pm_mock_cards FORCE ROW LEVEL SECURITY;
CREATE POLICY same_company ON pm_mock_cards USING (company_id = current_company()) WITH CHECK (company_id = current_company());
