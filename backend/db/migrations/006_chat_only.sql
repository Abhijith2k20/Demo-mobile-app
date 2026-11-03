-- Spec 2.2: projects and channels are only conversation, made in Siteline; the same app for every company.
ALTER TABLE companies DROP COLUMN setup;                  -- no templates: job titles, standard channels, problem types
ALTER TABLE projects DROP COLUMN pm_project_id;           -- the PM app no longer sends projects
ALTER TABLE projects DROP COLUMN pm_url;
ALTER TABLE project_members DROP COLUMN role;             -- the Owner and Admins run projects
ALTER TABLE project_members DROP COLUMN job_title;
ALTER TABLE project_members DROP COLUMN source;
ALTER TABLE cards DROP COLUMN project_id;                 -- a card goes to a person, not a project
UPDATE integrations SET options = options - 'unmatchedByProject';
DROP TABLE pm_mock_members;                              -- the mock PM app no longer sends members
