/* ============================================================
 * views-ops.js — providers/workers, billing, self-direction,
 * reports, data management
 * ============================================================ */

/* ------------------------------------------------ providers */
Views.providers = function (root) {
  const S = Store;
  const addBtn = h('button', {
    class: 'btn primary', onclick: () => formModal('New provider', [
      { k: 'provider_name', label: 'Provider name', required: true },
      { k: 'provider_type', label: 'Type', type: 'select', required: true, options: ENUMS.provider_type },
      { k: 'payment_model', label: 'Payment model', type: 'select', required: true, options: ENUMS.funding_basis.length ? ['fee_for_service', 'managed_care', 'self_direction'] : [] },
      { k: 'contract_id', label: 'Contract #' },
      { k: 'contract_start', label: 'Contract start', type: 'date' },
      { k: 'contract_end', label: 'Contract end', type: 'date' }
    ], out => {
      const org = S.all('organization').find(o => o.org_type === 'ASAP');
      S.insert('provider', { ...out, org_id: org.org_id, is_active: true });
      toast('Provider added'); route();
    })
  }, '+ New provider');

  root.append(pageHead('Providers & workers',
    'Contracted agencies and the individuals delivering units — tables: provider, worker, worker_credential', addBtn,
    h('button', {
      class: 'btn small',
      onclick: () => {
        const rows = [];
        for (const p of S.all('provider')) {
          const ws = S.all('worker').filter(w => w.provider_id === p.provider_id);
          if (!ws.length) rows.push({ provider: p.provider_name, type: p.provider_type, worker: '', credentials: '', hired: '', status: p.is_active ? 'active' : 'inactive' });
          for (const w of ws) {
            const creds = S.all('worker_credential').filter(c => c.worker_id === w.worker_id)
              .map(c => `${c.credential_name}${c.expires_at ? ' → ' + c.expires_at : ''}`).join('; ');
            rows.push({ provider: p.provider_name, type: p.provider_type, worker: `${w.legal_first_name} ${w.legal_last_name}`, credentials: creds || (w.credentials || []).join('; '), hired: w.hire_date || '', status: w.is_active ? 'active' : 'inactive' });
          }
        }
        downloadCSV('providers_workers.csv', rows, [
          { k: 'provider', label: 'Provider' }, { k: 'type', label: 'Type' },
          { k: 'worker', label: 'Worker' }, { k: 'credentials', label: 'Credentials' },
          { k: 'hired', label: 'Hired' }, { k: 'status', label: 'Status' }
        ]);
      }
    }, '⬇ CSV (flat)')));

  const soon = new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10);
  for (const p of S.all('provider')) {
    const workers = S.all('worker').filter(w => w.provider_id === p.provider_id);
    const card = h('div', { class: 'card' },
      h('div', { class: 'table-head' },
        h('h3', {}, p.provider_name, ' ', badge(p.provider_type, 'info')),
        h('div', { class: 'spacer' }),
        h('span', { class: 'muted' }, p.contract_id ? `Contract ${p.contract_id} → ${fmtDate(p.contract_end)}` : 'No contract on file'),
        h('button', {
          class: 'btn small', onclick: () => formModal('Add worker — ' + p.provider_name, [
            { k: 'legal_first_name', label: 'First name', required: true },
            { k: 'legal_last_name', label: 'Last name', required: true },
            { k: 'hire_date', label: 'Hire date', type: 'date', value: todayISO() },
            { k: 'credential_name', label: 'Credential (e.g. HHA, CNA, PCA)' },
            { k: 'expires_at', label: 'Credential expires', type: 'date' }
          ], out => {
            const w = S.insert('worker', {
              provider_id: p.provider_id, legal_first_name: out.legal_first_name,
              legal_last_name: out.legal_last_name, hire_date: out.hire_date,
              credentials: out.credential_name ? [out.credential_name] : [], is_active: true
            });
            if (out.credential_name) S.insert('worker_credential', {
              worker_id: w.worker_id, credential_name: out.credential_name,
              issued_at: todayISO(), expires_at: out.expires_at
            });
            toast('Worker added'); route();
          })
        }, '+ Worker')));
    if (workers.length) {
      card.append(h('table', { class: 'table' },
        h('thead', {}, h('tr', {}, ['Worker', 'Credentials', 'Hired', 'Status'].map(x => h('th', {}, x)))),
        h('tbody', {}, workers.map(w => {
          const creds = S.all('worker_credential').filter(c => c.worker_id === w.worker_id);
          return h('tr', {},
            h('td', {}, h('strong', {}, `${w.legal_first_name} ${w.legal_last_name}`)),
            h('td', {}, creds.length ? creds.map(c => badge(
              `${c.credential_name}${c.expires_at ? ' → ' + fmtDate(c.expires_at) : ''}`,
              c.expires_at && c.expires_at <= soon ? 'warn' : 'muted')) : (w.credentials || []).map(c => badge(c, 'muted'))),
            h('td', {}, fmtDate(w.hire_date)),
            h('td', {}, badge(w.is_active ? 'active' : 'inactive', w.is_active ? 'ok' : 'muted')));
        }))));
    } else {
      card.append(h('p', { class: 'muted' }, 'No workers on file.'));
    }
    root.append(card);
  }
};

