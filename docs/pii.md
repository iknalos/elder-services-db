# PII / PHI Inventory

Columns containing Protected Health Information (HIPAA) or sensitive PII.
Encrypt columns marked "at-rest" with column-level encryption in the
application layer (or use pgcrypto PGP_SYM_ENCRYPT); flag for special
masking in any analytics extract.

| Table                   | Column              | Sensitivity              | Notes                              |
|-------------------------|---------------------|--------------------------|------------------------------------|
| client                  | legal_first_name    | PII (PHI)                | Mask in extracts                   |
| client                  | legal_middle_name   | PII (PHI)                | Mask in extracts                   |
| client                  | legal_last_name     | PII (PHI)                | Mask in extracts                   |
| client                  | date_of_birth       | PII (PHI)                | Use age_year only for de-id reports|
| client                  | ssn_last4           | PII                      |                                    |
| client                  | ssn_encrypted       | PII — encrypted at-rest  | app-encrypted; never SELECT raw    |
| client                  | primary_phone       | PII                      |                                    |
| client                  | primary_email       | PII                      |                                    |
| client                  | mailing_address     | PII (PHI)                |                                    |
| client                  | physical_address    | PII (PHI)                |                                    |
| client_napis_profile    | (whole row)         | PHI + OAA demographics   | de-identifiable via client_number  |
| staff                   | email               | PII                      |                                    |
| staff                   | password_hash       | secret                   | never SELECT                       |
| worker                  | ssn_encrypted       | PII — encrypted at-rest  | app-encrypted                      |
| worker                  | legal_first_name    | PII                      |                                    |
| worker                  | legal_last_name     | PII                      |                                    |
| worker                  | date_of_birth       | PII                      |                                    |
| worker_credential       | license_number      | PII                      |                                    |
| provider                | tax_id_ein          | PII (business)           |                                    |
| provider                | banking_info_ref    | secret (pointer only)    | never store ACH numbers in DB      |
| caregiver               | caregiver_name      | PII                      |                                    |
| caregiver               | phone, email        | PII                      |                                    |
| household_member        | full_name           | PII                      |                                    |
| household_member        | date_of_birth       | PII                      |                                    |
| household_member        | phone, email        | PII                      |                                    |
| emergency_contact       | contact_name        | PII                      |                                    |
| emergency_contact       | phone, email        | PII                      |                                    |
| consent                 | pdf_document_ref    | PHI document pointer     | object key only, document in DMS   |
| service_delivery        | evv_location_gps    | PHI (geolocation)        | treat as PHI per 21st Century Cures|

## Minimum-necessary enforcement
- `reports_viewer` role only has SELECT on the `v_oaa_client_profile`,
  `v_units_by_program_quarter`, `v_authorization_utilization`,
  `v_claim_reconciliation`, `v_credential_expiration`,
  `v_sd_budget_utilization` views — none of which return names.
- `can_phi` on `role` should gate any app query touching the `client`,
  `client_napis_profile`, `worker` tables.
- Self-direction enrollees' representative_person is free-text PHI; document
  handling in the agency HIPAA policies.

## Audit
- `audit_log` captures `{before,after}` JSONB for every row change.
- Set `SET app.current_user_id = '<staff-uuid>'` from the app connection so
  audit rows are attributable.
- `SET app.audit_skip = '1'` is reserved for bulk maintenance only.