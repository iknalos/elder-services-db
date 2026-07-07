/* ============================================================
 * views-core.js — dashboard, clients, referrals
 * ============================================================ */

const Views = {};

/* ------------------------------------------------ dashboard */
Views.dashboard = function (root) {
  const S = Store;
  const activeClients = S.all('client').filter(c => c.is_active).length;
  const openReferrals = S.all('referral').filter(r => !r.outcome).length;
  const activeAuths = S.all('service_authorization').filter(a => a.status === 'active');
  const monthStart = todayISO().slice(0, 8) + '01';
  const unitsThisMonth = S.all('service_delivery')
    .filter(d => d.status === 'delivered' && d.delivered_date >= monthStart)
    .reduce((s, d) => s + Number(d.unit_count), 0);
  const expiring = S.all('worker_credential').filter(c =>
    c.expires_at && c.expires_at <= new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10));
  const pendingClaims = S.all('claim').filter(c => ['draft', 'ready', 'submitted'].includes(c.status)).length;

  root.append(pageHead('Dashboard', 'Riverbend Elder Services — demo agency'));
  root.append(h('div', { class: 'grid stats' },
    statCard(activeClients, 'Active clients'),
    statCard(openReferrals, 'Open referrals', 'awaiting triage', openReferrals ? 'accent' : ''),
    statCard(activeAuths.length, 'Active authorizations'),
    statCard(unitsThisMonth.toFixed(1), 'Units delivered', 'this month'),
    statCard(expiring.length, 'Credentials expiring', 'within 60 days', expiring.length ? 'warn' : ''),
    statCard(pendingClaims, 'Claims in flight')));

  // authorization utilization watch list (mirrors v_authorization_utilization)
  const utilRows = activeAuths.map(a => ({ a, u: S.authUtilization(a.authorization_id) }))
    .sort((x, y) => y.u.pct - x.u.pct).slice(0, 6);
  const watch = h('div', { class: 'card' },
    h('h3', {}, 'Authorization utilization'),
    h('p', { class: 'card-sub' }, 'Highest-consumption active authorizations. The app blocks deliveries that would overdraw an authorization — same rule as the database trigger.'),
    ...utilRows.map(({ a, u }) => h('div', { class: 'util-row' },
      h('a', { class: 'util-name', href: '#authorizations', onclick: () => location.hash = '#authorizations' },
        S.clientName(a.client_id) + ' — ' + a.authorization_no),
      h('span', { class: 'util-units' }, `${u.consumed}/${u.authorized}`),
      progressBar(u.pct))));

  const recent = S.all('audit_log').slice(-8).reverse();
  const activity = h('div', { class: 'card' },
    h('h3', {}, 'Recent activity'),
    h('p', { class: 'card-sub' }, 'From the audit log — every insert/update/delete is recorded, like the generic_audit() trigger.'),
    h('ul', { class: 'activity' }, recent.map(a => h('li', {},
      h('span', { class: 'badge ' + ({ I: 'ok', U: 'info', D: 'err' }[a.operation]) }, { I: 'add', U: 'edit', D: 'del' }[a.operation]),
      ' ', label(a.table_name), ' · ',
      h('span', { class: 'muted' }, new Date(a.audited_at).toLocaleString())))));

  root.append(h('div', { class: 'grid two' }, watch, activity));
};

