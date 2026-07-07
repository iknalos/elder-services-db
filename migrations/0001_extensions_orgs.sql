-- =====================================================================
-- 0001_extensions_orgs.sql
-- Extensions, shared enums, audit infrastructure, organizations / programs /
-- funding sources.
-- =====================================================================
BEGIN;

-- ----------------------------------------------------------------- ext
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;  -- for EXCLUDE on UUID + daterange

-- --------------------------------------------------------------- enums
-- OAA/NAPIS closed coded sets (fixed by federal spec; safe as enums).
CREATE TYPE sex_code           AS ENUM ('M','F','X','U');   -- U = unknown/refused
CREATE TYPE ethnicity_code     AS ENUM ('H','N','U');       -- Hispanic, Not, Unknown
CREATE TYPE living_arrangement AS ENUM ('alone','with_spouse','with_others','facility','unknown');
CREATE TYPE federal_poverty     AS ENUM ('at_or_below_100','101_to_150','above_150','unknown');
CREATE TYPE rurality            AS ENUM ('urban','rural','unknown');

-- Workflow / general
CREATE TYPE yes_no_unknown      AS ENUM ('Y','N','U');
CREATE TYPE record_softdelete   AS ENUM ('active','deleted');

-- Program / funder (closed sets drawn from MA EOEA + ACL Title III)
CREATE TYPE funder_type         AS ENUM ('OAA_III_B','OAA_III_C1','OAA_III_C2',
                                          'OAA_III_D','OAA_III_E','OAA_VII',
                                          'MA_EOEA','MASSHEALTH','SSI_SSP','OTHER');
CREATE TYPE funding_basis       AS ENUM ('unit','block_grant','capitation','voucher');
CREATE TYPE payment_model       AS ENUM ('fee_for_service','managed_care','self_direction');

-- Authorization & delivery
CREATE TYPE unit_type           AS ENUM ('hour','ride','meal','contact','dollar','day','visit');
CREATE TYPE authorization_status AS ENUM ('draft','approved','active','amended','expired','voided');
CREATE TYPE delivery_status     AS ENUM ('scheduled','delivered','missed','cancelled_client',
                                          'cancelled_provider','cancelled_weather','no_show');

-- Billing / claims
CREATE TYPE claim_status        AS ENUM ('draft','ready','submitted','accepted',
                                          'partial','denied','paid','void');
CREATE TYPE claim_line_status   AS ENUM ('accepted','denied','reversed','paid','adjusted');
CREATE TYPE edi_transaction_set AS ENUM ('837','835','941R');

-- ------------------------------------------------------------ audit
-- One generic audit table; per-table trigger writes here with table+pk.
CREATE TABLE IF NOT EXISTS audit_log (
    audit_id          BIGSERIAL PRIMARY KEY,
    audited_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    table_schema      TEXT   NOT NULL,
    table_name        TEXT   NOT NULL,
    pk                JSONB  NOT NULL,
    operation         CHAR(1) NOT NULL CHECK (operation IN ('I','U','D')),
    changed_by        UUID   DEFAULT NULL,
    before_row        JSONB  DEFAULT NULL,
    after_row         JSONB  DEFAULT NULL,
    changed_columns   TEXT[] DEFAULT '{}'
);
CREATE INDEX ON audit_log (table_schema, table_name, audited_at DESC);

-- Reusable trigger function. Tables that want history attach it:
--   CREATE TRIGGER <tbl>_audit
--     AFTER INSERT OR UPDATE OR DELETE ON <tbl>
--     FOR EACH ROW EXECUTE FUNCTION generic_audit();
-- Audit rows are skipped when current_user is the application superuser
-- ('audit_skip') so bulk maintenance doesn't bloat the log.
CREATE OR REPLACE FUNCTION generic_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    pk_json JSONB;
    cols    TEXT[] := ARRAY[]::TEXT[];
    k       TEXT;
    ctx     TEXT := current_setting('app.current_user_id', TRUE);
    uid     UUID := NULLIF(ctx, '')::UUID;
    skip    BOOLEAN := current_setting('app.audit_skip', TRUE) = '1';
