-- =====================================================================
-- seeds/sample_data.sql
-- A few rows to sanity-check joins. NOT for production.
-- =====================================================================
BEGIN;

SET app.audit_skip = '1';

-- Organizations
INSERT INTO organization (legal_name, short_name, org_type)
VALUES
  ('Somerville-Cambridge Elder Services, Inc.', 'SCES', 'ASAP'),
  ('MassHealth / EOHHS',                        'EOHHS', 'STATE'),
  ('Example Home Care LLC',                     'EXHC',  'VENDOR');

-- For FK ergonomics in other inserts
WITH asap  AS (SELECT org_id FROM organization WHERE short_name='SCES'),
     state AS (SELECT org_id FROM organization WHERE short_name='EOHHS'),
     exhc  AS (SELECT org_id FROM organization WHERE short_name='EXHC')
INSERT INTO program
       (org_id, program_code, program_name, funder_type, effective_date, regulatory_basis)
SELECT t.org_id, t.program_code, t.program_name, t.funder_type::funder_type,
       t.effective_date::date, t.regulatory_basis
FROM (VALUES
  ((SELECT org_id FROM asap), 'III-C1-MEALS', 'Title III-C1 Home Delivered Meals',
                                   'OAA_III_C1', '2022-10-01',
                                   '45 CFR 1321'),
  ((SELECT org_id FROM asap), 'FEW-HOMEMAKER', 'Frail Elder Waiver Homemaker',
                                   'MASSHEALTH', '2022-10-01',
                                   'MassHealth 1300.101'),
  ((SELECT org_id FROM asap), 'III-B-IANDA', 'Information & Referral',
                                   'OAA_III_B', '2022-10-01',
                                   '45 CFR 1321')
) AS t(org_id, program_code, program_name, funder_type, effective_date,
       regulatory_basis);

INSERT INTO referral_source (code, name, category) VALUES
  ('SELF',     'Self / Family',      'self_family'),
  ('HOSP-GEN', 'General Hospital',    'hospital'),
  ('MOW-CAM',  'Cambridge Meals-on-Wheels', 'community_agency');

INSERT INTO role (role_code, role_name, can_phi) VALUES
  ('intake_rn',        'Intake RN',         TRUE),
  ('care_manager',     'Care Manager',      TRUE),
  ('fi_clerk',         'FI Clerk',          TRUE),
  ('reports_viewer',   'Reports Viewer',    FALSE);

WITH asap AS (SELECT org_id FROM organization WHERE short_name='SCES')
INSERT INTO staff (org_id, email, display_name, title)
SELECT asap.org_id, e, d, t
FROM (VALUES
  ('alice@asap.example', 'Alice Ng',         'Intake RN'),
  ('bob@asap.example',   'Bob Patel',       'Care Manager'),
  ('carol@asap.example', 'Carol Reyes-Lopez','FI Clerk')
) AS x(e, d, t), asap;

INSERT INTO staff_role (staff_id, role_id)
SELECT s.staff_id, r.role_id
FROM staff s JOIN role r
  ON (LOWER(LEFT(s.email,1)) = 'a' AND r.role_code='intake_rn')
  OR (LOWER(LEFT(s.email,1)) = 'b' AND r.role_code='care_manager')
  OR (LOWER(LEFT(s.email,1)) = 'c' AND r.role_code='fi_clerk');

WITH asap AS (SELECT org_id FROM organization WHERE short_name='SCES')
INSERT INTO client (org_id, client_number, legal_first_name, legal_last_name,
                     date_of_birth, sex)
SELECT asap.org_id, x.n, x.fn, x.ln, x.dob::date, x.sx::sex_code
FROM (VALUES
  ('C-0001', 'Maria', 'Santos',   '1939-05-04', 'F'),
  ('C-0002', 'James', 'Johnson',  '1942-11-21', 'M'),
  ('C-0003', 'Yan',   'Yu',       '1948-03-12', 'M')
) AS x(n, fn, ln, dob, sx), asap;

INSERT INTO client_napis_profile
 (client_id, ethnicity, race_oaa, living_arrangement, federal_poverty_pct,
  is_rural, primary_language_oaa, has_family_caregiver, is_frail,
  adl_help_needed, iadl_help_needed)
SELECT c.client_id, x.etn::ethnicity_code, x.race, x.la::living_arrangement,
       x.fpl::federal_poverty, x.rl::rurality, x.lang, x.cg::yes_no_unknown,
       x.fl, x.adl, x.iadl
FROM client c
JOIN (VALUES
  ('C-0001','H',ARRAY['white','other'],'alone','at_or_below_100','urban',
                    'English','Y',TRUE,ARRAY['bathing','dressing'],
                    ARRAY['meal_prep','housekeeping','shopping']),
  ('C-0002','N',ARRAY['white'],'with_others','101_to_150','urban',
                    'Spanish','N',FALSE,ARRAY[]::TEXT[],
                    ARRAY['money','meds']),
  ('C-0003','U',ARRAY['asian'],'alone','unknown','urban',
                    'Chinese','Y',TRUE,ARRAY['eating','transferring'],
                    ARRAY[]::TEXT[])
) AS x(num, etn, race, la, fpl, rl, lang, cg, fl, adl, iadl)
  ON c.client_number = x.num;

INSERT INTO organization (legal_name, short_name, org_type, tax_id_ein)
VALUES ('Example Fiscal Intermediary LLC','ExampleFI','FI','04-1234567')
ON CONFLICT DO NOTHING;

WITH asap AS (SELECT org_id FROM organization WHERE short_name='SCES')
INSERT INTO provider (org_id, provider_name, provider_type, payment_model,
                      contract_start, contract_end, contract_id)
SELECT
   asap.org_id, p.name, p.ptype, p.pmodel::payment_model, p.cstart, p.cend, p.cid
FROM (VALUES
   ('Example Home Care LLC',  'homemaker',         'fee_for_service',
    'CON-EXHC-2024', DATE '2024-07-01', DATE '2025-06-30'),
   ('Example Fiscal Intermediary LLC','self_direction_eor','self_direction',
    'CON-EXFI-2024', DATE '2024-07-01', DATE '2025-06-30'),
   ('Example Meal Vendor LLC','meal_vendor','fee_for_service',
    'CON-EXMV-2024',DATE '2024-07-01', DATE '2025-06-30')
 ) AS p(name, ptype, pmodel, cid, cstart, cend), asap;

RESET app.audit_skip;

COMMIT;