-- Audit fixes.
-- Sessions: whether the newest access token has been used. Until it has, the phone may never have received the reply
-- that carried it, so presenting the previous refresh token again is a retry, not a stolen copy.
ALTER TABLE sessions ADD COLUMN access_used boolean NOT NULL DEFAULT true;

-- Uploads: when a message or card answer first used it. Uploads never used are cleaned up after 7 days.
ALTER TABLE uploads ADD COLUMN attached_at timestamptz;
DO $$
DECLARE c text;
BEGIN
  FOR c IN SELECT id FROM companies LOOP
    PERFORM set_config('app.company_id', c, true);  -- uploads, messages and cards are behind row-level security
    UPDATE uploads u SET attached_at = u.created_at
     WHERE EXISTS (SELECT 1 FROM messages m WHERE m.data->>'uploadId' = u.id
                      OR m.data->'attachments' @> jsonb_build_array(jsonb_build_object('uploadId', u.id)))
        OR EXISTS (SELECT 1 FROM cards k WHERE k.answer->>'voiceUploadId' = u.id OR k.answer->'photoUploadIds' ? u.id);
  END LOOP;
  PERFORM set_config('app.company_id', '', true);
END $$;
CREATE INDEX uploads_unattached ON uploads (created_at) WHERE attached_at IS NULL;

-- One company's webhooks, newest first (delivery history), without reading every job.
CREATE INDEX jobs_by_company_kind ON jobs (company_id, kind, created_at DESC);

-- Left over from the removed task features: always empty.
ALTER TABLE activities DROP COLUMN task_ids;
