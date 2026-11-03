-- Quiet hours are gone: notification settings keep only the level.
ALTER TABLE users ALTER COLUMN notify SET DEFAULT '{"level": "all"}';
UPDATE users SET notify = jsonb_build_object('level', coalesce(notify->>'level', 'all'));
