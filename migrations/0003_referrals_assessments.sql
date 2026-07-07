-- =====================================================================
-- 0003_referrals_assessments.sql
-- Referrals / intake, assessment instruments, care plans (versioned),
-- service authorizations (the bridge from planning to billing).
-- =====================================================================
BEGIN;

-- ------------------------------------------------------------ referral
-- Information & Assistance contact that may (or may not) become a case.
CREATE TABLE referral (
    referral_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id            UUID REFERENCES client(client_id) ON DELETE SET NULL,
    referral_source_id   UUID NOT NULL REFERENCES referral_source(referral_source_id),
    referred_at          TIMESTAMPTZ NOT NULL,
    contact_method       TEXT CHECK (contact_method IN
                           ('phone','in_person','email','web','fax','walk_in')),
    presenting_need      TEXT,
    requested_service    TEXT,
    urgency              TEXT CHECK (urgency IN
                           ('emergency','urgent','routine','information_only')),
    referred_to_program  UUID REFERENCES program(program_id),
    referred_to_org      UUID REFERENCES organization(org_id),
    outcome              TEXT CHECK (outcome IN
                           ('information_only','recommended_service',
                            'opened_client','referred_out','closed_no_action')),
    closed_at            TIMESTAMPTZ,
    received_by          UUID NOT NULL REFERENCES staff(staff_id),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER referral_audit
    AFTER INSERT OR UPDATE OR DELETE ON referral
    FOR EACH ROW EXECUTE FUNCTION generic_audit();
CREATE INDEX ON referral (client_id);
CREATE INDEX ON referral (referred_at);

-- ------------------------------------------------------------ intake case
-- A "case" is an active service relationship with an ASAP program.
CREATE TABLE intake_case (
    intake_case_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id         UUID NOT NULL REFERENCES client(client_id) ON DELETE CASCADE,
    program_id        UUID NOT NULL REFERENCES program(program_id) ON DELETE RESTRICT,
    case_number       TEXT NOT NULL,
    opened_at         DATE NOT NULL,
    closed_at         DATE,
    case_type         TEXT CHECK (case_type IN
                         ('case_management','homemaker','transportation',
                          'home_delivered_meals','congregate_meals',
                          'personal_care','respite','adult_foster_care',
                          'self_direction','other')),
    primary_staff_id UUID REFERENCES staff(staff_id),
    closed_reason     TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (program_id, case_number)
);
CREATE TRIGGER intake_case_audit
    AFTER INSERT OR UPDATE OR DELETE ON intake_case
    FOR EACH ROW EXECUTE FUNCTION generic_audit();
CREATE INDEX ON intake_case (client_id);
CREATE INDEX ON intake_case (program_id, opened_at);

-- ------------------------------------------------------------- assessment
-- A point-in-time assessment; instrument may vary (Mass Senior Care /
-- EOEA int. assessment, NMCAA, e.g.). Body stored as structured JSONB.
CREATE TABLE assessment (
    assessment_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    intake_case_id    UUID NOT NULL REFERENCES intake_case(intake_case_id) ON DELETE CASCADE,
    assessment_type   TEXT NOT NULL,     -- 'initial','annual','revisit','discharge'
    instrument        TEXT NOT NULL,     -- 'EOEA_IIA','USDAA_HCBS','MA_Frail_Elder', ...
    assessed_at       DATE NOT NULL,
    performed_by      UUID REFERENCES staff(staff_id),
    body              JSONB NOT NULL DEFAULT '{}'::JSONB,
    notes             TEXT,
    -- Denormalized for query convenience: A summary score
    frailty_score     SMALLINT,
    care_need_level  TEXT CHECK (care_need_level IN
                        ('independent','low','moderate','high','end_of_life')),
    next_review_due   DATE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER assessment_audit
    AFTER INSERT OR UPDATE OR DELETE ON assessment
    FOR EACH ROW EXECUTE FUNCTION generic_audit();
CREATE INDEX ON assessment (intake_case_id, assessed_at);
CREATE INDEX ON assessment USING gin (body jsonb_path_ops);

-- ------------------------------------------------------------- care plan
-- Care plans are time-versioned with valid_from/valid_to so funders can ask
-- "what did the plan say on the date units were delivered?"
CREATE TABLE care_plan (
    care_plan_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    intake_case_id    UUID NOT NULL REFERENCES intake_case(intake_case_id) ON DELETE CASCADE,
    plan_version      INT  NOT NULL DEFAULT 1,
    effective_from    DATE NOT NULL,
    effective_to      DATE,                  -- NULL = currently active
    author_date       DATE NOT NULL,
    authored_by       UUID NOT NULL REFERENCES staff(staff_id),
    approved_by       UUID REFERENCES staff(staff_id),
    reviewed_at       DATE,
    summary           TEXT,
    -- unique active rule: only one per case can be un-ended
    EXCLUDE USING gist (
        intake_case_id WITH =,
        daterange(effective_from, COALESCE(effective_to,'9999-12-31')) WITH &&
    )
);
CREATE TRIGGER care_plan_audit
    AFTER INSERT OR UPDATE OR DELETE ON care_plan
    FOR EACH ROW EXECUTE FUNCTION generic_audit();
CREATE INDEX ON care_plan (intake_case_id, effective_from);

CREATE TABLE care_plan_goal (
    goal_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    care_plan_id      UUID NOT NULL REFERENCES care_plan(care_plan_id) ON DELETE CASCADE,
    goal_text         TEXT NOT NULL,
    domain            TEXT,         -- 'health','housing','caregiver','safety', ...
    target_date       DATE,
    achieved          BOOLEAN NOT NULL DEFAULT FALSE,
    achieved_at       DATE,
    -- 0..100 progress marker for funder reporting
    progress_pct      SMALLINT NOT NULL DEFAULT 0 CHECK (progress_pct BETWEEN 0 AND 100),
    notes             TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER care_plan_goal_audit
    AFTER INSERT OR UPDATE OR DELETE ON care_plan_goal
    FOR EACH ROW EXECUTE FUNCTION generic_audit();
CREATE INDEX ON care_plan_goal (care_plan_id);

-- services requested by the plan (each may lead to an authorization)
CREATE TABLE care_plan_service (
    care_plan_service_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    care_plan_id        UUID NOT NULL REFERENCES care_plan(care_plan_id) ON DELETE CASCADE,
    service_id          UUID NOT NULL REFERENCES service_definition(service_id),
    planned_units       NUMERIC(10,2) NOT NULL CHECK (planned_units > 0),
    planned_unit_type   unit_type NOT NULL,
    planned_start_date  DATE NOT NULL,
    planned_end_date    DATE CHECK (planned_end_date >= planned_start_date),
    frequency           TEXT,         -- 'weekly','monthly','as_needed'
    priority            SMALLINT NOT NULL DEFAULT 5,
    notes               TEXT
);
CREATE TRIGGER care_plan_service_audit
    AFTER INSERT OR UPDATE OR DELETE ON care_plan_service
    FOR EACH ROW EXECUTE FUNCTION generic_audit();
CREATE INDEX ON care_plan_service (care_plan_id);

-- ------------------------------------------------------------- authorizations
-- The authorization is what the ASAP signs to pay for units. Each
-- authorization may have multiple batches (re-issue, expansion).
CREATE TABLE service_authorization (
    authorization_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    care_plan_service_id UUID NOT NULL REFERENCES care_plan_service(care_plan_service_id),
    program_id         UUID NOT NULL REFERENCES program(program_id) ON DELETE RESTRICT,
    client_id          UUID NOT NULL REFERENCES client(client_id) ON DELETE CASCADE,
    authorization_no   TEXT NOT NULL UNIQUE,
    status             authorization_status NOT NULL DEFAULT 'draft',
    approved_at        DATE,
    approved_by        UUID REFERENCES staff(staff_id),
    effective_date     DATE NOT NULL,
    end_date           DATE NOT NULL CHECK (end_date >= effective_date),
    funding_basis      funding_basis NOT NULL,
    -- Which MassHealth/OAA service revenue line applies
    revenue_code       TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER service_authorization_audit
    AFTER INSERT OR UPDATE OR DELETE ON service_authorization
    FOR EACH ROW EXECUTE FUNCTION generic_audit();
CREATE INDEX ON service_authorization (client_id);
CREATE INDEX ON service_authorization (program_id, effective_date);
CREATE INDEX ON service_authorization (status) WHERE status = 'active';

CREATE TABLE authorized_unit_batch (
    batch_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    authorization_id   UUID NOT NULL REFERENCES service_authorization(authorization_id) ON DELETE CASCADE,
    service_id         UUID NOT NULL REFERENCES service_definition(service_id),
    unit_count         NUMERIC(10,2) NOT NULL CHECK (unit_count > 0),
    unit_type          unit_type NOT NULL,
    rate_cents         BIGINT NOT NULL CHECK (rate_cents >= 0),
    effective_date     DATE NOT NULL,
    end_date           DATE CHECK (end_date >= effective_date),
    amendment_no       SMALLINT NOT NULL DEFAULT 1,
    authorized_by      UUID NOT NULL REFERENCES staff(staff_id),
    -- cumulative authorized units cannot be less than already delivered
    -- (enforced by trigger in 0004 once deliveries exist)
    notes              TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER authorized_unit_batch_audit
    AFTER INSERT OR UPDATE OR DELETE ON authorized_unit_batch
    FOR EACH ROW EXECUTE FUNCTION generic_audit();
CREATE INDEX ON authorized_unit_batch (authorization_id);

COMMIT;