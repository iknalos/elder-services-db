# TODO

## Schema (this pass) — done
- [x] 0001 extensions, enums, audit, organization / program / funding
- [x] 0002 staff/users, client + NAPIS, household, caregiver, consent
- [x] 0003 referral / intake / assessment / care plan / authorization
- [x] 0004 provider / worker / delivery / 837 claims / 835 remittance
- [x] 0005 self-direction / timesheet / payroll stubs
- [x] 0006 reporting views (OAA client profile, units by program/quarter,
      authorization utilization, claim reconciliation, credential expiry,
      SD budget burn-down)
- [x] seeds/sample_data.sql

## Schema (next pass)
- [ ] `client_contact_log` free-text case notes with redaction tokenizer
- [ ] `grievance_incident` table for complaints / critical incidents
  (MA EOEA 22 CMR critical incident reports)
- [ ] `provider_sanction` row (OIG LEIE monthly import → join view)
- [ ] `staff_competency` + annual-training due-date view
- [ ] `interpreter_language` lookup (50 most-common MA languages)
- [ ] `transportation_trip` (most elder-case DBs have hardcoded trip legs)
- [ ] `meal_route` / `meal_route_stop` (congregate + HDM logistics)

## Operational
- [ ] Row-level security policies (RLS) keyed to `staff_program_assignment`
- [ ] Partition `service_delivery` and `audit_log` by month
- [ ] `migrations/0007_rls.sql` — RLS + role grants
- [ ] `scripts/validate_schema.sql` — integrity-check queries
- [ ] CI job that runs `psql -d postgres -f scripts/apply_all.sql` against
      a throwaway container (PostgreSQL 14/15/16 matrix)
- [ ] `dbdocs.db` or pg_catalog → Mermaid ERD for `docs/erd.md`

## Performance
- [ ] BRIN idx on service_delivery(scheduled_date) once partitioned
- [ ] Materialized view `mv_units_by_program_quarter` for funder dashboards

## Legal / governance
- [ ] Have a HIPAA-qualified counsel review `docs/pii.md` before production
- [ ] Determine whether 42 CFR Part 2 applies if SUD services ever get added
- [ ] State retention requirements (MA 7 yrs for billing records)