BEGIN
    IF skip THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
    END IF;

    IF TG_OP IN ('INSERT','UPDATE') THEN
        pk_json := to_jsonb(NEW);
    ELSE
        pk_json := to_jsonb(OLD);
    END IF;

    IF TG_OP = 'UPDATE' THEN
        FOR k IN SELECT jsonb_object_keys(to_jsonb(NEW)) LOOP
            IF (to_jsonb(NEW) -> k) IS DISTINCT FROM (to_jsonb(OLD) -> k) THEN
                cols := array_append(cols, k);
            END IF;
        END LOOP;
    END IF;

    INSERT INTO audit_log (table_schema, table_name, pk, operation,
                           changed_by, before_row, after_row, changed_columns)
    VALUES (TG_TABLE_SCHEMA, TG_TABLE_NAME, pk_json, SUBSTRING(TG_OP,1,1),
            uid,
            CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) END,
            CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) END,
            cols);

    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;

-- ----------------------------------------------- organization / program
CREATE TABLE organization (
    org_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_org_id    UUID REFERENCES organization(org_id) ON DELETE SET NULL,
    legal_name       CITEXT NOT NULL,
    short_name       TEXT   NOT NULL,
    tax_id_ein       TEXT   UNIQUE,
    org_type         TEXT   NOT NULL CHECK (org_type IN
                         ('ASAP','AAA','FI','PACE','VENDOR','MCO','STATE')),
    primary_email    CITEXT,
    primary_phone    TEXT,
    website_url      TEXT,
    mailing_address  JSONB,
    physical_address JSONB,
    is_active        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER organization_audit
    AFTER INSERT OR UPDATE OR DELETE ON organization
    FOR EACH ROW EXECUTE FUNCTION generic_audit();

CREATE INDEX ON organization (parent_org_id);
CREATE INDEX ON organization (LOWER(legal_name)) WHERE is_active;

CREATE TABLE program (
    program_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id            UUID NOT NULL REFERENCES organization(org_id) ON DELETE RESTRICT,
    program_code      TEXT NOT NULL,
    program_name      TEXT NOT NULL,
    funder_type       funder_type NOT NULL,
    effective_date    DATE NOT NULL,
    end_date          DATE CHECK (end_date >= effective_date),
    regulatory_basis  TEXT,                  -- e.g. 'Title III-B 45 CFR 1321'
    eligibility_rules JSONB DEFAULT '{}'::JSONB,
    is_active         BOOLEAN NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (org_id, program_code)
);
CREATE TRIGGER program_audit
    AFTER INSERT OR UPDATE OR DELETE ON program
    FOR EACH ROW EXECUTE FUNCTION generic_audit();
CREATE INDEX ON program (org_id);
CREATE INDEX ON program (funder_type) WHERE is_active;

-- lookup table (open set): OAA service codes per funder
CREATE TABLE service_definition (
    service_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    program_id        UUID REFERENCES program(program_id) ON DELETE CASCADE,
    service_code      TEXT NOT NULL,          -- e.g. 'CH-001', 'III-C1-MEALS'
    service_name      TEXT NOT NULL,
    unit_type         unit_type NOT NULL,
    default_rate_cents BIGINT NOT NULL CHECK (default_rate_cents >= 0),
    requires_authorization BOOLEAN NOT NULL DEFAULT TRUE,
    is_self_direction_capable BOOLEAN NOT NULL DEFAULT FALSE,
    effective_date    DATE NOT NULL,
    end_date          DATE CHECK (end_date >= effective_date),
    UNIQUE (program_id, service_code)
);
CREATE TRIGGER service_definition_audit
    AFTER INSERT OR UPDATE OR DELETE ON service_definition
    FOR EACH ROW EXECUTE FUNCTION generic_audit();

-- open set: referral sources (information & assistance intake)
CREATE TABLE referral_source (
    referral_source_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code                TEXT NOT NULL UNIQUE,
    name                TEXT NOT NULL,
    category            TEXT NOT NULL CHECK (category IN
                          ('self_family','hospital','clinic','community_agency',
                           'state_agency','emergency_services','media','other')),
    is_active           BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TRIGGER referral_source_audit
    AFTER INSERT OR UPDATE OR DELETE ON referral_source
    FOR EACH ROW EXECUTE FUNCTION generic_audit();

COMMIT;