/* ------------------------------------------------ billing */
Views.billing = function (root) {
  const S = Store;

  const unbilled = S.all('service_delivery').filter(d => d.status === 'delivered' && !d.claimed);
  const genBtn = h('button', {
    class: 'btn primary', onclick: () => {
      if (!unbilled.length) return toast('No unbilled delivered units.', 'err');
      formModal('Generate claim (837)', [
        {
          k: 'provider_id', label: 'Provider', type: 'select', required: true,
          options: [...new Set(unbilled.map(d => d.provider_id))].map(pid =>
            [pid, `${S.providerName(pid)} — ${unbilled.filter(d => d.provider_id === pid).length} unbilled deliveries`])
        },
        { k: '_s', type: 'section', label: 'All unbilled delivered units for the provider are pulled onto one claim, priced from the authorization batch rate — like the billing-run in 0004.' }
      ], out => {
        const lines = unbilled.filter(d => d.provider_id === out.provider_id);
        const auth0 = S.get('service_authorization', lines[0].authorization_id);
        const payer = S.all('organization').find(o => o.org_type === 'STATE');
        const claim = S.insert('claim', {
          provider_id: out.provider_id, program_id: auth0.program_id,
          payer_org_id: payer ? payer.org_id : null,
          claim_no: S.nextNumber('CLM-2026', 'claim'),
          service_date_from: lines.map(d => d.delivered_date).sort()[0],
          service_date_to: lines.map(d => d.delivered_date).sort().slice(-1)[0],
          status: 'ready', total_charge_cents: 0
        });
        let total = 0;
        lines.forEach(d => {
          const b = S.get('authorized_unit_batch', d.batch_id);
          const rate = b ? b.rate_cents : (S.get('service_definition', d.service_id) || {}).default_rate_cents || 0;
          const cents = Math.round(Number(d.unit_count) * rate);
          total += cents;
          S.insert('claim_line', {
            claim_id: claim.claim_id, delivery_id: d.delivery_id, service_id: d.service_id,
            units: d.unit_count, rate_cents: rate, billed_cents: cents, line_status: 'accepted'
          });
          S.update('service_delivery', d.delivery_id, { claimed: true });
        });
        S.update('claim', claim.claim_id, { total_charge_cents: total });
        toast(`Claim ${claim.claim_no} generated — ${lines.length} lines, ${money(total)}`);
        route();
      });
    }
  }, `⚡ Generate claim (${unbilled.length} unbilled)`);

  root.append(pageHead('Billing & claims',
    'Deliveries → 837 claim → 835 remittance — tables: claim, claim_line, remittance', genBtn));

  const rows = S.all('claim').slice().sort((a, b) => b.created_at.localeCompare(a.created_at));
  root.append(dataTable(rows, [
    { k: 'claim_no', label: 'Claim #' },
    { k: 'provider_id', label: 'Provider', render: r => S.providerName(r.provider_id), csv: r => S.providerName(r.provider_id), searchVal: r => S.providerName(r.provider_id) },
    { k: 'service_date_from', label: 'Service period', render: r => fmtDate(r.service_date_from) + ' → ' + fmtDate(r.service_date_to), csv: r => `${r.service_date_from} to ${r.service_date_to}` },
    { k: '_lines', label: 'Lines', render: r => String(S.all('claim_line').filter(l => l.claim_id === r.claim_id).length), csv: r => S.all('claim_line').filter(l => l.claim_id === r.claim_id).length },
    { k: 'total_charge_cents', label: 'Billed', render: r => money(r.total_charge_cents), csv: r => r.total_charge_cents / 100 },
    {
      k: '_paid', label: 'Paid', render: r => {
        const paid = S.all('remittance_line').filter(l => l.claim_id === r.claim_id)
          .reduce((s, l) => s + Number(l.paid_cents || 0), 0);
        return paid ? money(paid) : '—';
      }, csv: r => {
        const paid = S.all('remittance_line').filter(l => l.claim_id === r.claim_id)
          .reduce((s, l) => s + Number(l.paid_cents || 0), 0);
        return paid ? paid / 100 : '';
      }
    },
    { k: 'status', label: 'Status', render: r => statusBadge(r.status) },
    { k: '_act', label: '', render: r => claimAction(r), csv: () => '' }
  ], { sortKey: 'claim_no', sortDir: -1, exportName: 'claims', searchable: false }));

  function claimAction(r) {
    if (r.status === 'ready' || r.status === 'draft') return h('button', {
      class: 'btn small primary', onclick: () => {
        S.update('claim', r.claim_id, { status: 'submitted', submitted_at: new Date().toISOString() });
        toast('Claim submitted (837 transmitted)'); route();
      }
    }, 'Submit 837');
    if (r.status === 'submitted') return h('button', {
      class: 'btn small primary', onclick: () => {
        const payer = S.all('organization').find(o => o.org_type === 'STATE');
        const rem = S.insert('remittance', {
          payer_org_id: payer ? payer.org_id : r.payer_org_id,
          edi_control_no: '835-' + Math.floor(Math.random() * 90000 + 10000),
          received_at: new Date().toISOString(), total_paid_cents: r.total_charge_cents,
          check_eft_ref: 'EFT-' + Math.floor(Math.random() * 90000 + 10000),
          posted_at: new Date().toISOString()
        });
        S.insert('remittance_line', { remittance_id: rem.remittance_id, claim_id: r.claim_id, paid_cents: r.total_charge_cents, reason_codes: [] });
        S.all('claim_line').filter(l => l.claim_id === r.claim_id)
          .forEach(l => S.update('claim_line', l.claim_line_id, { paid_cents: l.billed_cents, line_status: 'paid' }));
        S.update('claim', r.claim_id, { status: 'paid', accepted_at: new Date().toISOString() });
        toast('835 remittance posted — claim paid'); route();
      }
    }, 'Post 835');
    return null;
  }
};

