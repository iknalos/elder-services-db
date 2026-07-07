-- =====================================================================
-- 0002_staff_clients.sql
-- Staff / users (with role model), clients, NAPIS/OAA demographics stored
-- separately for de-identified reporting, program enrollments, households,
-- informal caregivers, emergency contacts, consents.
-- =====================================================================
BEGIN;

-- ------------------------------------------------------------- staff / users
CREATE TABLE staff (
    staff_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id            UUID NOT NULL REFERENCES organization(org_id) ON DELETE RESTRICT,
    email             CITEXT NOT NULL UNIQUE,
    display_name      TEXT   NOT NULL,
    title             TEXT,
    license_number    TEXT,
    license_state     TEXT,
    is_active         BOOLEAN NOT NULL DEFAULT TRUE,
    -- Auth at the app layer; here we only store the verifier hash if needed.
    -- HIPAA: never store raw passwords.
    password_hash     TEXT,
    last_login_at     TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER staff_audit
    AFTER INSERT OR UPDATE OR DELETE ON staff
    FOR EACH ROW EXECUTE FUNCTION generic_audit();
CREATE INDEX ON staff (org_id) WHERE is_active;

-- Open set: job roles for an ASAP (Intake RN, Care Manager, FI Clerk, ...)
CREATE TABLE role (
    role_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role_code   TEXT NOT NULL UNIQUE,
    role_name   TEXT NOT NULL,
    can_phi     BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE staff_role (
    staff_id    UUID NOT NULL REFERENCES staff(staff_id) ON DELETE CASCADE,
    role_id     UUID NOT NULL REFERENCES role(role_id) ON DELETE RESTRICT,
    granted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    granted_by  UUID,
    revoked_at  TIMESTAMPTZ,
    PRIMARY KEY (staff_id, role_id, granted_at)
);

-- Which programs a staff member can see/edit (minimum-necessary enforcement)
CREATE TABLE staff_program_assignment (
    staff_id    UUID NOT NULL REFERENCES staff(staff_id) ON DELETE CASCADE,
    program_id  UUID NOT NULL REFERENCES program(program_id) ON DELETE CASCADE,
    access_level TEXT NOT NULL CHECK (access_level IN ('read','write','admin')),
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (staff_id, program_id)
);

-- ------------------------------------------------------------- client
-- Minimal identifying row. Demographics/diagnosis that funder reports need
-- live in client_napis_profile (strippable for de-identified extracts).
CREATE TABLE client (
    client_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id             UUID NOT NULL REFERENCES organization(org_id) ON DELETE RESTRICT,
    client_number      TEXT NOT NULL,
    -- The ASAP-visible client number (SIMS legacy "case number").
    legal_first_name   TEXT   NOT NULL,
    legal_middle_name  TEXT,
    legal_last_name    TEXT   NOT NULL,
    preferred_name     TEXT,
    date_of_birth      DATE   NOT NULL,
    sex                sex_code NOT NULL DEFAULT 'U',
    ssn_last4          TEXT CHECK (ssn_last4 ~ '^[0-9]{4}$' OR ssn_last4 IS NULL),
    ssn_encrypted      TEXT,  -- app-encrypted full SSN, never in plain column
    primary_phone      TEXT,
    primary_email      CITEXT,
    preferred_language TEXT,
    interpreter_needed BOOLEAN NOT NULL DEFAULT FALSE,
    mailing_address    JSONB,
    physical_address   JSONB,
    primary_org_staff_id UUID REFERENCES staff(staff_id),  -- assigned care manager
    intake_first_contact DATE,
    is_active          BOOLEAN NOT NULL DEFAULT TRUE,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (org_id, client_number)
);
CREATE TRIGGER client_audit
    AFTER INSERT OR UPDATE OR DELETE ON client
    FOR EACH ROW EXECUTE FUNCTION generic_audit();
CREATE INDEX ON client (org_id);
CREATE INDEX ON client (legal_last_name, legal_first_name) WHERE is_active;
CREATE INDEX ON client (date_of_birth);

-- ----------------------------------------------- NAPIS / OAA profile (PII)
-- Stored separately so a funder-facing extract can dump this table alone
-- with the client_number (PHI-bridge kept back).
CREATE TABLE client_napis_profile (
    client_id            UUID PRIMARY KEY REFERENCES client(client_id) ON DELETE CASCADE,
    ethnicity            ethnicity_code NOT NULL DEFAULT 'U',
    race_oaa             TEXT[] NOT NULL DEFAULT '{}' CHECK (
                                race_oaa <@ ARRAY['white','black','asian',
                                'native_american','hawaiian_pacific','other',
                                'unknown','refused']::TEXT[]),
    living_arrangement   living_arrangement NOT NULL DEFAULT 'unknown',
    federal_poverty_pct  federal_poverty NOT NULL DEFAULT 'unknown',
    is_rural             rurality NOT NULL DEFAULT 'unknown',
    lives_in_facility    BOOLEAN NOT NULL DEFAULT FALSE,
    primary_language_oaa TEXT,                     -- OAA language code list
    english_proficiency  TEXT CHECK (english_proficiency IN
                             ('not_at_all','not_well','well','very_well','unknown')),
    adl_help_needed      TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
                          -- subset of {bathing,dressing,eating,toileting,
                          -- transferring,walking}
    iadl_help_needed     TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
                          -- {meal_prep,housekeeping,phones,shopping,money,meds,transit}
    has_family_caregiver yes_no_unknown NOT NULL DEFAULT 'U',
    is_targeted_minority BOOLEAN NOT NULL DEFAULT FALSE, -- OAA prioritized
    is_frail             BOOLEAN NOT NULL DEFAULT FALSE, -- OAA III-D threshold
    disability_flag      TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
                          -- {blind,deaf,mobility,cognitive,mental,developmental}
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER client_napis_profile_audit
    AFTER INSERT OR UPDATE OR DELETE ON client_napis_profile
    FOR EACH ROW EXECUTE FUNCTION generic_audit();

-- ----------------------------------------------- program enrollment
-- Which state/federal program the client is on (drives which auths/payers
-- can be used). Effective-dated so historic reporting still resolves.
CREATE TABLE client_program_enrollment (
    enrollment_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id       UUID NOT NULL REFERENCES client(client_id) ON DELETE CASCADE,
    program_id      UUID NOT NULL REFERENCES program(program_id) ON DELETE RESTRICT,
    member_id       TEXT,                  -- e.g. MassHealth ID
    effective_date  DATE NOT NULL,
    disenroll_date  DATE CHECK (disenroll_date >= effective_date),
    eligibility_status TEXT NOT NULL CHECK (eligibility_status IN
                          ('pending','eligible','denied','terminated','unknown')),
    verified_by     UUID REFERENCES staff(staff_id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    EXCLUDE USING gist (
        client_id WITH =,
        program_id WITH =,
        daterange(effective_date, COALESCE(disenroll_date, '9999-12-31'))
        WITH &&
    ) WHERE (eligibility_status = 'eligible')
);
CREATE TRIGGER client_program_enrollment_audit
    AFTER INSERT OR UPDATE OR DELETE ON client_program_enrollment
    FOR EACH ROW EXECUTE FUNCTION generic_audit();
CREATE INDEX ON client_program_enrollment (client_id);
CREATE INDEX ON client_program_enrollment (program_id, effective_date);

-- ---------------------------------------------------- consent / authorizations
-- Tracking what PHI the client has consented to release and to whom.
-- Critical for HIPAA + 42 CFR Part 2.
CREATE TABLE consent (
    consent_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id        UUID NOT NULL REFERENCES client(client_id) ON DELETE CASCADE,
    consent_type     TEXT NOT NULL CHECK (consent_type IN
                       ('services','release_of_info','self_direction',
                        'billing','data_sharing','photo_media')),
    to_org_id        UUID REFERENCES organization(org_id),
    scope_note       TEXT,
    signed_at        DATE NOT NULL,
    expires_at       DATE,
    signed_by_client BOOLEAN NOT NULL DEFAULT TRUE,
    pdf_document_ref TEXT NOT NULL,    -- object key in the doc storage system
    revoked_at       DATE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER consent_audit
    AFTER INSERT OR UPDATE OR DELETE ON consent
    FOR EACH ROW EXECUTE FUNCTION generic_audit();
CREATE INDEX ON consent (client_id) WHERE revoked_at IS NULL;

-- ---------------------------------------------------- household / caregiver
CREATE TABLE household_member (
    household_member_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id            UUID NOT NULL REFERENCES client(client_id) ON DELETE CASCADE,
    relationship         TEXT NOT NULL,         -- 'spouse','daughter','brother', ...
    full_name            TEXT NOT NULL,
    date_of_birth        DATE,
    lives_with_client    BOOLEAN NOT NULL DEFAULT FALSE,
    is_caregiver         BOOLEAN NOT NULL DEFAULT FALSE,
    is_emergency_contact BOOLEAN NOT NULL DEFAULT FALSE,
    phone                TEXT,
    email                CITEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER household_member_audit
    AFTER INSERT OR UPDATE OR DELETE ON household_member
    FOR EACH ROW EXECUTE FUNCTION generic_audit();
CREATE INDEX ON household_member (client_id);
CREATE INDEX ON household_member (client_id) WHERE is_caregiver;

-- Caregiver support records (OAA III-E)
CREATE TABLE caregiver (
    caregiver_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id       UUID NOT NULL REFERENCES client(client_id) ON DELETE CASCADE,
    caregiver_name  TEXT NOT NULL,
    relationship    TEXT,
    is_primary      BOOLEAN NOT NULL DEFAULT FALSE,
    is_paid         BOOLEAN NOT NULL DEFAULT FALSE,
    needs_respite   BOOLEAN NOT NULL DEFAULT FALSE,
    caregiver_role  TEXT,
    phone           TEXT,
    email           CITEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER caregiver_audit
    AFTER INSERT OR UPDATE OR DELETE ON caregiver
    FOR EACH ROW EXECUTE FUNCTION generic_audit();
CREATE INDEX ON caregiver (client_id) WHERE is_primary;

CREATE TABLE emergency_contact (
    emergency_contact_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id            UUID NOT NULL REFERENCES client(client_id) ON DELETE CASCADE,
    contact_name         TEXT NOT NULL,
    relationship         TEXT,
    phone                TEXT,
    email                CITEXT,
    priority_order       SMALLINT NOT NULL DEFAULT 1,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER emergency_contact_audit
    AFTER INSERT OR UPDATE OR DELETE ON emergency_contact
    FOR EACH ROW EXECUTE FUNCTION generic_audit();
CREATE INDEX ON emergency_contact (client_id, priority_order);

COMMIT;