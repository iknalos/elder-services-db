-- =====================================================================
-- apply_all.sql — apply all migrations.
--
-- Run from the project root (where this file's path is scripts/apply_all.sql):
--
--   psql -d elder_services -v ON_ERROR_STOP=1 -f scripts/apply_all.sql
--
-- (psql resolves \i paths relative to your shell's current directory,
-- so starting in the project root is required.)
-- =====================================================================
\set ON_ERROR_STOP on
\echo 'Applying 0001: extensions, enums, audit, organizations, programs'
\i migrations/0001_extensions_orgs.sql
\echo 'Applying 0002: staff, clients, NAPIS, households, consents'
\i migrations/0002_staff_clients.sql
\echo 'Applying 0003: referrals, intake, assessments, care plans, authorizations'
\i migrations/0003_referrals_assessments.sql
\echo 'Applying 0004: providers, deliveries, claims (837/835)'
\i migrations/0004_providers_deliveries_billing.sql
\echo 'Applying 0005: self-direction / fiscal intermediary / payroll'
\i migrations/0005_self_direction_payroll.sql
\echo 'Applying 0006: reporting views'
\i migrations/0006_reporting_views.sql
\echo 'Done. Apply seeds with:  psql -d elder_services -f seeds/sample_data.sql'