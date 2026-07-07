/* ============================================================
 * store.js — in-browser data layer mirroring the PostgreSQL
 * schema in /migrations. Tables are arrays of row objects keyed
 * by the same column names as the SQL, persisted to localStorage.
 * Business rules from the SQL triggers (authorization overdraft,
 * batch floor) are enforced here so the demo behaves like the DB.
 * ============================================================ */

const DB_KEY = 'esdb_v1';

const TABLES = [
  'organization', 'program', 'service_definition', 'referral_source',
  'staff', 'client', 'client_napis_profile', 'client_program_enrollment',
  'consent', 'household_member', 'caregiver', 'emergency_contact',
  'referral', 'intake_case', 'assessment', 'care_plan', 'care_plan_goal',
  'care_plan_service', 'service_authorization', 'authorized_unit_batch',
  'provider', 'worker', 'worker_credential', 'service_delivery',
  'claim', 'claim_line', 'remittance', 'remittance_line',
  'self_direction_enrollment', 'sd_budget_line', 'timesheet', 'timesheet_line',
  'audit_log'
];

const ENUMS = {
  sex_code: ['M', 'F', 'X', 'U'],
  ethnicity_code: ['H', 'N', 'U'],
  living_arrangement: ['alone', 'with_spouse', 'with_others', 'facility', 'unknown'],
  federal_poverty: ['at_or_below_100', '101_to_150', 'above_150', 'unknown'],
  rurality: ['urban', 'rural', 'unknown'],
  funder_type: ['OAA_III_B', 'OAA_III_C1', 'OAA_III_C2', 'OAA_III_D', 'OAA_III_E',
    'OAA_VII', 'MA_EOEA', 'MASSHEALTH', 'SSI_SSP', 'OTHER'],
  funding_basis: ['unit', 'block_grant', 'capitation', 'voucher'],
  unit_type: ['hour', 'ride', 'meal', 'contact', 'dollar', 'day', 'visit'],
  authorization_status: ['draft', 'approved', 'active', 'amended', 'expired', 'voided'],
  delivery_status: ['scheduled', 'delivered', 'missed', 'cancelled_client',
    'cancelled_provider', 'cancelled_weather', 'no_show'],
  claim_status: ['draft', 'ready', 'submitted', 'accepted', 'partial', 'denied', 'paid', 'void'],
  urgency: ['emergency', 'urgent', 'routine', 'information_only'],
  contact_method: ['phone', 'in_person', 'email', 'web', 'fax', 'walk_in'],
  referral_outcome: ['information_only', 'recommended_service', 'opened_client',
    'referred_out', 'closed_no_action'],
  case_type: ['case_management', 'homemaker', 'transportation', 'home_delivered_meals',
    'congregate_meals', 'personal_care', 'respite', 'adult_foster_care',
    'self_direction', 'other'],
  care_need_level: ['independent', 'low', 'moderate', 'high', 'end_of_life'],
  assessment_type: ['initial', 'annual', 'revisit', 'discharge'],
  eligibility_status: ['pending', 'eligible', 'denied', 'terminated', 'unknown'],
  provider_type: ['home_care_agency', 'adult_day', 'transportation', 'meal_vendor',
    'personal_care', 'homemaker', 'respite', 'fiscal_intermediary',
    'self_direction_eor', 'other'],
  adl: ['bathing', 'dressing', 'eating', 'toileting', 'transferring', 'walking'],
  iadl: ['meal_prep', 'housekeeping', 'phones', 'shopping', 'money', 'meds', 'transit'],
  race_oaa: ['white', 'black', 'asian', 'native_american', 'hawaiian_pacific',
    'other', 'unknown', 'refused'],
  goal_domain: ['health', 'housing', 'caregiver', 'safety', 'nutrition', 'social', 'financial']
};

