-- =====================================================================
-- 0006_reporting_views.sql
-- Views the agency's reporting team uses for the standard funder reports.
-- All de-identified (no client name/SSN); designed so these can be exposed
-- to analytics roles without PHI concerns.
-- =====================================================================
BEGIN;

-- Active clients per program with their OAA/NAPIS reportable attributes.
CREATE OR REPLACE VIEW v_oaa_client_profile AS
SELECT
    c.client_id,
    c.org_id,
    c.client_number,
    p.program_id,
    p.funder_type,
    EXTRACT(YEAR FROM age(CURRENT_DATE, c.date_of_birth))::INT AS age_years,
    c.sex,
    n.ethnicity,
    n.race_oaa,
    n.living_arrangement,
    n.federal_poverty_pct,
    n.is_rural,
    n.is_targeted_minority,
    n.is_frail,
    CASE
        WHEN c.date_of_birth <= CURRENT_DATE - INTERVAL '85 years' THEN '85_plus'
        WHEN c.date_of_birth <= CURRENT_DATE - INTERVAL '75 years' THEN '75_to_84'
        WHEN c.date_of_birth <= CURRENT_DATE - INTERVAL '60 years' THEN '60_to_74'
        ELSE 'under_60' END AS age_bucket_oaa,
    array_length(n.adl_help_needed, 1) AS adls_needing_help_count,
    array_length(n.iadl_help_needed, 1) AS iadls_needing_help_count
FROM client c
JOIN client_napis_profile n ON n.client_id = c.client_id
JOIN client_program_enrollment e ON e.client_id = c.client_id
JOIN program p ON p.program_id = e.program_id
WHERE c.is_active
  AND (e.disenroll_date IS NULL OR e.disenroll_date >= CURRENT_DATE);

-- Units delivered per program / funder_type / quarter / service (Title III
-- State Program Report -- SPR equivalent).
CREATE OR REPLACE VIEW v_units_by_program_quarter AS
SELECT
    p.program_id,
    p.funder_type,
    p.program_code,
    s.service_code,
    s.service_name,
    sd.unit_type,
    date_trunc('quarter', sd.delivered_date)::DATE AS quarter,
    SUM(sd.unit_count) AS units_delivered,
    COUNT(DISTINCT sd.client_id) AS distinct_clients
FROM service_delivery sd
JOIN service_definition s ON s.service_id = sd.service_id
JOIN service_authorization a ON a.authorization_id = sd.authorization_id
JOIN program p ON p.program_id = a.program_id
WHERE sd.status = 'delivered'
  AND sd.delivered_date IS NOT NULL
GROUP BY p.program_id, p.funder_type, p.program_code,
         s.service_code, s.service_name, sd.unit_type, quarter;

-- Authorization overdraft watch list
CREATE OR REPLACE VIEW v_authorization_utilization AS
SELECT
    a.authorization_id,
    a.client_id,
    a.program_id,
    a.status,
    a.end_date,
    COALESCE(SUM(b.unit_count),0) AS units_authorized,
    COALESCE(SUM(CASE WHEN sd.status IN
       ('delivered','missed','no_show','scheduled') THEN sd.unit_count END),0)
        AS units_consumed,
    COALESCE(SUM(CASE WHEN sd.status = 'delivered'
       THEN sd.unit_count END),0) AS units_delivered,
    CASE WHEN COALESCE(SUM(b.unit_count),0) = 0 THEN 0
         ELSE ROUND(100.0 * COALESCE(SUM(CASE
              WHEN sd.status IN ('delivered','missed','no_show',
                                    'scheduled')
              THEN sd.unit_count END),0) / SUM(b.unit_count), 2)
    END AS pct_of_authorized_consumed,
    CASE WHEN a.end_date < CURRENT_DATE AND a.status = 'active'
         THEN TRUE ELSE FALSE END AS past_end_date
FROM service_authorization a
LEFT JOIN authorized_unit_batch b ON b.authorization_id = a.authorization_id
LEFT JOIN service_delivery sd ON sd.authorization_id = a.authorization_id
GROUP BY a.authorization_id, a.client_id, a.program_id, a.status, a.end_date;

-- Claim reconciliation: each delivery with its claim & remittance status
CREATE OR REPLACE VIEW v_claim_reconciliation AS
SELECT
    sd.delivery_id,
    sd.client_id,
    sd.provider_id,
    sd.service_id,
    sd.delivered_date,
    sd.unit_count,
    sd.unit_type,
    cn.claim_id,
    cn.claim_no,
    cn.status AS claim_status,
    cl.claim_line_id,
    cl.billed_cents,
    cl.paid_cents,
    cl.adjustment_cents,
    cl.line_status AS claim_line_status,
    rl.remittance_id,
    rl.paid_cents AS remittance_paid_cents,
    rl.reason_codes
FROM service_delivery sd
LEFT JOIN claim_line cl ON cl.delivery_id = sd.delivery_id
LEFT JOIN claim cn     ON cn.claim_id = cl.claim_id
LEFT JOIN remittance_line rl ON rl.claim_line_id = cl.claim_line_id
WHERE sd.status = 'delivered';

-- Expiring worker credentials (within 60 days): compliance report
CREATE OR REPLACE VIEW v_credential_expiration AS
SELECT
    w.worker_id,
    w.provider_id,
    pr.provider_name,
    wc.credential_name,
    wc.license_number,
    wc.issuing_state,
    wc.expires_at,
    (wc.expires_at - CURRENT_DATE) AS days_until_expiry
FROM worker_credential wc
JOIN worker w   ON w.worker_id = wc.worker_id
JOIN provider pr ON pr.provider_id = w.provider_id
WHERE wc.expires_at IS NOT NULL
  AND wc.expires_at <= CURRENT_DATE + INTERVAL '60 days'
  AND w.is_active;

-- Self-direction budget burn-down
CREATE OR REPLACE VIEW v_sd_budget_utilization AS
SELECT
    bl.sd_budget_line_id,
    bl.enrollment_id,
    bl.category_code,
    bl.category_name,
    bl.budgeted_cents,
    bl.spent_cents,
    bl.budgeted_cents - bl.spent_cents AS remaining_cents,
    CASE WHEN bl.budgeted_cents = 0 THEN 0
         ELSE ROUND(100.0 * bl.spent_cents / bl.budgeted_cents, 2)
    END AS pct_spent,
    bl.period_start,
    bl.period_end
FROM sd_budget_line bl;

COMMIT;