-- Local PostgreSQL setup. Run ONCE as a superuser, e.g.:
--   psql -U postgres -h localhost -f scripts/setup-postgres.sql
-- Change the password below first, and use the same password in DATABASE_URL / DATABASE_URL_TEST.
-- Safe to re-run: existing objects are skipped.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'creatorchat') THEN
    CREATE ROLE creatorchat LOGIN PASSWORD 'change-me-locally' CREATEDB;
  END IF;
END
$$;

SELECT 'CREATE DATABASE creatorchat OWNER creatorchat'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'creatorchat')\gexec

SELECT 'CREATE DATABASE creatorchat_test OWNER creatorchat'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'creatorchat_test')\gexec
