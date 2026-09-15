-- Local development / event-box database setup.
--
-- Run once as a superuser:
--   sudo -u postgres psql -f infra/local-db-setup.sql
--
-- Creates the application role, the two databases the test suite uses, and
-- applies the two settings that actually matter in practice.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'event_suite') THEN
    CREATE ROLE event_suite LOGIN PASSWORD 'event_suite';
  END IF;
END
$$;

SELECT 'CREATE DATABASE event_suite OWNER event_suite'
 WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'event_suite')\gexec

SELECT 'CREATE DATABASE event_suite_test OWNER event_suite'
 WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'event_suite_test')\gexec

-- The server's end-to-end suite gets its own database: turbo runs packages in
-- parallel, and two suites resetting one schema would destroy each other.
SELECT 'CREATE DATABASE event_suite_e2e OWNER event_suite'
 WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'event_suite_e2e')\gexec

-- Commit latency on a virtualised disk is fsync-bound (~27ms per commit on the
-- reference box), while a transaction is ~0.4ms per row. That makes batching
-- the difference between a fast and a slow system, and is why the repositories
-- wrap multi-row writes in a transaction.
--
-- For the *test* database only, trades crash durability for speed: a test run
-- has nothing worth recovering, and re-migrating per test otherwise dominates
-- the suite.
ALTER DATABASE event_suite_test SET synchronous_commit = off;
ALTER DATABASE event_suite_e2e SET synchronous_commit = off;

-- For the event box, `synchronous_commit = off` is also viable because a UPS
-- covers the window, but keep the default until that hardware is confirmed.
