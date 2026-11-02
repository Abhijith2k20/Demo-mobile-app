-- English only (2026-11-02): the app no longer has a language setting.
ALTER TABLE users DROP COLUMN language;

-- Setup labels were stored per language; the name or key is what people see now.
UPDATE companies SET setup = jsonb_set(
  jsonb_set(setup, '{jobTitles}',
    (SELECT coalesce(jsonb_agg(jt - 'label'), '[]') FROM jsonb_array_elements(setup->'jobTitles') jt)),
  '{problemTypes}',
    (SELECT coalesce(jsonb_agg(pt - 'label'), '[]') FROM jsonb_array_elements(setup->'problemTypes') pt));
