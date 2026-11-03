-- Email only (2026-11-03): no phone sign-in, invites or SMS. People are known by their work email.
-- Someone who only had a phone number can no longer sign in: their account is closed like a deleted one
-- (their messages stay as "Former member"). There was no production data when this ran.
UPDATE users SET name = 'Former member', deleted_at = now(), updated_at = now()
WHERE email IS NULL AND NOT is_bot AND deleted_at IS NULL;
UPDATE memberships SET status = 'deactivated', updated_at = now()
WHERE user_id IN (SELECT id FROM users WHERE email IS NULL AND NOT is_bot);
UPDATE invites SET status = 'cancelled' WHERE identifier NOT LIKE '%@%' AND status = 'pending';
DELETE FROM otp_codes WHERE identifier NOT LIKE '%@%' AND identifier NOT LIKE 'platform:%';
ALTER TABLE users DROP COLUMN phone;          -- drops the old "email or phone" check with it
ALTER TABLE users ADD CHECK (is_bot OR deleted_at IS NOT NULL OR email IS NOT NULL);
