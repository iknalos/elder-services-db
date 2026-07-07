# Elder Services Case Management Database

A re-build of the kind of database structure used by Massachusetts ASAPs (Aging
Service Access Points) such as Somerville-Cambridge Elder Services (SCES),
modeled on the public reporting requirements every AAA must satisfy.

This is **not** a copy of the former Annkissam/SCES system (acquired by
HHAeXchange in 2020, schema proprietary). It is a clean reimplementation derived
from the public data dictionaries and regulations that, by law, dictate the
shape of any ASAP case-management database:

| Requirement source                                              | Drives module                                |
| -------------------------------------------------------------- | ------------------------------------------- |
| MA EOEA SIMS (Senior Information Management System)            | referrals, intake, assessments, care plans  |
| Older Americans Act / NAPIS data dictionary (AoA/ACL)          | client demographics, service units, counts  |
| Medicaid HCBS waiver + 837/835 EDI                             | service authorizations, claims, remittances |
| MA 268/526 fiscal intermediary regulations (self-direction)     | self-direction, payroll, employer-of-record |
| 42 CFR Part 2 / HIPAA                                          | access controls, audit, minimum-necessary  |

## Stack
- PostgreSQL 14+
- Plain SQL migrations (apply with `psql`)
- Enums for coded values; FK integrity throughout
- Audit via per-table triggers
- VLPhotos/selective history via append-only `_history` siblings where needed

## Module map
1. **Organizations & funding** — ASAP agencies, programs, funding sources
2. **Staff & access** — users, roles, program assignments
3. **Clients** — demographics, NAPIS/OAA fields, consents, emergency contacts
4. **Households & caregivers** — informal supports, household composition
5. **Referrals & intake** — referral sources, intake screening, eligibility
6. **Assessments & care plans** — assessment instruments, goals, care-plan versions
7. **Service authorizations** — authorized units, dates, rates, funding
8. **Providers & workers** — contracted agencies, individual workers, credentials
9. **Service deliveries** — units delivered, cancellations, missed visits
10. **Billing & claims** — 837 generation, 835 remittance, claim reconciliation
11. **Self-direction / fiscal intermediary** — employer-of-record, timesheets, payroll runs
12. **Reporting views** — OAA/NAPIS aggregate counts, funder reports

## Design choices worth calling out
- **Every funder-facing table is append-only with effective-dating** so historic
  reports keep working as rules change.
- **Units are the atomic currency** (1 hour of chore, 1 meal, 1 ride). Authorize
  units → deliver units → bill units. No money on the delivery row.
- **Coded values live in enums**, not lookup tables**, for the closed sets (sex,
  race, ethnicity per OAA), and in lookup tables for open sets (service codes,
  referral sources) so they can be edited without a migration.
- **PII columns are flagged** in `docs/pii.md` so they can be encrypted at rest
  or masked for analytics extracts.

## Applying
```bash
psql -d elder_services -f scripts/apply_all.sql
```
Or one at a time:
```bash
psql -d elder_services -f migrations/0001_extensions_orgs.sql
```

## Status
Work in progress. See `TODO.md` for the module checklist.