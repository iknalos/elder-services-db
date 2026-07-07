# Schema Design Notes

## Why this shape
An ASAP's day goes: someone calls in (referral) → staff screen and open an
intake case → a nurse/care manager assesses the elder → a care plan is written
→ units of service are authorized → providers deliver units → units get billed
to MassHealth/EOEA → reports go to funders. The schema mirrors that pipeline
exactly. Each step is its own table so the agency can answer any funder question
("how many units did client X receive in FY19 against plan Y?") without
reconstruction.

## Entity core
```
organization 1──∞ program
program 1──∞ funding_source
program 1──∞ staff_assignment  ──  staff (user)
organization 1──∞ client
client 1──1 napis_profile
client 1──∞ household_member
client 1──∞ caregiver
client 1──∞ referral  ── referral_source
client 1──∞ intake_case 1──∞ assessment
intake_case 1──∞ care_plan 1──∞ care_plan_goal 1──∞ care_plan_service
care_plan_service 1──1 service_authorization 1──∞ authorized_unit_batch
service_authorization 1──∞ service_delivery
provider 1──∞ worker   worker 1──∞ service_delivery
service_delivery 1──1 claim 1──∞ remittance_line
client 1──∞ self_direction_enrollment 1──∞ timesheet 1──∞ payroll_run
```

## NAPIS / OAA required client fields (Title III reporting)
- Birthdate (drives age buckets: 60+, 75+, 85+)
- Sex (OAA categories only)
- Race (OAA categories only)
- Ethnicity (Hispanic/Latino, Not, Unknown)
- Living arrangement (alone / with spouse / with others / facility)
- Poverty status (≤100% FPL, 100-150%, >150%, unknown) — drives priority
- Primary language
- Rural flag (county-level)
- Functional status (ADLs/IADLs needing help)
- Caregiver status (none / family / non-family)
- Targeted/disadvantaged minority flag

These live in `client_napis_profile` so the demographics table stays
HIPAA-minimal and the OAA reporting copy can be exported to a separate
de-identified schema for ACL reporting.

## Eligibility programs (kept separate from client) in Massachusetts context
- MassHealth Standard / CommonHealth / Senior Buy-In
- 1915(c) waivers (Frail Elder, ABI, DDS)
- Title III (B, C1, C2, E – caregiver support)
- SSI/SSP, SNAP, LIHEAP, QMB/SLMB

Stored in a linking table `client_program_enrollment (client_id, program_id,
enrolled_at, disenrolled_at, eligibility_status)`.

## Unit currency
A `service_delivery` row is always expressed in *units* per the OAA Service
Code list plus a unit type (hour, ride, meal, dollar, contact). Authorization
and delivery both reference the same `service_unit_definition`, so funder-
specific rollups ("how many Title IIIC1 meals this quarter?") are a join.
Money (rate × units, WBLD, copay) is derived at billing time, never stored on
the delivery row.

## Audit
Two patterns:
1. **Single-row updates:** generic `audit_trigger` writes `{table}_audit` rows
   with `before`/`after` JSONB for UPDATE/DELETE.
2. **Funder-facing records (case notes, care plans, authorizations):**
   versioned tables with `valid_from`/`valid_to` so the agency can show "what
   the plan said on the date the units were delivered."

## What this is deliberately NOT
- Not an EHR (no clinical orders, no med rec, no MDS).
- Not a general-purpose CRM (no marketing, no fundraising).
- Not a payroll engine; payroll is recorded as `payroll_run` stubs that an
  outside payroll vendor (e.g. HHAeXchange FI / via 941R) consumes.

That scoping matches what an ASAP actually needs and what the Annkissam system
described: client management + Medicaid billing + self-direction fiscal
intermediary, and nothing more.