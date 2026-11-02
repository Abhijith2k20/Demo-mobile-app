-- Local Docker only: the app connects as an ordinary user (not a superuser), like on a managed host,
-- so row-level security applies to it. A second database is for tests.
CREATE ROLE siteline LOGIN PASSWORD 'siteline';
CREATE DATABASE siteline OWNER siteline;
CREATE DATABASE siteline_test OWNER siteline;
