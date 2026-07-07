-- =====================================================================
-- 0004_providers_deliveries_billing.sql
-- Provider / worker (vendor agencies and individual PCA/worker records),
-- service deliveries (units actually delivered), Medicaid claims (837/835),
-- and an over-draft trigger so deliveries can't exceed authorizations.
-- =====================================================================
BEGIN;

-- ------------------------------------------------------------ provider
-- Provider = the legal entity paid (home-care agency, transport vendor,
-- or self-direction employer-of-record). rate_payer just labels payment flow.
CREATE TABLE provider (
    provider_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id            UUID NOT NULL REFERENCES organization(org_id) ON DELETE RESTRICT,
    provider_npi      TEXT UNIQUE,             -- National Provider Identifier
    provider_name     CITEXT NOT NULL,
    provider_type     TEXT CHECK (provider_type IN
                        ('home_care_agency','adult_day','transportation',
                         'meal_vendor','personal_care','homemaker','respite',
                         'fiscal_intermediary','self_direction_eor','other')),
    contract_id       TEXT,
    contract_start    DATE,
    contract_end      DATE,
    payment_model     payment_model NOT NULL,
    is_active         BOOLEAN NOT NULL DEFAULT TRUE,
    tax_id_ein        TEXT,
    mailing_address   JSONB,
    banking_info_ref  TEXT,                    -- pointer only; never ACH numbers here
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER provider_audit
    AFTER INSERT OR UPDATE OR DELETE ON provider
    FOR EACH ROW EXECUTE FUNCTION generic_audit();
CREATE INDEX ON provider (org_id) WHERE is_active;

-- ------------------------------------------------------------ worker
-- Individual who actually delivers a unit. For self-direction the "worker"
-- is the PCA, and provider_id is the fiscal intermediary that pays them.
CREATE TABLE worker (
    worker_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id       UUID NOT NULL REFERENCES provider(provider_id) ON DELETE CASCADE,
    ssn_encrypted     TEXT,                    -- app-encrypted, never display
    legal_first_name  TEXT NOT NULL,
    legal_last_name   TEXT NOT NULL,
    date_of_birth     DATE,
    hire_date         DATE,
    termination_date  DATE,
    -- Open set of credentials (CNA, HHA, RN, PCA-certified, driver-CDL)
    credentials       TEXT[] NOT NULL DEFAULT '{}',
    preferred_phone   TEXT,
    email             CITEXT,
    is_active         BOOLEAN NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER worker_audit
    AFTER INSERT OR UPDATE OR DELETE ON worker
    FOR EACH ROW EXECUTE FUNCTION generic_audit();
CREATE INDEX ON worker (provider_id) WHERE is_active;

-- credentials back to a credentials registry so we can alert on expiry
CREATE TABLE worker_credential (
    worker_credential_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id          UUID NOT NULL REFERENCES worker(worker_id) ON DELETE CASCADE,
    credential_name    TEXT NOT NULL,
    issued_at          DATE,
    expires_at         DATE,
    issuing_state      TEXT,
    license_number     TEXT,
    document_ref       TEXT
);
CREATE TRIGGER worker_credential_audit
    AFTER INSERT OR UPDATE OR DELETE ON worker_credential
    FOR EACH ROW EXECUTE FUNCTION generic_audit();
CREATE INDEX ON worker_credential (expires_at);

-- ------------------------------------------------------------- service delivery
-- Each row = a session/visit/meal delivered against an authorization batch.
-- Money is derived at billing time (rate_cents from batch → claim line).
CREATE TABLE service_delivery (
    delivery_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    authorization_id  UUID NOT NULL REFERENCES service_authorization(authorization_id),
    batch_id          UUID NOT NULL REFERENCES authorized_unit_batch(batch_id),
    client_id          UUID NOT NULL REFERENCES client(client_id) ON DELETE RESTRICT,
    worker_id         UUID REFERENCES worker(worker_id) ON DELETE SET NULL,
    provider_id        UUID NOT NULL REFERENCES provider(provider_id) ON DELETE RESTRICT,
    service_id        UUID NOT NULL REFERENCES service_definition(service_id),
    scheduled_date     DATE NOT NULL,
    scheduled_start    TIMESTAMPTZ,
    scheduled_end      TIMESTAMPTZ,
    actual_start      TIMESTAMPTZ,
    actual_end        TIMESTAMPTZ,
    delivered_date     DATE,
    unit_count         NUMERIC(10,2) NOT NULL CHECK (unit_count > 0),
    unit_type          unit_type NOT NULL,
    status             delivery_status NOT NULL DEFAULT 'scheduled',
    -- Reason codes for missed/cancelled visits (MassHealth 837 reason codes)
    exception_code     TEXT,
    notes              TEXT,
    -- Quality / fidelity fields MassHealth audits:
    documented_by      UUID REFERENCES staff(staff_id),
    -- EVV (Electronic Visit Verification) per 21st Century Cures Act
    evv_reference      TEXT,
    evv_verified_at    TIMESTAMPTZ,
    evv_location_gps   POINT,                  -- lat/long, nullable for non-home
    -- For self-direction: balance against timesheet, see 0005.
    timesheet_id       UUID,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER service_delivery_audit
    AFTER INSERT OR UPDATE OR DELETE ON service_delivery
    FOR EACH ROW EXECUTE FUNCTION generic_audit();
CREATE INDEX ON service_delivery (authorization_id, scheduled_date);
CREATE INDEX ON service_delivery (client_id, scheduled_date);
CREATE INDEX ON service_delivery (worker_id, scheduled_date);
CREATE INDEX ON service_delivery (status) WHERE status NOT IN ('delivered','scheduled');
-- BJ index for date-range report queries
CREATE INDEX ON service_delivery (delivered_date);

-- Overdraft guard: raise exception if delivered units (excluding cancelled)
-- exceed authorized+amendments on the batch.
CREATE OR REPLACE FUNCTION enforce_authorization_overdraft() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    authorized NUMERIC(10,2);
    consumed   NUMERIC(10,2);
BEGIN
    SELECT COALESCE(SUM(unit_count), 0) INTO authorized
      FROM authorized_unit_batch
     WHERE authorization_id = NEW.authorization_id;

    -- Exclude the row being changed so UPDATE doesn't double-count the
    -- old version; for INSERT, NEW.delivery_id is not yet in the table so
    -- the exclusion is a no-op.
    SELECT COALESCE(SUM(unit_count), 0) INTO consumed
      FROM service_delivery
     WHERE authorization_id = NEW.authorization_id
       AND delivery_id   <> NEW.delivery_id
       AND status IN ('delivered','missed','no_show','scheduled');

    IF NEW.status IN ('delivered','missed','no_show','scheduled') AND
       (consumed + NEW.unit_count) > authorized THEN
        RAISE EXCEPTION
            'authorization % overdrawn: authorized=%, would-be consumed=%',
            NEW.authorization_id, authorized, consumed + NEW.unit_count;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER service_delivery_overdraft
    BEFORE INSERT OR UPDATE OF unit_count, status ON service_delivery
    FOR EACH ROW EXECUTE FUNCTION enforce_authorization_overdraft();

-- Identical guard on authorized_unit_batch shrinkage (lowering unit_count
-- below what's already consumed is impossible).
CREATE OR REPLACE FUNCTION enforce_batch_floor() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    consumed_batches NUMERIC(10,2);
BEGIN
    SELECT COALESCE(SUM(sd.unit_count),0) INTO consumed_batches
      FROM service_delivery sd
     WHERE sd.batch_id    = NEW.batch_id
       AND sd.status IN ('delivered','missed','no_show','scheduled');

    IF NEW.unit_count < consumed_batches THEN
        RAISE EXCEPTION
          'batch % unit_count cannot go below already consumed %',
          NEW.batch_id, consumed_batches;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER authorized_unit_batch_floor
    BEFORE INSERT OR UPDATE OF unit_count ON authorized_unit_batch
    FOR EACH ROW EXECUTE FUNCTION enforce_batch_floor();

-- ------------------------------------------------------------- claims
-- Each billing run produces one claim per (provider x payer x day_range).
-- Each claim has line items = service deliveries grouped.
CREATE TABLE claim (
    claim_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id        UUID NOT NULL REFERENCES provider(provider_id),
    program_id         UUID NOT NULL REFERENCES program(program_id),
    payer_org_id       UUID REFERENCES organization(org_id),
    edi_transaction    edi_transaction_set NOT NULL DEFAULT '837',
    claim_no           TEXT NOT NULL UNIQUE,
    edi_control_no     TEXT,
    service_date_from  DATE NOT NULL,
    service_date_to    DATE NOT NULL CHECK (service_date_to >= service_date_from),
    total_charge_cents BIGINT NOT NULL DEFAULT 0 CHECK (total_charge_cents >= 0),
    status             claim_status NOT NULL DEFAULT 'draft',
    submitted_at       TIMESTAMPTZ,
    accepted_at        TIMESTAMPTZ,
    rejected_reason    TEXT,
    created_by         UUID REFERENCES staff(staff_id),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER claim_audit
    AFTER INSERT OR UPDATE OR DELETE ON claim
    FOR EACH ROW EXECUTE FUNCTION generic_audit();
CREATE INDEX ON claim (provider_id, status);
CREATE INDEX ON claim (status) WHERE status IN ('draft','ready','submitted');

CREATE TABLE claim_line (
    claim_line_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    claim_id            UUID NOT NULL REFERENCES claim(claim_id) ON DELETE CASCADE,
    delivery_id         UUID NOT NULL REFERENCES service_delivery(delivery_id),
    service_id          UUID NOT NULL REFERENCES service_definition(service_id),
    revenue_code        TEXT,
    units               NUMERIC(10,2) NOT NULL,
    rate_cents          BIGINT NOT NULL,
    billed_cents        BIGINT NOT NULL,
    allowed_cents       BIGINT,
    paid_cents          BIGINT,
    copay_cents         BIGINT DEFAULT 0,
    adjustment_cents    BIGINT DEFAULT 0,
    line_status         claim_line_status NOT NULL DEFAULT 'accepted',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER claim_line_audit
    AFTER INSERT OR UPDATE OR DELETE ON claim_line
    FOR EACH ROW EXECUTE FUNCTION generic_audit();
CREATE INDEX ON claim_line (claim_id);
CREATE INDEX ON claim_line (delivery_id);

-- 835 remittance: one remittance can cover multiple claims (typical payer batch)
CREATE TABLE remittance (
    remittance_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payer_org_id        UUID NOT NULL REFERENCES organization(org_id),
    edi_control_no      TEXT NOT NULL UNIQUE,
    edi_transaction     edi_transaction_set NOT NULL DEFAULT '835',
    received_at         TIMESTAMPTZ NOT NULL,
    total_paid_cents    BIGINT NOT NULL DEFAULT 0,
    check_eft_ref       TEXT,
    posted_at           TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER remittance_audit
    AFTER INSERT OR UPDATE OR DELETE ON remittance
    FOR EACH ROW EXECUTE FUNCTION generic_audit();

CREATE TABLE remittance_line (
    remittance_line_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    remittance_id        UUID NOT NULL REFERENCES remittance(remittance_id) ON DELETE CASCADE,
    claim_id             UUID NOT NULL REFERENCES claim(claim_id) ON DELETE CASCADE,
    claim_line_id        UUID REFERENCES claim_line(claim_line_id) ON DELETE SET NULL,
    payer_claim_control  TEXT,
    paid_cents           BIGINT NOT NULL,
    adjustment_cents     BIGINT DEFAULT 0,
    reason_codes         TEXT[],
    posted_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER remittance_line_audit
    AFTER INSERT OR UPDATE OR DELETE ON remittance_line
    FOR EACH ROW EXECUTE FUNCTION generic_audit();
CREATE INDEX ON remittance_line (remittance_id);
CREATE INDEX ON remittance_line (claim_id);

COMMIT;