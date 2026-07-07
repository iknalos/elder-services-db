-- =====================================================================
-- 0005_self_direction_payroll.sql
-- Self-direction / fiscal-intermediary module: employer-of-record terms,
-- timesheets (the analog of service_delivery for self-directed workers),
-- payroll runs (recorded as stubs since the actual payroll is cut by a
-- third-party payroll vendor — historically HHAeXchange FI / 941R Express).
-- =====================================================================
BEGIN;

-- enrollment: a client choosing self-direction opts out of agency home care
-- for one or more workers they want to hire directly.
CREATE TABLE self_direction_enrollment (
    enrollment_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id          UUID NOT NULL REFERENCES client(client_id) ON DELETE CASCADE,
    fi_provider_id     UUID NOT NULL REFERENCES provider(provider_id),
    program_id         UUID NOT NULL REFERENCES program(program_id) ON DELETE RESTRICT,
    enrollment_date    DATE NOT NULL,
    disenrollment_date DATE CHECK (disenrollment_date >= enrollment_date),
    budget_amount_cents BIGINT NOT NULL CHECK (budget_amount_cents >= 0),
    budget_period      TEXT CHECK (budget_period IN
                         ('monthly','quarterly','annual')),
    copays_self_pay_cents BIGINT DEFAULT 0,
    representative_person TEXT,           -- representative's name if not client
    notes              TEXT,
    EXCLUDE USING gist (
        client_id WITH =,
        fi_provider_id WITH =,
        daterange(enrollment_date, COALESCE(disenrollment_date,'9999-12-31')) WITH &&
    )
);
CREATE TRIGGER self_direction_enrollment_audit
    AFTER INSERT OR UPDATE OR DELETE ON self_direction_enrollment
    FOR EACH ROW EXECUTE FUNCTION generic_audit();
CREATE INDEX ON self_direction_enrollment (client_id);

-- budget categories within the budget (MassHealth 1915(c) Frail Elder Waiver)
CREATE TABLE sd_budget_line (
    sd_budget_line_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    enrollment_id      UUID NOT NULL REFERENCES self_direction_enrollment(enrollment_id) ON DELETE CASCADE,
    category_code      TEXT NOT NULL,    -- 'PCA','respite','transit','goods'
    category_name      TEXT NOT NULL,
    budgeted_cents     BIGINT NOT NULL CHECK (budgeted_cents >= 0),
    spent_cents        BIGINT NOT NULL DEFAULT 0,
    period_start       DATE NOT NULL,
    period_end         DATE NOT NULL CHECK (period_end >= period_start)
);
CREATE TRIGGER sd_budget_line_audit
    AFTER INSERT OR UPDATE OR DELETE ON sd_budget_line
    FOR EACH ROW EXECUTE FUNCTION generic_audit();

CREATE TABLE timesheet (
    timesheet_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    enrollment_id      UUID NOT NULL REFERENCES self_direction_enrollment(enrollment_id) ON DELETE CASCADE,
    worker_id          UUID NOT NULL REFERENCES worker(worker_id) ON DELETE RESTRICT,
    client_id          UUID NOT NULL REFERENCES client(client_id) ON DELETE RESTRICT,
    period_start       DATE NOT NULL,
    period_end         DATE NOT NULL CHECK (period_end >= period_start),
    total_hours        NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (total_hours >= 0),
    guidance           TEXT,                -- 'AM/PM overnight' rate codes
    submitted_at       TIMESTAMPTZ,
    approved_at        TIMESTAMPTZ,
    approved_by        UUID REFERENCES staff(staff_id),
    voided_at          TIMESTAMPTZ,
    voided_reason      TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER timesheet_audit
    AFTER INSERT OR UPDATE OR DELETE ON timesheet
    FOR EACH ROW EXECUTE FUNCTION generic_audit();
CREATE INDEX ON timesheet (enrollment_id, period_start);
CREATE INDEX ON timesheet (worker_id, period_start);

CREATE TABLE timesheet_line (
    timesheet_line_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    timesheet_id       UUID NOT NULL REFERENCES timesheet(timesheet_id) ON DELETE CASCADE,
    work_date          DATE NOT NULL,
    start_at           TIMESTAMPTZ,
    end_at             TIMESTAMPTZ,
    hours              NUMERIC(10,2) NOT NULL CHECK (hours > 0),
    -- Open set: PCA, Respite, Homemaking, Live-in, Sleep, etc.
    pay_code           TEXT NOT NULL,
    rate_cents         BIGINT NOT NULL,
    funding_source_line UUID REFERENCES authorized_unit_batch(batch_id) ON DELETE SET NULL,
    -- Cross-link to the row in service_delivery so units/payroll reconcile
    delivery_id        UUID UNIQUE REFERENCES service_delivery(delivery_id) ON DELETE SET NULL
);
CREATE TRIGGER timesheet_line_audit
    AFTER INSERT OR UPDATE OR DELETE ON timesheet_line
    FOR EACH ROW EXECUTE FUNCTION generic_audit();
CREATE INDEX ON timesheet_line (timesheet_id);
CREATE INDEX ON timesheet_line (work_date);

-- payroll run stubs. The FI payroll vendor cuts actual checks; we record
-- what we transmitted (941R) and what we got back so the agency can audit.
CREATE TABLE payroll_run (
    payroll_run_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fi_provider_id     UUID NOT NULL REFERENCES provider(provider_id),
    pay_period_start   DATE NOT NULL,
    pay_period_end     DATE NOT NULL CHECK (pay_period_end >= pay_period_start),
    check_date         DATE NOT NULL,
    total_gross_cents  BIGINT NOT NULL DEFAULT 0,
    total_taxes_cents  BIGINT NOT NULL DEFAULT 0,
    total_net_cents    BIGINT NOT NULL DEFAULT 0,
    edi_transaction    edi_transaction_set NOT NULL DEFAULT '941R',
    edi_control_no     TEXT UNIQUE,
    submitted_at       TIMESTAMPTZ,
    accepted_at        TIMESTAMPTZ,
    rejected_reason    TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER payroll_run_audit
    AFTER INSERT OR UPDATE OR DELETE ON payroll_run
    FOR EACH ROW EXECUTE FUNCTION generic_audit();
CREATE INDEX ON payroll_run (fi_provider_id, pay_period_start);

CREATE TABLE payroll_line (
    payroll_line_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payroll_run_id     UUID NOT NULL REFERENCES payroll_run(payroll_run_id) ON DELETE CASCADE,
    timesheet_id        UUID NOT NULL REFERENCES timesheet(timesheet_id),
    worker_id          UUID NOT NULL REFERENCES worker(worker_id),
    gross_cents        BIGINT NOT NULL,
    federal_tax_cents  BIGINT DEFAULT 0,
    state_tax_cents    BIGINT DEFAULT 0,
    fica_cents         BIGINT DEFAULT 0,
    medicare_cents     BIGINT DEFAULT 0,
    fica_employer_cents BIGINT DEFAULT 0,
    medicare_employer_cents BIGINT DEFAULT 0,
    futa_cents         BIGINT DEFAULT 0,
    suta_cents         BIGINT DEFAULT 0,
    workers_comp_cents BIGINT DEFAULT 0,
    net_cents          BIGINT NOT NULL,
    check_number       TEXT
);
CREATE TRIGGER payroll_line_audit
    AFTER INSERT OR UPDATE OR DELETE ON payroll_line
    FOR EACH ROW EXECUTE FUNCTION generic_audit();
CREATE INDEX ON payroll_line (payroll_run_id);
CREATE INDEX ON payroll_line (worker_id);

COMMIT;