/* ------------------------------------------------ clients */
function clientForm(existing, onDone) {
  const S = Store;
  const napis = existing ? S.get('client_napis_profile', existing.client_id) || {} : {};
  formModal(existing ? 'Edit client' : 'New client', [
    { k: 'legal_first_name', label: 'First name', required: true, value: existing?.legal_first_name },
    { k: 'legal_last_name', label: 'Last name', required: true, value: existing?.legal_last_name },
    { k: 'date_of_birth', label: 'Date of birth', type: 'date', required: true, value: existing?.date_of_birth },
    { k: 'sex', label: 'Sex', type: 'select', options: [['M', 'Male'], ['F', 'Female'], ['X', 'Nonbinary/other'], ['U', 'Unknown/refused']], value: existing?.sex || 'U', required: true },
    { k: 'primary_phone', label: 'Phone', value: existing?.primary_phone },
    { k: 'primary_email', label: 'Email', type: 'email', value: existing?.primary_email },
    { k: 'preferred_language', label: 'Preferred language', value: existing?.preferred_language || 'English' },
    { k: 'interpreter_needed', label: 'Interpreter needed', type: 'checkbox', value: existing?.interpreter_needed },
    { k: 'primary_org_staff_id', label: 'Care manager', type: 'select', options: selectOptions('staff', 'staff_id', s => s.display_name), value: existing?.primary_org_staff_id },
    { k: '_s1', type: 'section', label: 'OAA / NAPIS profile (drives federal reporting)' },
    { k: 'ethnicity', label: 'Ethnicity', type: 'select', options: [['H', 'Hispanic/Latino'], ['N', 'Not Hispanic'], ['U', 'Unknown']], value: napis.ethnicity || 'U', required: true },
    { k: 'race_oaa', label: 'Race (OAA categories)', type: 'multicheck', options: ENUMS.race_oaa, value: napis.race_oaa, full: true },
    { k: 'living_arrangement', label: 'Living arrangement', type: 'select', options: ENUMS.living_arrangement, value: napis.living_arrangement || 'unknown', required: true },
    { k: 'federal_poverty_pct', label: 'Federal poverty level', type: 'select', options: ENUMS.federal_poverty, value: napis.federal_poverty_pct || 'unknown', required: true },
    { k: 'adl_help_needed', label: 'ADLs needing help', type: 'multicheck', options: ENUMS.adl, value: napis.adl_help_needed, full: true },
    { k: 'iadl_help_needed', label: 'IADLs needing help', type: 'multicheck', options: ENUMS.iadl, value: napis.iadl_help_needed, full: true },
    { k: 'is_frail', label: 'Meets OAA frailty threshold', type: 'checkbox', value: napis.is_frail }
  ], out => {
    const clientCols = ['legal_first_name', 'legal_last_name', 'date_of_birth', 'sex',
      'primary_phone', 'primary_email', 'preferred_language', 'interpreter_needed', 'primary_org_staff_id'];
    const napisCols = ['ethnicity', 'race_oaa', 'living_arrangement', 'federal_poverty_pct',
      'adl_help_needed', 'iadl_help_needed', 'is_frail'];
    const cPatch = {}, nPatch = {};
    clientCols.forEach(k => cPatch[k] = out[k]);
    napisCols.forEach(k => nPatch[k] = out[k]);
    if (existing) {
      Store.update('client', existing.client_id, cPatch);
      if (Store.get('client_napis_profile', existing.client_id))
        Store.update('client_napis_profile', existing.client_id, nPatch);
      else Store.insert('client_napis_profile', { client_id: existing.client_id, ...nPatch });
      toast('Client updated');
    } else {
      const org = Store.all('organization').find(o => o.org_type === 'ASAP');
      const c = Store.insert('client', {
        ...cPatch, org_id: org.org_id, is_active: true,
        client_number: Store.nextNumber('CL', 'client'),
        intake_first_contact: todayISO()
      });
      Store.insert('client_napis_profile', { client_id: c.client_id, ...nPatch });
      toast('Client ' + c.client_number + ' created');
    }
    onDone();
  });
}

Views.clients = function (root, params) {
  if (params) return clientDetail(root, params);
  const S = Store;
  root.append(pageHead('Clients', 'Demographics + NAPIS profile — tables: client, client_napis_profile',
    h('button', { class: 'btn primary', onclick: () => clientForm(null, () => route()) }, '+ New client')));
  root.append(dataTable(S.all('client'), [
    { k: 'client_number', label: 'Client #' },
    { k: 'legal_last_name', label: 'Name', render: r => h('strong', {}, `${r.legal_last_name}, ${r.legal_first_name}`), csv: r => `${r.legal_last_name}, ${r.legal_first_name}`, searchVal: r => r.legal_last_name + ' ' + r.legal_first_name },
    { k: 'date_of_birth', label: 'Age', render: r => `${ageOf(r.date_of_birth)} (${fmtDate(r.date_of_birth)})`, csv: r => r.date_of_birth, sortVal: r => r.date_of_birth },
    { k: 'primary_phone', label: 'Phone' },
    { k: 'preferred_language', label: 'Language', render: r => r.preferred_language + (r.interpreter_needed ? ' 🗣' : '') },
    { k: 'primary_org_staff_id', label: 'Care manager', render: r => S.staffName(r.primary_org_staff_id), csv: r => S.staffName(r.primary_org_staff_id), searchVal: r => S.staffName(r.primary_org_staff_id) },
    { k: 'is_active', label: 'Status', render: r => badge(r.is_active ? 'active' : 'inactive', r.is_active ? 'ok' : 'muted'), csv: r => r.is_active ? 'active' : 'inactive' }
  ], { sortKey: 'legal_last_name', exportName: 'clients', onRow: r => location.hash = '#clients/' + r.client_id }));
};

