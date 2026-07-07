-- Exercises the schema: inserts a referral + intake_case + assessment +
-- care_plan + authorization + 2 deliveries, then attempts an overdraft
-- (expected to fail) and confirms audit rows exist.
\set ON_ERROR_STOP 1

-- 1. Audit: make sure a normal update gets logged.
SELECT set_config('app.current_user_id',
                  (SELECT staff_id::text FROM staff WHERE email='alice@asap.example'),
                  false) AS audit_user;
SET app.audit_skip = '0';

UPDATE staff SET title = 'Intake RN / Lead' WHERE email = 'alice@asap.example';

SELECT 'audit_log after update' AS step;
SELECT audit_id, table_name, operation, changed_columns,
       (before_row->>'title') AS before_title,
       (after_row->>'title')  AS after_title,
       changed_by
  FROM audit_log
 WHERE table_name = 'staff'
 ORDER BY audit_id DESC
 LIMIT 1;

-- 2. Authorization + delivery exercise
\set debug 0
WITH cm AS (SELECT staff_id FROM staff WHERE email='bob@asap.example'),
     ic AS (SELECT client_id FROM client WHERE client_number='C-0001'),
     pr AS (SELECT program_id FROM program WHERE program_code='III-C1-MEALS')
INSERT INTO referral (client_id, referral_source_id, referred_at,
                      contact_method, urgency, received_by, outcome)
SELECT ic.client_id, rs.referral_source_id, now(), 'phone', 'routine',
       cm.staff_id, 'opened_client'
FROM referral_source rs CROSS JOIN cm CROSS JOIN ic
WHERE rs.code = 'SELF';

SELECT 'referral inserted' AS step, count(*) FROM referral;

-- Program enrollment so the OAA view finds the client
WITH pr AS (SELECT program_id FROM program WHERE program_code='III-C1-MEALS'),
     ic AS (SELECT client_id FROM client WHERE client_number='C-0001'),
     cm AS (SELECT staff_id FROM staff WHERE email='bob@asap.example')
INSERT INTO client_program_enrollment (client_id, program_id, member_id,
                                         effective_date, eligibility_status,
                                         verified_by)
SELECT ic.client_id, pr.program_id, 'MH-ID-0001', CURRENT_DATE, 'eligible',
       cm.staff_id
FROM pr CROSS JOIN ic CROSS JOIN cm;

WITH pr AS (SELECT program_id FROM program WHERE program_code='III-C1-MEALS'),
     ic AS (SELECT client_id FROM client WHERE client_number='C-0001'),
     cm AS (SELECT staff_id FROM staff WHERE email='bob@asap.example')
INSERT INTO intake_case (client_id, program_id, case_number, opened_at,
                         case_type, primary_staff_id)
SELECT ic.client_id, pr.program_id, 'IC-0001', CURRENT_DATE,
       'home_delivered_meals', cm.staff_id
FROM pr CROSS JOIN ic CROSS JOIN cm;

SELECT 'intake_case inserted' AS step, count(*) FROM intake_case;

WITH ic AS (SELECT intake_case_id FROM intake_case WHERE case_number='IC-0001'),
     cm AS (SELECT staff_id FROM staff WHERE email='alice@asap.example')
INSERT INTO assessment (intake_case_id, assessment_type, instrument, assessed_at,
                        performed_by, body, frailty_score, care_need_level)
SELECT ic.intake_case_id, 'initial', 'EOEA_IIA', CURRENT_DATE,
       cm.staff_id,
       '{"adls":["bathing","dressing"]}'::jsonb, 4, 'moderate'
FROM ic CROSS JOIN cm;

-- Service definition for that program
INSERT INTO service_definition (program_id, service_code, service_name, unit_type,
                              default_rate_cents, effective_date)
SELECT program_id, 'HDM-MEAL', 'Home Delivered Meal', 'meal', 1500,
       DATE '2024-10-01'
FROM program WHERE program_code='III-C1-MEALS';

-- Care plan authored against the case
WITH ic AS (SELECT intake_case_id FROM intake_case WHERE case_number='IC-0001'),
     cm AS (SELECT staff_id FROM staff WHERE email='bob@asap.example')
INSERT INTO care_plan (intake_case_id, plan_version, effective_from,
                       author_date, authored_by, summary)
SELECT ic.intake_case_id, 1, CURRENT_DATE, CURRENT_DATE, cm.staff_id,
       'Initial meal plan'
FROM ic CROSS JOIN cm;

WITH cp AS (SELECT care_plan_id FROM care_plan WHERE summary='Initial meal plan'),
     sd AS (SELECT service_id FROM service_definition WHERE service_code='HDM-MEAL')