/* ------------------------------------------------ self-direction */
Views.selfdirection = function (root) {
  const S = Store;
  root.append(pageHead('Self-direction / FI',
    'Consumer-directed care budgets and timesheets — tables: self_direction_enrollment, sd_budget_line, timesheet'));

  for (const e of S.all('self_direction_enrollment')) {
    const lines = S.all('sd_budget_line').filter(l => l.enrollment_id === e.enrollment_id);
    const sheets = S.all('timesheet').filter(t => t.enrollment_id === e.enrollment_id);
    root.append(h('div', { class: 'card' },
      h('h3', {}, S.clientName(e.client_id), ' ', badge(S.programName(e.program_id), 'info')),
      h('p', { class: 'muted' }, `FI: ${S.providerName(e.fi_provider_id)} · enrolled ${fmtDate(e.enrollment_date)} · budget ${money(e.budget_amount_cents)}/${e.budget_period}` +
        (e.representative_person ? ` · rep: ${e.representative_person}` : '')),
      h('h4', {}, 'Budget burn-down'),
      ...lines.map(l => {
        const pct = l.budgeted_cents ? Math.round(100 * l.spent_cents / l.budgeted_cents) : 0;
        return h('div', { class: 'util-row' },
          h('span', { class: 'util-name' }, `${l.category_name}`),
          h('span', { class: 'util-units' }, `${money(l.spent_cents)} / ${money(l.budgeted_cents)}`),
          progressBar(pct));
      }),
      h('h4', {}, 'Timesheets'),
      sheets.length ? h('table', { class: 'table' },
        h('thead', {}, h('tr', {}, ['Worker', 'Period', 'Hours', 'Status', ''].map(x => h('th', {}, x)))),
        h('tbody', {}, sheets.map(t => h('tr', {},
          h('td', {}, S.workerName(t.worker_id)),
          h('td', {}, fmtDate(t.period_start) + ' → ' + fmtDate(t.period_end)),
          h('td', {}, String(t.total_hours)),
          h('td', {}, t.approved_at ? badge('approved', 'ok') : t.submitted_at ? badge('submitted', 'info') : badge('draft', 'muted')),
          h('td', {}, !t.approved_at && t.submitted_at ? h('button', {
            class: 'btn small primary', onclick: () => {
              S.update('timesheet', t.timesheet_id, { approved_at: new Date().toISOString() });
              const pca = lines.find(l => l.category_code === 'PCA');
              if (pca) S.update('sd_budget_line', pca.sd_budget_line_id,
                { spent_cents: pca.spent_cents + Math.round(t.total_hours * 1875) });
              toast('Timesheet approved — budget line updated'); route();
            }
          }, 'Approve') : null))))) : h('p', { class: 'muted' }, 'No timesheets.')));
  }
  if (!S.all('self_direction_enrollment').length)
    root.append(h('div', { class: 'card' }, h('p', { class: 'muted' }, 'No self-direction enrollments.')));
};

