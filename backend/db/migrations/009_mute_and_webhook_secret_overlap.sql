-- Per-conversation mute (no pushes from that conversation except @mentions of you), and the previous webhook secret,
-- which keeps signing webhooks for 24 hours after a new one is made so the PM app can switch over without failures.
ALTER TABLE channel_members ADD COLUMN muted boolean NOT NULL DEFAULT false;
ALTER TABLE integrations ADD COLUMN previous_webhook_secret text;
ALTER TABLE integrations ADD COLUMN previous_secret_until timestamptz;