function clientDetail(root, clientId) {
  const S = Store;
  const c = S.get('client', clientId);
  if (!c) { root.append(h('p', {}, 'Client not found.')); return; }
  const n = S.get('client_napis_profile', clientId) || {};
  const refresh = () => route();

  root.append(pageHead(`${c.legal_first_name} ${c.legal_last_name}`,
    `${c.client_number} · age ${ageOf(c.date_of_birth)} · ${c.preferred_language || ''}`,
    h('button', { class: 'btn', onclick: () => history.back() }, '← Back'),
    h('button', { class: 'btn primary', onclick: () => clientForm(c, refresh) }, 'Edit')));

  const profile = h('div', { class: 'card' }, h('h3', {}, 'Profile'),
    kv('Date of birth', fmtDate(c.date_of_birth)), kv('Sex', c.sex),
    kv('Phone', c.primary_phone), kv('Email', c.primary_email),
    kv('Care manager', S.staffName(c.primary_org_staff_id)),
    kv('Interpreter', c.interpreter_needed ? 'Needed — ' + c.preferred_language : 'Not needed'),
    kv('First contact', fmtDate(c.intake_first_contact)));

  const napis = h('div', { class: 'card' }, h('h3', {}, 'NAPIS / OAA profile'),
    kv('Ethnicity', { H: 'Hispanic/Latino', N: 'Not Hispanic', U: 'Unknown' }[n.ethnicity] || '—'),
    kv('Race', (n.race_oaa || []).map(label).join(', ') || '—'),
    kv('Living arrangement', label(n.living_arrangement)),
    kv('Poverty level', label(n.federal_poverty_pct)),
    kv('ADL help', (n.adl_help_needed || []).map(label).join(', ') || 'None'),
    kv('IADL help', (n.iadl_help_needed || []).map(label).join(', ') || 'None'),
    kv('Frail (OAA)', n.is_frail ? 'Yes' : 'No'));

  const contacts = S.all('emergency_contact').filter(x => x.client_id === clientId);
  const hhold = S.all('household_member').filter(x => x.client_id === clientId);
  const contactCard = h('div', { class: 'card' },
    h('h3', {}, 'Contacts & household'),
    ...contacts.map(x => h('p', {}, '🚨 ', h('strong', {}, x.contact_name), ` (${x.relationship}) — ${x.phone || ''}`)),
    ...hhold.map(x => h('p', {}, '🏠 ', h('strong', {}, x.full_name), ` (${x.relationship})`,
      x.is_caregiver ? badge('caregiver', 'info') : null)),
    h('button', {
      class: 'btn small', onclick: () => formModal('Add emergency contact', [
        { k: 'contact_name', label: 'Name', required: true },
        { k: 'relationship', label: 'Relationship' },
        { k: 'phone', label: 'Phone' }
      ], out => {
        S.insert('emergency_contact', { ...out, client_id: clientId, priority_order: contacts.length + 1 });
        toast('Contact added'); refresh();
      })
    }, '+ Add contact'));

  const enr = S.all('client_program_enrollment').filter(e => e.client_id === clientId);
  const enrCard = h('div', { class: 'card' }, h('h3', {}, 'Program enrollments'),
    ...enr.map(e => h('p', {}, h('strong', {}, S.programName(e.program_id)), ' · since ', fmtDate(e.effective_date), ' ', statusBadge(e.eligibility_status))),
    h('button', {
      class: 'btn small', onclick: () => formModal('Enroll in program', [
        { k: 'program_id', label: 'Program', type: 'select', required: true, options: selectOptions('program', 'program_id', p => p.program_name) },
        { k: 'effective_date', label: 'Effective date', type: 'date', required: true, value: todayISO() },
        { k: 'eligibility_status', label: 'Eligibility', type: 'select', required: true, options: ENUMS.eligibility_status, value: 'pending' },
        { k: 'member_id', label: 'Member ID (e.g. MassHealth)' }
      ], out => { S.insert('client_program_enrollment', { ...out, client_id: clientId }); toast('Enrolled'); refresh(); })
    }, '+ Enroll'));

  const cases = S.all('intake_case').filter(k => k.client_id === clientId);
  const caseCard = h('div', { class: 'card' }, h('h3', {}, 'Cases'),
    ...cases.map(k => h('p', {},
      h('a', { href: '#cases/' + k.intake_case_id }, k.case_number),
      ' · ', label(k.case_type), ' · opened ', fmtDate(k.opened_at),
      k.closed_at ? badge('closed', 'muted') : badge('open', 'ok'))),
    h('button', {
      class: 'btn small', onclick: () => formModal('Open case', [
        { k: 'program_id', label: 'Program', type: 'select', required: true, options: selectOptions('program', 'program_id', p => p.program_name) },
        { k: 'case_type', label: 'Case type', type: 'select', required: true, options: ENUMS.case_type },
        { k: 'primary_staff_id', label: 'Primary staff', type: 'select', options: selectOptions('staff', 'staff_id', s => s.display_name) }
      ], out => {
        const k = S.insert('intake_case', {
          ...out, client_id: clientId, opened_at: todayISO(),
          case_number: S.nextNumber('CASE-2026', 'intake_case')
        });
        toast('Case ' + k.case_number + ' opened'); location.hash = '#cases/' + k.intake_case_id;
      })
    }, '+ Open case'));

  root.append(h('div', { class: 'grid two' }, profile, napis, contactCard, enrCard, caseCard));
}