/* ------------------------------------------------ reports (the SQL views) */
Views.reports = function (root) {
  const S = Store;
  root.append(pageHead('Reports', 'The reporting views from migrations/0006 computed live, with CSV export'));

  const tabs = [
    ['Units by program/quarter', unitsReport],
    ['OAA client profile', oaaReport],
    ['Authorization utilization', utilReport],
    ['Claim reconciliation', reconReport],
    ['Credential expiry', credReport]
  ];
  const bar = h('div', { class: 'tabbar' });
  const body = h('div', {});
  tabs.forEach(([name, fn], i) => bar.append(h('button', {
    class: 'tab' + (i === 0 ? ' active' : ''),
    onclick: e => { bar.querySelectorAll('.tab').forEach(t => t.classList.remove('active')); e.target.classList.add('active'); body.innerHTML = ''; fn(body); }
  }, name)));
  root.append(bar, body);
  unitsReport(body);

  function reportTable(el, title, viewName, rows, cols) {
    el.append(dataTable(rows, cols, {
      title, searchable: false, actions: [h('button', {
        class: 'btn small', onclick: () => downloadCSV(viewName + '.csv', rows, cols)
      }, '⬇ CSV')], empty: 'No rows.'
    }));
    el.append(h('p', { class: 'muted note' }, 'SQL equivalent: ', h('code', {}, viewName), ' in migrations/0006_reporting_views.sql'));
  }

  function unitsReport(el) {  // v_units_by_program_quarter
    const agg = {};
    S.all('service_delivery').filter(d => d.status === 'delivered' && d.delivered_date).forEach(d => {
      const a = S.get('service_authorization', d.authorization_id);
      const p = a ? S.get('program', a.program_id) : null;
      const dt = new Date(d.delivered_date);
      const q = dt.getFullYear() + '-Q' + (Math.floor(dt.getMonth() / 3) + 1);
      const key = (p ? p.program_code : '?') + '|' + d.service_id + '|' + q;
      agg[key] = agg[key] || {
        program: p ? p.program_name : '—', funder: p ? p.funder_type : '—',
        service: S.serviceName(d.service_id), quarter: q, units: 0, clients: new Set()
      };
      agg[key].units += Number(d.unit_count);
      agg[key].clients.add(d.client_id);
    });
    const rows = Object.values(agg).map(r => ({ ...r, clients: r.clients.size }))
      .sort((a, b) => b.quarter.localeCompare(a.quarter) || a.program.localeCompare(b.program));
    reportTable(el, 'Units delivered by program / service / quarter (Title III SPR shape)', 'v_units_by_program_quarter', rows, [
      { k: 'quarter', label: 'Quarter' }, { k: 'program', label: 'Program' },
      { k: 'funder', label: 'Funder', render: r => badge(r.funder, 'info'), csv: r => r.funder },
      { k: 'service', label: 'Service' },
      { k: 'units', label: 'Units', render: r => r.units.toFixed(1), csv: r => r.units },
      { k: 'clients', label: 'Distinct clients' }]);
  }

  function oaaReport(el) {  // v_oaa_client_profile
    const rows = S.all('client').filter(c => c.is_active).map(c => {
      const n = S.get('client_napis_profile', c.client_id) || {};
      const age = ageOf(c.date_of_birth);
      return {
        client_number: c.client_number, age,
        bucket: age >= 85 ? '85_plus' : age >= 75 ? '75_to_84' : age >= 60 ? '60_to_74' : 'under_60',
        sex: c.sex, ethnicity: n.ethnicity, race: (n.race_oaa || []).join('; '),
        living: n.living_arrangement, poverty: n.federal_poverty_pct,
        adls: (n.adl_help_needed || []).length, iadls: (n.iadl_help_needed || []).length,
        frail: n.is_frail ? 'Y' : 'N'
      };
    });
    reportTable(el, 'De-identified OAA/NAPIS client profile (no names — client_number only)', 'v_oaa_client_profile', rows, [
      { k: 'client_number', label: 'Client #' }, { k: 'bucket', label: 'Age bucket', render: r => label(r.bucket), csv: r => r.bucket },
      { k: 'sex', label: 'Sex' }, { k: 'ethnicity', label: 'Eth.' }, { k: 'race', label: 'Race' },
      { k: 'living', label: 'Living', render: r => label(r.living), csv: r => r.living },
      { k: 'poverty', label: 'Poverty', render: r => label(r.poverty), csv: r => r.poverty },
      { k: 'adls', label: 'ADLs' }, { k: 'iadls', label: 'IADLs' }, { k: 'frail', label: 'Frail' }]);
  }

  function utilReport(el) {  // v_authorization_utilization
    const rows = S.all('service_authorization').map(a => {
      const u = S.authUtilization(a.authorization_id);
      return {
        auth: a.authorization_no, client: S.clientName(a.client_id), status: a.status,
        end: a.end_date, authorized: u.authorized, consumed: u.consumed,
        delivered: u.delivered, pct: u.pct,
        past_end: a.end_date < todayISO() && a.status === 'active' ? 'YES' : ''
      };
    }).sort((a, b) => b.pct - a.pct);
    reportTable(el, 'Authorization utilization watch list', 'v_authorization_utilization', rows, [
      { k: 'auth', label: 'Auth #' }, { k: 'client', label: 'Client' },
      { k: 'status', label: 'Status', render: r => statusBadge(r.status), csv: r => r.status },
      { k: 'end', label: 'Ends', render: r => fmtDate(r.end), csv: r => r.end },
      { k: 'authorized', label: 'Authorized' }, { k: 'consumed', label: 'Consumed' },
      { k: 'pct', label: '% consumed', render: r => progressBar(r.pct), csv: r => r.pct },
      { k: 'past_end', label: 'Past end?' }]);
  }

  function reconReport(el) {  // v_claim_reconciliation
    const rows = S.all('service_delivery').filter(d => d.status === 'delivered').map(d => {
      const cl = S.all('claim_line').find(l => l.delivery_id === d.delivery_id);
      const c = cl ? S.get('claim', cl.claim_id) : null;
      return {
        date: d.delivered_date, client: S.clientName(d.client_id),
        service: S.serviceName(d.service_id), units: d.unit_count,
        claim: c ? c.claim_no : '(unbilled)', claim_status: c ? c.status : '',
        billed: cl ? cl.billed_cents : null, paid: cl ? cl.paid_cents : null
      };
    }).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    reportTable(el, 'Delivery → claim → payment reconciliation', 'v_claim_reconciliation', rows, [
      { k: 'date', label: 'Delivered', render: r => fmtDate(r.date), csv: r => r.date },
      { k: 'client', label: 'Client' }, { k: 'service', label: 'Service' }, { k: 'units', label: 'Units' },
      { k: 'claim', label: 'Claim' },
      { k: 'claim_status', label: 'Claim status', render: r => r.claim_status ? statusBadge(r.claim_status) : h('span', { class: 'warn-text' }, 'unbilled'), csv: r => r.claim_status || 'unbilled' },
      { k: 'billed', label: 'Billed', render: r => money(r.billed), csv: r => r.billed == null ? '' : r.billed / 100 },
      { k: 'paid', label: 'Paid', render: r => money(r.paid), csv: r => r.paid == null ? '' : r.paid / 100 }]);
  }

  function credReport(el) {  // v_credential_expiration
    const cutoff = new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10);
    const rows = S.all('worker_credential')
      .filter(c => c.expires_at && c.expires_at <= cutoff)
      .map(c => {
        const w = S.get('worker', c.worker_id);
        return {
          worker: S.workerName(c.worker_id),
          provider: w ? S.providerName(w.provider_id) : '—',
          credential: c.credential_name, license: c.license_number, expires: c.expires_at,
          days: Math.ceil((new Date(c.expires_at) - Date.now()) / 864e5)
        };
      }).sort((a, b) => a.days - b.days);
    reportTable(el, 'Worker credentials expiring within 60 days', 'v_credential_expiration', rows, [
      { k: 'worker', label: 'Worker' }, { k: 'provider', label: 'Provider' },
      { k: 'credential', label: 'Credential' }, { k: 'license', label: 'License #' },
      { k: 'expires', label: 'Expires', render: r => fmtDate(r.expires), csv: r => r.expires },
      { k: 'days', label: 'Days left', render: r => h('span', { class: r.days < 15 ? 'err-text' : 'warn-text' }, String(r.days)) }]);
  }
};