INSERT INTO care_plan_service (care_plan_id, service_id, planned_units,
                              planned_unit_type, planned_start_date,
                              planned_end_date, frequency)
SELECT cp.care_plan_id, sd.service_id, 12, 'meal',
       CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days', 'weekly'
FROM cp CROSS JOIN sd;

-- Authorization
WITH cps AS (SELECT care_plan_service_id FROM care_plan_service
              WHERE planned_unit_type='meal'),
     pr AS (SELECT program_id FROM program WHERE program_code='III-C1-MEALS'),
     ic AS (SELECT client_id FROM client WHERE client_number='C-0001'),
     cm AS (SELECT staff_id FROM staff WHERE email='bob@asap.example')
INSERT INTO service_authorization (care_plan_service_id, program_id, client_id,
                                    authorization_no, status, approved_at,
                                    approved_by, effective_date, end_date,
                                    funding_basis, revenue_code)
SELECT cps.care_plan_service_id, pr.program_id, ic.client_id,
       'AUTH-0001', 'active', CURRENT_DATE,
       cm.staff_id, CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days',
       'unit', '5XXX'
FROM cps CROSS JOIN pr CROSS JOIN ic CROSS JOIN cm;

SELECT 'authorization inserted' AS step, count(*) FROM service_authorization;

-- Authorized unit batch
INSERT INTO authorized_unit_batch (authorization_id, service_id, unit_count,
                                    unit_type, rate_cents, effective_date,
                                    end_date, authorized_by)
SELECT sa.authorization_id, sd.service_id, 12, 'meal', 1500, CURRENT_DATE,
       CURRENT_DATE + INTERVAL '30 days',
       (SELECT staff_id FROM staff WHERE email='bob@asap.example')
FROM service_authorization sa
JOIN service_definition sd ON sd.service_code='HDM-MEAL';

SELECT 'batches inserted' AS step, count(*) FROM authorized_unit_batch;

-- Hook the meal-vendor as the provider
WITH prov AS (SELECT provider_id FROM provider WHERE provider_name='Example Meal Vendor LLC'),
     ic AS (SELECT client_id FROM client WHERE client_number='C-0001'),
     sa AS (SELECT authorization_id FROM service_authorization WHERE authorization_no='AUTH-0001'),
     bat AS (SELECT batch_id FROM authorized_unit_batch LIMIT 1),
     sd AS (SELECT service_id FROM service_definition WHERE service_code='HDM-MEAL')
INSERT INTO service_delivery
  (authorization_id, batch_id, client_id, worker_id, provider_id, service_id,
   scheduled_date, delivered_date, unit_count, unit_type, status)
SELECT sa.authorization_id, bat.batch_id, ic.client_id, NULL,
       prov.provider_id, sd.service_id, CURRENT_DATE, CURRENT_DATE,
       5, 'meal', 'delivered'
FROM prov CROSS JOIN ic CROSS JOIN sa CROSS JOIN bat CROSS JOIN sd;

SELECT 'delivery (5 units) inserted' AS step, count(*) FROM service_delivery;

-- Deliver 8 more = 13 total, over the 12 limit. Expect RAISE EXCEPTION.
SET app.audit_skip = '0';
DO $$
BEGIN
  BEGIN
    INSERT INTO service_delivery
      (authorization_id, batch_id, client_id, provider_id, service_id,
       scheduled_date, delivered_date, unit_count, unit_type, status)
    SELECT sa.authorization_id, bat.batch_id, ic.client_id,
           prov.provider_id, sd.service_id,
           CURRENT_DATE, CURRENT_DATE, 8, 'meal', 'delivered'
    FROM service_authorization sa
    CROSS JOIN authorized_unit_batch bat
    CROSS JOIN client ic
    CROSS JOIN provider prov
    CROSS JOIN service_definition sd
    WHERE sa.authorization_no = 'AUTH-0001'
      AND ic.client_number = 'C-0001'
      AND prov.provider_name = 'Example Meal Vendor LLC'
      AND sd.service_code = 'HDM-MEAL';
    RAISE NOTICE 'overdraft guard FAILED — should have raised exception';
  EXCEPTION WHEN raise_exception THEN
    RAISE NOTICE 'overdraft guard raised as expected';
  END;
END $$;

-- Reporting view exercise
SELECT 'v_oaa_client_profile' AS step;
SELECT client_number, age_years, sex, ethnicity, age_bucket_oaa,
       adls_needing_help_count
  FROM v_oaa_client_profile ORDER BY client_number;

SELECT 'v_authorization_utilization' AS step;
SELECT authorization_id, units_authorized, units_delivered,
       pct_of_authorized_consumed
  FROM v_authorization_utilization;

-- Final summary
SELECT 'final_audit_count' AS step, count(*) AS audit_rows FROM audit_log;