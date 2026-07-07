/* ============================================================
 * seed.js — demo dataset loaded on first visit (all fictional).
 * Mirrors seeds/sample_data.sql in spirit, expanded for the demo.
 * ============================================================ */

function seedDemoData() {
  const S = Store;
  S.reset();
  const id = () => S.uuid();
  const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
  const daysAhead = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

  /* ---- organization / programs / services ---- */
  const org = S.insert('organization', {
    org_id: id(), legal_name: 'Riverbend Elder Services, Inc.', short_name: 'Riverbend',
    org_type: 'ASAP', primary_phone: '617-555-0100', primary_email: 'info@riverbend.example.org',
    is_active: true
  });
  const payer = S.insert('organization', {
    org_id: id(), legal_name: 'MassHealth (demo payer)', short_name: 'MassHealth',
    org_type: 'STATE', is_active: true
  });

  const progHC = S.insert('program', {
    program_id: id(), org_id: org.org_id, program_code: 'HC', program_name: 'State Home Care',
    funder_type: 'MA_EOEA', effective_date: '2020-07-01', is_active: true
  });
  const progIIIB = S.insert('program', {
    program_id: id(), org_id: org.org_id, program_code: 'III-B', program_name: 'OAA Title III-B Supportive Services',
    funder_type: 'OAA_III_B', effective_date: '2020-10-01', is_active: true
  });
  const progC2 = S.insert('program', {
    program_id: id(), org_id: org.org_id, program_code: 'III-C2', program_name: 'Home Delivered Meals',
    funder_type: 'OAA_III_C2', effective_date: '2020-10-01', is_active: true
  });
  const progFEW = S.insert('program', {
    program_id: id(), org_id: org.org_id, program_code: 'FEW', program_name: 'Frail Elder Waiver (self-direction)',
    funder_type: 'MASSHEALTH', effective_date: '2021-01-01', is_active: true
  });

  const svc = {};
  [
    ['HM', 'Homemaker', 'hour', 3200, progHC],
    ['PC', 'Personal Care', 'hour', 3900, progHC],
    ['HDM', 'Home Delivered Meal', 'meal', 1150, progC2],
    ['TR', 'Medical Transportation', 'ride', 2500, progIIIB],
    ['CH', 'Chore Services', 'hour', 3000, progIIIB],
    ['RSP', 'In-Home Respite', 'hour', 3400, progHC],
    ['PCA', 'PCA (self-directed)', 'hour', 1875, progFEW]
  ].forEach(([code, name, unit, rate, prog]) => {
    svc[code] = S.insert('service_definition', {
      service_id: id(), program_id: prog.program_id, service_code: code, service_name: name,
      unit_type: unit, default_rate_cents: rate, requires_authorization: true,
      is_self_direction_capable: code === 'PCA', effective_date: '2021-01-01'
    });
  });

  const src = {};
  [
    ['SELF', 'Self / Family', 'self_family'],
    ['HOSP', 'Hospital Discharge', 'hospital'],
    ['APS', 'Adult Protective Services', 'state_agency'],
    ['COA', 'Council on Aging', 'community_agency'],
    ['PCP', 'Primary Care Clinic', 'clinic']
  ].forEach(([code, name, cat]) => {
    src[code] = S.insert('referral_source', {
      referral_source_id: id(), code, name, category: cat, is_active: true
    });
  });

  /* ---- staff ---- */
  const st = {};
  [
    ['maria', 'Maria Delgado, RN', 'Intake Nurse'],
    ['james', 'James Okafor', 'Care Manager'],
    ['lin', 'Lin Chen', 'Care Manager'],
    ['pat', 'Pat Sullivan', 'FI / Billing Clerk']
  ].forEach(([k, name, title]) => {
    st[k] = S.insert('staff', {
      staff_id: id(), org_id: org.org_id, email: k + '@riverbend.example.org',
      display_name: name, title, is_active: true
    });
  });

  /* ---- clients + NAPIS ---- */
  const mkClient = (n, first, last, dob, sex, phone, lang, cm, napis) => {
    const c = S.insert('client', {
      client_id: id(), org_id: org.org_id, client_number: 'CL-' + String(n).padStart(5, '0'),
      legal_first_name: first, legal_last_name: last, date_of_birth: dob, sex,
      primary_phone: phone, preferred_language: lang,
      interpreter_needed: lang !== 'English',
      primary_org_staff_id: st[cm].staff_id, intake_first_contact: daysAgo(200 - n * 9),
      is_active: true
    });
    S.insert('client_napis_profile', {
      client_id: c.client_id, ethnicity: napis.eth || 'N', race_oaa: napis.race || ['white'],
      living_arrangement: napis.living || 'alone', federal_poverty_pct: napis.pov || 'unknown',
      is_rural: 'urban', adl_help_needed: napis.adl || [], iadl_help_needed: napis.iadl || [],
      has_family_caregiver: napis.cg || 'U', is_frail: !!napis.frail
    });
    return c;
  };

  const c1 = mkClient(1, 'Eleanor', 'Whitfield', '1938-03-14', 'F', '617-555-0111', 'English', 'james',
    { living: 'alone', pov: 'at_or_below_100', adl: ['bathing', 'dressing'], iadl: ['meal_prep', 'housekeeping', 'shopping'], cg: 'Y', frail: true });
  const c2 = mkClient(2, 'Chen', 'Wei', '1941-11-02', 'M', '617-555-0122', 'Mandarin', 'lin',
    { race: ['asian'], living: 'with_spouse', pov: '101_to_150', iadl: ['phones', 'money', 'transit'], cg: 'Y' });
  const c3 = mkClient(3, 'Rosa', 'Martinez', '1945-06-21', 'F', '617-555-0133', 'Spanish', 'james',
    { eth: 'H', race: ['other'], living: 'with_others', pov: 'at_or_below_100', adl: ['walking'], iadl: ['housekeeping', 'meds'], cg: 'N', frail: true });
  const c4 = mkClient(4, 'Harold', 'Greene', '1936-01-09', 'M', '617-555-0144', 'English', 'lin',
    { race: ['black'], living: 'alone', pov: 'above_150', adl: ['bathing', 'transferring', 'walking'], iadl: ['meal_prep', 'shopping', 'meds'], cg: 'U', frail: true });
  const c5 = mkClient(5, 'Anna', 'Kowalski', '1943-08-30', 'F', '617-555-0155', 'Polish', 'james',
    { living: 'with_spouse', pov: '101_to_150', iadl: ['transit'], cg: 'Y' });
  const c6 = mkClient(6, 'Samuel', 'Osei', '1949-12-17', 'M', '617-555-0166', 'English', 'lin',
    { race: ['black'], living: 'alone', pov: 'at_or_below_100', adl: ['dressing'], iadl: ['housekeeping', 'money'], cg: 'N' });

  S.insert('emergency_contact', { emergency_contact_id: id(), client_id: c1.client_id, contact_name: 'Susan Whitfield-Barnes', relationship: 'daughter', phone: '617-555-0212', priority_order: 1 });
  S.insert('emergency_contact', { emergency_contact_id: id(), client_id: c4.client_id, contact_name: 'Marcus Greene', relationship: 'son', phone: '617-555-0243', priority_order: 1 });
  S.insert('household_member', { household_member_id: id(), client_id: c2.client_id, relationship: 'spouse', full_name: 'Liu Fang', lives_with_client: true, is_caregiver: true, is_emergency_contact: true, phone: '617-555-0223' });
  S.insert('caregiver', { caregiver_id: id(), client_id: c1.client_id, caregiver_name: 'Susan Whitfield-Barnes', relationship: 'daughter', is_primary: true, needs_respite: true, phone: '617-555-0212' });

  [c1, c2, c3, c4, c5, c6].forEach((c, i) => {
    S.insert('client_program_enrollment', {
      enrollment_id: id(), client_id: c.client_id,
      program_id: [progHC, progHC, progC2, progHC, progIIIB, progHC][i].program_id,
      effective_date: daysAgo(180 - i * 12), eligibility_status: 'eligible',
      verified_by: st.maria.staff_id
    });
  });
  S.insert('consent', {
    consent_id: id(), client_id: c1.client_id, consent_type: 'services',
    signed_at: daysAgo(178), signed_by_client: true, pdf_document_ref: 'demo/consent-c1.pdf'
  });

  /* ---- referrals (two still open) ---- */
  const mkRef = (cid, srcK, days, need, urg, outcome, closed) => S.insert('referral', {
    referral_id: id(), client_id: cid, referral_source_id: src[srcK].referral_source_id,
    referred_at: new Date(Date.now() - days * 864e5).toISOString(), contact_method: 'phone',
    presenting_need: need, urgency: urg, outcome, closed_at: closed ? new Date(Date.now() - closed * 864e5).toISOString() : null,
    received_by: st.maria.staff_id
  });
  mkRef(c1.client_id, 'HOSP', 182, 'Post-discharge support after hip replacement', 'urgent', 'opened_client', 180);
  mkRef(c3.client_id, 'APS', 150, 'Self-neglect concern; needs in-home assessment', 'urgent', 'opened_client', 148);
  mkRef(c4.client_id, 'PCP', 120, 'Falls risk, lives alone, needs personal care', 'routine', 'opened_client', 117);
  mkRef(null, 'SELF', 6, 'Daughter calling about meals for father, age 82', 'routine', null, null);
  mkRef(null, 'COA', 2, 'Rides to dialysis three times weekly', 'urgent', null, null);

  /* ---- cases / assessments / care plans ---- */
  const mkCase = (c, prog, num, days, type, staff) => S.insert('intake_case', {
    intake_case_id: id(), client_id: c.client_id, program_id: prog.program_id,
    case_number: num, opened_at: daysAgo(days), case_type: type, primary_staff_id: staff.staff_id
  });
  const k1 = mkCase(c1, progHC, 'HC-2026-0012', 179, 'case_management', st.james);
  const k2 = mkCase(c3, progHC, 'HC-2026-0019', 147, 'case_management', st.james);
  const k3 = mkCase(c4, progHC, 'HC-2026-0023', 116, 'personal_care', st.lin);
  const k4 = mkCase(c2, progFEW, 'FEW-2026-0004', 90, 'self_direction', st.lin);
  const k5 = mkCase(c5, progIIIB, 'IIIB-2026-0031', 60, 'transportation', st.lin);

  const mkAssess = (k, days, type, level, frail, staff, notes) => S.insert('assessment', {
    assessment_id: id(), intake_case_id: k.intake_case_id, assessment_type: type,
    instrument: 'EOEA_IIA', assessed_at: daysAgo(days), performed_by: staff.staff_id,
    care_need_level: level, frailty_score: frail, next_review_due: daysAhead(365 - days),
    notes, body: {}
  });
  mkAssess(k1, 176, 'initial', 'high', 14, st.maria, 'Recovering from hip surgery; needs bathing and dressing assistance daily.');
  mkAssess(k1, 32, 'revisit', 'moderate', 9, st.james, 'Improved mobility with PT; reduce personal care hours.');
  mkAssess(k2, 145, 'initial', 'high', 15, st.maria, 'APS referral confirmed self-neglect; medication management critical.');
  mkAssess(k3, 114, 'initial', 'high', 16, st.maria, 'Multiple falls; ADL support required, home safety eval scheduled.');
  mkAssess(k4, 88, 'initial', 'moderate', 8, st.lin, 'Client and spouse elected self-direction; PCA to be hired.');

  const mkPlan = (k, days, staff, summary) => S.insert('care_plan', {
    care_plan_id: id(), intake_case_id: k.intake_case_id, plan_version: 1,
    effective_from: daysAgo(days), author_date: daysAgo(days),
    authored_by: staff.staff_id, approved_by: st.maria.staff_id, summary
  });
  const p1 = mkPlan(k1, 174, st.james, 'Personal care + homemaking during hip recovery; caregiver respite monthly.');
  const p2 = mkPlan(k2, 143, st.james, 'Homemaker weekly, HDM daily, medication reminders via PC visits.');
  const p3 = mkPlan(k3, 112, st.lin, 'Personal care 5x/week, chore services for home safety.');
  const p4 = mkPlan(k4, 85, st.lin, 'Self-directed PCA 20 hrs/week under FEW budget.');

  [
    [p1, 'Bathe and dress independently by spring', 'health', 70],
    [p1, 'Daughter receives monthly respite', 'caregiver', 100],
    [p2, 'Medications taken as prescribed 30 consecutive days', 'health', 55],
    [p2, 'Home free of safety hazards', 'safety', 80],
    [p3, 'No falls for 90 days', 'safety', 40],
    [p4, 'PCA hired, trained, and delivering scheduled hours', 'health', 90]
  ].forEach(([p, text, domain, pct]) => S.insert('care_plan_goal', {
    goal_id: id(), care_plan_id: p.care_plan_id, goal_text: text, domain,
    progress_pct: pct, achieved: pct === 100, achieved_at: pct === 100 ? daysAgo(20) : null
  }));

  const mkCPS = (p, s, units, start) => S.insert('care_plan_service', {
    care_plan_service_id: id(), care_plan_id: p.care_plan_id, service_id: s.service_id,
    planned_units: units, planned_unit_type: s.unit_type, planned_start_date: start,
    frequency: 'weekly', priority: 3
  });
  const cps1 = mkCPS(p1, svc.PC, 6, daysAgo(172));
  const cps1b = mkCPS(p1, svc.HM, 4, daysAgo(172));
  const cps2 = mkCPS(p2, svc.HM, 3, daysAgo(140));
  const cps2b = mkCPS(p2, svc.HDM, 7, daysAgo(140));
  const cps3 = mkCPS(p3, svc.PC, 10, daysAgo(110));
  const cps4 = mkCPS(p4, svc.PCA, 20, daysAgo(82));
  const cps5 = mkCPS(p3, svc.CH, 2, daysAgo(110));

  /* ---- providers & workers ---- */
  const prov1 = S.insert('provider', {
    provider_id: id(), org_id: org.org_id, provider_name: 'CareFirst Home Care Agency',
    provider_type: 'home_care_agency', payment_model: 'fee_for_service',
    contract_id: 'RB-2025-114', contract_start: '2025-07-01', contract_end: '2027-06-30', is_active: true
  });
  const prov2 = S.insert('provider', {
    provider_id: id(), org_id: org.org_id, provider_name: 'Fresh Plate Meals on Wheels',
    provider_type: 'meal_vendor', payment_model: 'fee_for_service',
    contract_id: 'RB-2025-081', contract_start: '2025-07-01', contract_end: '2026-06-30', is_active: true
  });
  const prov3 = S.insert('provider', {
    provider_id: id(), org_id: org.org_id, provider_name: 'Riverbend Fiscal Intermediary',
    provider_type: 'fiscal_intermediary', payment_model: 'self_direction', is_active: true
  });
  const prov4 = S.insert('provider', {
    provider_id: id(), org_id: org.org_id, provider_name: 'GoRide Medical Transport',
    provider_type: 'transportation', payment_model: 'fee_for_service',
    contract_id: 'RB-2026-007', contract_start: '2026-01-01', contract_end: '2026-12-31', is_active: true
  });

  const mkWorker = (prov, first, last, creds) => S.insert('worker', {
    worker_id: id(), provider_id: prov.provider_id, legal_first_name: first,
    legal_last_name: last, hire_date: '2024-05-01', credentials: creds, is_active: true
  });
  const w1 = mkWorker(prov1, 'Denise', 'Baptiste', ['HHA']);
  const w2 = mkWorker(prov1, 'Kofi', 'Mensah', ['CNA', 'HHA']);
  const w3 = mkWorker(prov3, 'Grace', 'Liu', ['PCA']);
  const w4 = mkWorker(prov4, 'Tony', 'Ramirez', ['CDL']);

  S.insert('worker_credential', { worker_credential_id: id(), worker_id: w1.worker_id, credential_name: 'HHA Certificate', issued_at: '2024-04-15', expires_at: daysAhead(31), issuing_state: 'MA', license_number: 'HHA-88231' });
  S.insert('worker_credential', { worker_credential_id: id(), worker_id: w2.worker_id, credential_name: 'CNA License', issued_at: '2025-02-01', expires_at: daysAhead(240), issuing_state: 'MA', license_number: 'CNA-40912' });
  S.insert('worker_credential', { worker_credential_id: id(), worker_id: w3.worker_id, credential_name: 'PCA Orientation', issued_at: '2025-09-10', expires_at: daysAhead(12), issuing_state: 'MA', license_number: 'PCA-1180' });
  S.insert('worker_credential', { worker_credential_id: id(), worker_id: w4.worker_id, credential_name: 'Commercial Driver License', issued_at: '2023-01-20', expires_at: daysAhead(410), issuing_state: 'MA', license_number: 'CDL-73301' });

  /* ---- authorizations + batches ---- */
  let authSeq = 100;
  const mkAuth = (cps, prog, client, units, svcDef, start, endIn, staff) => {
    const a = S.insert('service_authorization', {
      authorization_id: id(), care_plan_service_id: cps.care_plan_service_id,
      program_id: prog.program_id, client_id: client.client_id,
      authorization_no: 'AUTH-2026-' + (authSeq++), status: 'active',
      approved_at: start, approved_by: st.maria.staff_id,
      effective_date: start, end_date: daysAhead(endIn), funding_basis: 'unit'
    });
    S.insert('authorized_unit_batch', {
      batch_id: id(), authorization_id: a.authorization_id, service_id: svcDef.service_id,
      unit_count: units, unit_type: svcDef.unit_type, rate_cents: svcDef.default_rate_cents,
      effective_date: start, amendment_no: 1, authorized_by: staff.staff_id
    });
    return a;
  };
  const a1 = mkAuth(cps1, progHC, c1, 160, svc.PC, daysAgo(170), 30, st.james);
  const a1b = mkAuth(cps1b, progHC, c1, 100, svc.HM, daysAgo(170), 30, st.james);
  const a2 = mkAuth(cps2, progHC, c3, 80, svc.HM, daysAgo(138), 60, st.james);
  const a2b = mkAuth(cps2b, progC2, c3, 190, svc.HDM, daysAgo(138), 60, st.james);
  const a3 = mkAuth(cps3, progHC, c4, 240, svc.PC, daysAgo(108), 90, st.lin);
  const a4 = mkAuth(cps4, progFEW, c2, 520, svc.PCA, daysAgo(80), 120, st.lin);
  const a5 = mkAuth(cps5, progIIIB, c5, 24, svc.TR, daysAgo(55), 120, st.lin);

  /* ---- deliveries: recurring visits over recent months ---- */
  const batchOf = a => S.all('authorized_unit_batch').find(b => b.authorization_id === a.authorization_id);
  const mkDel = (a, w, prov, sdef, dAgo, units, status) => S.insert('service_delivery', {
    delivery_id: id(), authorization_id: a.authorization_id, batch_id: batchOf(a).batch_id,
    client_id: a.client_id, worker_id: w ? w.worker_id : null, provider_id: prov.provider_id,
    service_id: sdef.service_id, scheduled_date: daysAgo(dAgo),
    delivered_date: status === 'delivered' ? daysAgo(dAgo) : null,
    unit_count: units, unit_type: sdef.unit_type, status,
    documented_by: st.pat.staff_id,
    evv_reference: status === 'delivered' ? 'EVV-' + Math.floor(Math.random() * 90000 + 10000) : null
  });

  for (let wBack = 24; wBack >= 1; wBack--) {
    const d = wBack * 7;
    if (d < 168) { mkDel(a1, w1, prov1, svc.PC, d, 2, wBack === 3 ? 'missed' : 'delivered'); }
    if (d < 168) { mkDel(a1b, w2, prov1, svc.HM, d + 1, 1.5, 'delivered'); }
    if (d < 136) { mkDel(a2, w2, prov1, svc.HM, d, 1.5, wBack === 6 ? 'cancelled_client' : 'delivered'); }
    if (d < 106) { mkDel(a3, w1, prov1, svc.PC, d, 2.5, 'delivered'); }
    if (d < 78) { mkDel(a4, w3, prov3, svc.PCA, d, 10, 'delivered'); }
    if (d < 50 && wBack % 2 === 0) { mkDel(a5, w4, prov4, svc.TR, d, 2, 'delivered'); }
  }
  for (let dd = 2; dd < 132; dd += 2) { if (dd < 130) mkDel(a2b, null, prov2, svc.HDM, dd, 2, 'delivered'); }
  mkDel(a1, w1, prov1, svc.PC, -3, 2, 'scheduled');
  mkDel(a3, w1, prov1, svc.PC, -1, 2.5, 'scheduled');

  /* ---- one posted claim + remittance, one draft ---- */
  const delivered = S.all('service_delivery').filter(d =>
    d.provider_id === prov1.provider_id && d.status === 'delivered');
  const oldLines = delivered.filter(d => d.delivered_date <= daysAgo(60)).slice(0, 18);
  const claim1 = S.insert('claim', {
    claim_id: id(), provider_id: prov1.provider_id, program_id: progHC.program_id,
    payer_org_id: payer.org_id, claim_no: 'CLM-2026-00041',
    service_date_from: oldLines[oldLines.length - 1].delivered_date,
    service_date_to: oldLines[0].delivered_date,
    status: 'paid', submitted_at: new Date(Date.now() - 50 * 864e5).toISOString(),
    total_charge_cents: 0, created_by: st.pat.staff_id
  });
  let total = 0;
  oldLines.forEach(d => {
    const s = S.get('service_definition', d.service_id);
    const cents = Math.round(Number(d.unit_count) * s.default_rate_cents);
    total += cents;
    S.insert('claim_line', {
      claim_line_id: id(), claim_id: claim1.claim_id, delivery_id: d.delivery_id,
      service_id: d.service_id, units: d.unit_count, rate_cents: s.default_rate_cents,
      billed_cents: cents, paid_cents: cents, line_status: 'paid'
    });
    S.update('service_delivery', d.delivery_id, { claimed: true });
  });
  S.update('claim', claim1.claim_id, { total_charge_cents: total });
  const rem = S.insert('remittance', {
    remittance_id: id(), payer_org_id: payer.org_id, edi_control_no: '835-DEMO-7731',
    received_at: new Date(Date.now() - 38 * 864e5).toISOString(),
    total_paid_cents: total, check_eft_ref: 'EFT-99120',
    posted_at: new Date(Date.now() - 37 * 864e5).toISOString()
  });
  S.insert('remittance_line', {
    remittance_line_id: id(), remittance_id: rem.remittance_id, claim_id: claim1.claim_id,
    paid_cents: total, reason_codes: []
  });

  /* ---- self-direction ---- */
  const sde = S.insert('self_direction_enrollment', {
    enrollment_id: id(), client_id: c2.client_id, fi_provider_id: prov3.provider_id,
    program_id: progFEW.program_id, enrollment_date: daysAgo(80),
    budget_amount_cents: 3900000, budget_period: 'annual',
    representative_person: 'Liu Fang (spouse)'
  });
  S.insert('sd_budget_line', {
    sd_budget_line_id: id(), enrollment_id: sde.enrollment_id, category_code: 'PCA',
    category_name: 'Personal Care Attendant', budgeted_cents: 3400000,
    spent_cents: 1237500, period_start: daysAgo(80), period_end: daysAhead(285)
  });
  S.insert('sd_budget_line', {
    sd_budget_line_id: id(), enrollment_id: sde.enrollment_id, category_code: 'GOODS',
    category_name: 'Goods & Equipment', budgeted_cents: 500000,
    spent_cents: 84000, period_start: daysAgo(80), period_end: daysAhead(285)
  });
  const ts = S.insert('timesheet', {
    timesheet_id: id(), enrollment_id: sde.enrollment_id, worker_id: w3.worker_id,
    client_id: c2.client_id, period_start: daysAgo(14), period_end: daysAgo(1),
    total_hours: 20, submitted_at: new Date(Date.now() - 1 * 864e5).toISOString()
  });
  [12, 9, 7, 5].forEach(dd => S.insert('timesheet_line', {
    timesheet_line_id: id(), timesheet_id: ts.timesheet_id, work_date: daysAgo(dd),
    hours: 5, pay_code: 'PCA', rate_cents: 1875
  }));

  S.save();
}