/* ------------------------------------------------ data management */
Views.data = function (root) {
  const S = Store;
  root.append(pageHead('Data', 'Everything lives in your browser (localStorage) — nothing leaves your machine'));

  const counts = h('div', { class: 'card' }, h('h3', {}, 'Row counts'),
    h('div', { class: 'counts' },
      TABLES.filter(t => t !== 'audit_log').map(t =>
        h('span', { class: 'count-chip' }, label(t), ' ', h('strong', {}, String(S.all(t).length))))));

  const actions = h('div', { class: 'card' }, h('h3', {}, 'Import / export'),
    h('p', { class: 'card-sub' }, 'The demo runs 100% client-side. Export your data as JSON, re-import it later, or reset to the sample dataset.'),
    h('div', { class: 'btn-row' },
      h('button', {
        class: 'btn primary', onclick: () => {
          const blob = new Blob([S.exportJSON()], { type: 'application/json' });
          const a = h('a', { href: URL.createObjectURL(blob), download: 'elder-services-demo-export.json' });
          a.click(); URL.revokeObjectURL(a.href);
        }
      }, '⬇ Export JSON'),
      h('label', { class: 'btn' }, '⬆ Import JSON',
        h('input', {
          type: 'file', accept: '.json', style: 'display:none', onchange: e => {
            const f = e.target.files[0]; if (!f) return;
            f.text().then(t => {
              try { S.importJSON(t); toast('Imported'); route(); }
              catch (err) { toast(err.message, 'err'); }
            });
          }
        })),
      h('button', {
        class: 'btn danger', onclick: () => confirmBox(
          'Reset everything back to the sample dataset? Your entered data will be lost.',
          () => { seedDemoData(); toast('Demo data reset'); route(); })
      }, '↺ Reset demo data')));

  const audit = h('div', {},
    dataTable(S.all('audit_log').slice(-200).reverse(), [
      { k: 'audited_at', label: 'When', render: r => new Date(r.audited_at).toLocaleString(), csv: r => r.audited_at },
      { k: 'table_name', label: 'Table' },
      { k: 'operation', label: 'Op', render: r => badge({ I: 'insert', U: 'update', D: 'delete' }[r.operation], { I: 'ok', U: 'info', D: 'err' }[r.operation]), csv: r => ({ I: 'insert', U: 'update', D: 'delete' }[r.operation] || r.operation) }
    ], { exportName: 'audit_log', title: 'Audit log (latest 200)', empty: 'No audit entries yet.' }),
    h('p', { class: 'muted note' }, 'Mirror of the generic_audit() trigger: who/what/when for every write. Older entries drop off after 2000 records.'));

  root.append(counts, actions, audit);
};