function kv(k, v) {
  return h('p', { class: 'kv' }, h('span', { class: 'kv-k' }, k), h('span', { class: 'kv-v' }, v ?? '—'));
}

/* ------------------------------------------------ referrals */
Views.referrals = function (root) {
  const S = Store;
  const addBtn = h('button', {
    class: 'btn primary', onclick: () => formModal('New referral', [
      { k: 'referral_source_id', label: 'Referral source', type: 'select', required: true, options: selectOptions('referral_source', 'referral_source_id', s => s.name) },
      { k: 'contact_method', label: 'Contact method', type: 'select', options: ENUMS.contact_method, value: 'phone' },
      { k: 'urgency', label: 'Urgency', type: 'select', required: true, options: ENUMS.urgency, value: 'routine' },
      { k: 'client_id', label: 'Existing client (if known)', type: 'select', options: selectOptions('client', 'client_id', c => `${c.legal_last_name}, ${c.legal_first_name}`) },
      { k: 'presenting_need', label: 'Presenting need', type: 'textarea', full: true, required: true },
      { k: 'requested_service', label: 'Requested service' }
    ], out => {
      const staff = S.all('staff')[0];
      S.insert('referral', { ...out, referred_at: new Date().toISOString(), received_by: staff.staff_id });
      toast('Referral logged'); route();
    })
  }, '+ New referral');

  root.append(pageHead('Referrals & intake', 'Information & Assistance contacts — table: referral', addBtn));

  const rows = S.all('referral').slice().sort((a, b) => b.referred_at.localeCompare(a.referred_at));
  root.append(dataTable(rows, [
    { k: 'referred_at', label: 'Received', render: r => fmtDate(r.referred_at.slice(0, 10)), csv: r => r.referred_at.slice(0, 10) },
    { k: 'referral_source_id', label: 'Source', render: r => (S.get('referral_source', r.referral_source_id) || {}).name, csv: r => (S.get('referral_source', r.referral_source_id) || {}).name || '', searchVal: r => (S.get('referral_source', r.referral_source_id) || {}).name },
    { k: 'client_id', label: 'Client', render: r => r.client_id ? h('a', { href: '#clients/' + r.client_id }, S.clientName(r.client_id)) : h('em', { class: 'muted' }, 'not yet a client'), csv: r => r.client_id ? S.clientName(r.client_id) : '', searchVal: r => S.clientName(r.client_id) },
    { k: 'presenting_need', label: 'Presenting need' },
    { k: 'urgency', label: 'Urgency', render: r => badge(r.urgency, { emergency: 'err', urgent: 'warn', routine: 'info', information_only: 'muted' }[r.urgency]) },
    { k: 'outcome', label: 'Outcome', render: r => r.outcome ? statusBadge(r.outcome) : triageBtn(r), csv: r => r.outcome || '' }
  ], { sortKey: 'referred_at', sortDir: -1, exportName: 'referrals', empty: 'No referrals yet — add the first one.' }));

  function triageBtn(r) {
    return h('button', {
      class: 'btn small primary', onclick: e => {
        e.stopPropagation();
        formModal('Triage referral', [
          { k: '_s', type: 'section', label: r.presenting_need || '' },
          { k: 'outcome', label: 'Outcome', type: 'select', required: true, options: ENUMS.referral_outcome }
        ], out => {
          S.update('referral', r.referral_id, { outcome: out.outcome, closed_at: new Date().toISOString() });
          toast('Referral closed: ' + label(out.outcome));
          if (out.outcome === 'opened_client' && !r.client_id) {
            clientForm(null, () => route());
          } else route();
        });
      }
    }, 'Triage');
  }
};