const Store = {
  data: null,

  uuid() {
    return crypto.randomUUID ? crypto.randomUUID() :
      'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });
  },

  blank() {
    const d = {};
    TABLES.forEach(t => { d[t] = []; });
    return d;
  },

  load() {
    try {
      const raw = localStorage.getItem(DB_KEY);
      if (raw) { this.data = JSON.parse(raw); return true; }
    } catch (e) { console.warn('load failed', e); }
    this.data = this.blank();
    return false;
  },

  save() {
    localStorage.setItem(DB_KEY, JSON.stringify(this.data));
  },

  reset() {
    localStorage.removeItem(DB_KEY);
    this.data = this.blank();
  },

  all(table) { return this.data[table] || []; },

  get(table, id) {
    const pk = this.pkOf(table);
    return this.all(table).find(r => r[pk] === id) || null;
  },

  pkOf(table) {
    const map = {
      organization: 'org_id', program: 'program_id', service_definition: 'service_id',
      referral_source: 'referral_source_id', staff: 'staff_id', client: 'client_id',
      client_napis_profile: 'client_id', client_program_enrollment: 'enrollment_id',
      consent: 'consent_id', household_member: 'household_member_id',
      caregiver: 'caregiver_id', emergency_contact: 'emergency_contact_id',
      referral: 'referral_id', intake_case: 'intake_case_id', assessment: 'assessment_id',
      care_plan: 'care_plan_id', care_plan_goal: 'goal_id',
      care_plan_service: 'care_plan_service_id',
      service_authorization: 'authorization_id', authorized_unit_batch: 'batch_id',
      provider: 'provider_id', worker: 'worker_id', worker_credential: 'worker_credential_id',
      service_delivery: 'delivery_id', claim: 'claim_id', claim_line: 'claim_line_id',
      remittance: 'remittance_id', remittance_line: 'remittance_line_id',
      self_direction_enrollment: 'enrollment_id', sd_budget_line: 'sd_budget_line_id',
      timesheet: 'timesheet_id', timesheet_line: 'timesheet_line_id',
      audit_log: 'audit_id'
    };
    return map[table];
  },

  /* insert/update mirror generic_audit(): every write lands in audit_log */
  insert(table, row) {
    const pk = this.pkOf(table);
    if (!row[pk]) row[pk] = this.uuid();
    const now = new Date().toISOString();
    if (!('created_at' in row)) row.created_at = now;
    row.updated_at = now;
    this.guard(table, row, 'I');
    this.data[table].push(row);
    this.audit(table, row[pk], 'I', null, row);
    this.save();
    return row;
  },

  update(table, id, patch) {
    const pk = this.pkOf(table);
    const row = this.get(table, id);
    if (!row) throw new Error(table + ' row not found');
    const before = { ...row };
    const candidate = { ...row, ...patch, [pk]: id, updated_at: new Date().toISOString() };
    this.guard(table, candidate, 'U');
    Object.assign(row, candidate);
    this.audit(table, id, 'U', before, row);
    this.save();
    return row;
  },

  remove(table, id) {
    const pk = this.pkOf(table);
    const row = this.get(table, id);
    if (!row) return;
    this.data[table] = this.data[table].filter(r => r[pk] !== id);
    this.audit(table, id, 'D', row, null);
    this.save();
  },

  audit(table, id, op, before, after) {
    this.data.audit_log.push({
      audit_id: this.data.audit_log.length + 1,
      audited_at: new Date().toISOString(),
      table_name: table, pk: id, operation: op,
      before_row: before ? JSON.parse(JSON.stringify(before)) : null,
      after_row: after ? JSON.parse(JSON.stringify(after)) : null
    });
    if (this.data.audit_log.length > 2000) this.data.audit_log.splice(0, 500);
  },

  /* --- business-rule guards ported from the SQL triggers --- */
  guard(table, row, op) {
    if (table === 'service_delivery') this.guardOverdraft(row);
    if (table === 'authorized_unit_batch' && op === 'U') this.guardBatchFloor(row);
  },

  // enforce_authorization_overdraft(): consumed + new units must not
  // exceed total authorized units on the authorization.
  guardOverdraft(row) {
    const counting = ['delivered', 'missed', 'no_show', 'scheduled'];
    if (!counting.includes(row.status)) return;
    const authorized = this.all('authorized_unit_batch')
      .filter(b => b.authorization_id === row.authorization_id)
      .reduce((s, b) => s + Number(b.unit_count), 0);
    const consumed = this.all('service_delivery')
      .filter(d => d.authorization_id === row.authorization_id &&
        d.delivery_id !== row.delivery_id && counting.includes(d.status))
      .reduce((s, d) => s + Number(d.unit_count), 0);
    if (consumed + Number(row.unit_count) > authorized) {
      throw new Error(
        `Authorization overdrawn: ${authorized} units authorized, ` +
        `${consumed} already consumed, tried to add ${row.unit_count}. ` +
        `Amend the authorization with a new unit batch first.`);
    }
  },

  // enforce_batch_floor(): a batch cannot shrink below consumed units
  guardBatchFloor(row) {
    const counting = ['delivered', 'missed', 'no_show', 'scheduled'];
    const consumed = this.all('service_delivery')
      .filter(d => d.batch_id === row.batch_id && counting.includes(d.status))
      .reduce((s, d) => s + Number(d.unit_count), 0);
    if (Number(row.unit_count) < consumed) {
      throw new Error(`Batch cannot go below ${consumed} already-consumed units.`);
    }
  },

  /* --- convenience joins used by views --- */
  clientName(id) {
    const c = this.get('client', id);
    return c ? `${c.legal_last_name}, ${c.legal_first_name}` : '—';
  },
  staffName(id) {
    const s = this.get('staff', id);
    return s ? s.display_name : '—';
  },
  programName(id) {
    const p = this.get('program', id);
    return p ? p.program_name : '—';
  },
  serviceName(id) {
    const s = this.get('service_definition', id);
    return s ? s.service_name : '—';
  },
  providerName(id) {
    const p = this.get('provider', id);
    return p ? p.provider_name : '—';
  },
  workerName(id) {
    const w = this.get('worker', id);
    return w ? `${w.legal_first_name} ${w.legal_last_name}` : '—';
  },

  authUtilization(authId) {
    const counting = ['delivered', 'missed', 'no_show', 'scheduled'];
    const authorized = this.all('authorized_unit_batch')
      .filter(b => b.authorization_id === authId)
      .reduce((s, b) => s + Number(b.unit_count), 0);
    const rows = this.all('service_delivery').filter(d => d.authorization_id === authId);
    const consumed = rows.filter(d => counting.includes(d.status))
      .reduce((s, d) => s + Number(d.unit_count), 0);
    const delivered = rows.filter(d => d.status === 'delivered')
      .reduce((s, d) => s + Number(d.unit_count), 0);
    return { authorized, consumed, delivered,
      pct: authorized ? Math.round(100 * consumed / authorized) : 0 };
  },

  nextNumber(prefix, table, col) {
    const n = this.all(table).length + 1;
    return `${prefix}-${String(n).padStart(5, '0')}`;
  },

  exportJSON() { return JSON.stringify(this.data, null, 1); },

  importJSON(text) {
    const parsed = JSON.parse(text);
    if (!parsed.client || !parsed.organization) throw new Error('Not an elder-services-db export.');
    this.data = { ...this.blank(), ...parsed };
    this.save();
  }
};

const money = c => (c == null ? '—' : '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2 }));
const fmtDate = d => d ? new Date(d + (String(d).length === 10 ? 'T12:00:00' : '')).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
const ageOf = dob => dob ? Math.floor((Date.now() - new Date(dob)) / 31557600000) : null;
const label = s => s == null ? '—' : String(s).replace(/_/g, ' ').replace(/\b\w/g, m => m.toUpperCase());
const todayISO = () => new Date().toISOString().slice(0, 10);
