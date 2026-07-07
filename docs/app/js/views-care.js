/* ============================================================
 * views-care.js — cases (assessments + care plans),
 * authorizations, service deliveries
 * ============================================================ */

/* ------------------------------------------------ cases */
Views.cases = function (root, params) {
  if (params) return caseDetail(root, params);
  const S = Store;
  root.append(pageHead('Cases', 'Active service relationships — tables: intake_case, assessment, care_plan'));
  root.append(dataTable(S.all('intake_case'), [
    { k: 'case_number', label: 'Case #' },
    { k: 'client_id', label: 'Client', render: r => S.clientName(r.client_id), searchVal: r => S.clientName(r.client_id) },
    { k: 'program_id', label: 'Program', render: r => S.programName(r.program_id), searchVal: r => S.programName(r.program_id) },
    { k: 'case_type', label: 'Type', render: r => label(r.case_type) },
    { k: 'opened_at', label: 'Opened', render: r => fmtDate(r.opened_at) },
    { k: 'primary_staff_id', label: 'Staff', render: r => S.staffName(r.primary_staff_id) },
    { k: 'closed_at', label: 'Status', render: r => r.closed_at ? badge('closed', 'muted') : badge('open', 'ok') }
  ], { sortKey: 'opened_at', sortDir: -1, onRow: r => location.hash = '#cases/' + r.intake_case_id }));
};

function caseDetail(root, caseId) {
  const S = Store;
  const k = S.get('intake_case', caseId);
  if (!k) { root.append(h('p', {}, 'Case not found.')); return; }
  const refresh = () => route();

  root.append(pageHead('Case ' + k.case_number,
    S.clientName(k.client_id) + ' · ' + S.programName(k.program_id) + ' · ' + label(k.case_type),
    h('button', { class: 'btn', onclick: () => history.back() }, '← Back'),
    h('a', { class: 'btn', href: '#clients/' + k.client_id }, 'Client record'),
    k.closed_at ? null : h('button', {
      class: 'btn danger', onclick: () => confirmBox('Close this case?', () => {
        S.update('intake_case', caseId, { closed_at: todayISO(), closed_reason: 'closed in demo' });
        toast('Case closed'); refresh();
      })
    }, 'Close case')));

  /* --- assessments --- */
  const assessments = S.all('assessment').filter(a => a.intake_case_id === caseId)
    .sort((a, b) => b.assessed_at.localeCompare(a.assessed_at));
  const aCard = h('div', { class: 'card' },
    h('div', { class: 'table-head' }, h('h3', {}, 'Assessments'), h('div', { class: 'spacer' }),
      h('button', {
        class: 'btn small primary', onclick: () => formModal('New assessment', [
          { k: 'assessment_type', label: 'Type', type: 'select', required: true, options: ENUMS.assessment_type },
          { k: 'instrument', label: 'Instrument', type: 'select', required: true, options: ['EOEA_IIA', 'MA_Frail_Elder', 'Caregiver_TCARE', 'Home_Safety'] },
          { k: 'assessed_at', label: 'Date', type: 'date', required: true, value: todayISO() },
          { k: 'performed_by', label: 'Performed by', type: 'select', options: selectOptions('staff', 'staff_id', s => s.display_name) },
          { k: 'care_need_level', label: 'Care need level', type: 'select', required: true, options: ENUMS.care_need_level },
          { k: 'frailty_score', label: 'Frailty score (0–20)', type: 'number', min: 0 },
          { k: 'notes', label: 'Notes', type: 'textarea', full: true }
        ], out => {
          S.insert('assessment', { ...out, intake_case_id: caseId, body: {} });
          toast('Assessment recorded'); refresh();
        })
      }, '+ Assessment')),
    ...assessments.map(a => h('div', { class: 'list-item' },
      h('div', {}, h('strong', {}, label(a.assessment_type)), ' · ', a.instrument, ' · ', fmtDate(a.assessed_at),
        ' — ', badge(a.care_need_level, { high: 'err', end_of_life: 'err', moderate: 'warn', low: 'info', independent: 'ok' }[a.care_need_level]),
        a.frailty_score != null ? ` frailty ${a.frailty_score}` : ''),
      a.notes ? h('p', { class: 'muted' }, a.notes) : null)),
    assessments.length ? null : h('p', { class: 'muted' }, 'No assessments yet.'));

  /* --- care plan (latest) --- */
  const plans = S.all('care_plan').filter(p => p.intake_case_id === caseId)
    .sort((a, b) => (b.plan_version || 0) - (a.plan_version || 0));
  const plan = plans[0];
  const pCard = h('div', { class: 'card' });
  pCard.append(h('div', { class: 'table-head' }, h('h3', {}, 'Care plan'), h('div', { class: 'spacer' }),
    plan ? null : h('button', {
      class: 'btn small primary', onclick: () => formModal('New care plan', [
        { k: 'summary', label: 'Plan summary', type: 'textarea', required: true, full: true },
        { k: 'authored_by', label: 'Authored by', type: 'select', required: true, options: selectOptions('staff', 'staff_id', s => s.display_name) }
      ], out => {
        S.insert('care_plan', {
          ...out, intake_case_id: caseId, plan_version: 1,
          effective_from: todayISO(), author_date: todayISO()
        });
        toast('Care plan created'); refresh();
      })
    }, '+ Care plan')));

  if (plan) {
    pCard.append(h('p', {}, h('em', {}, plan.summary || '')),
      h('p', { class: 'muted' }, `v${plan.plan_version} · effective ${fmtDate(plan.effective_from)} · by ${S.staffName(plan.authored_by)}`));

    const goals = S.all('care_plan_goal').filter(g => g.care_plan_id === plan.care_plan_id);
    pCard.append(h('h4', {}, 'Goals'),
      ...goals.map(g => h('div', { class: 'util-row' },
        h('span', { class: 'util-name' }, (g.achieved ? '✅ ' : '') + g.goal_text + (g.domain ? ` (${label(g.domain)})` : '')),
        progressBar(g.progress_pct, 200),
        h('button', {
          class: 'btn small', onclick: () => formModal('Update goal', [
            { k: 'progress_pct', label: 'Progress %', type: 'number', min: 0, required: true, value: g.progress_pct },
            { k: 'achieved', label: 'Achieved', type: 'checkbox', value: g.achieved }
          ], out => {
            S.update('care_plan_goal', g.goal_id, { ...out, achieved_at: out.achieved ? todayISO() : null });
            toast('Goal updated'); refresh();
          })
        }, 'Update'))),
      h('button', {
        class: 'btn small', onclick: () => formModal('Add goal', [
          { k: 'goal_text', label: 'Goal', required: true, full: true },
          { k: 'domain', label: 'Domain', type: 'select', options: ENUMS.goal_domain },
          { k: 'target_date', label: 'Target date', type: 'date' }
        ], out => { S.insert('care_plan_goal', { ...out, care_plan_id: plan.care_plan_id, progress_pct: 0, achieved: false }); toast('Goal added'); refresh(); })
      }, '+ Goal'));

    const planned = S.all('care_plan_service').filter(s => s.care_plan_id === plan.care_plan_id);
    pCard.append(h('h4', {}, 'Planned services'),
      ...planned.map(ps => {
        const hasAuth = S.all('service_authorization').some(a => a.care_plan_service_id === ps.care_plan_service_id);
        return h('div', { class: 'list-item row' },
          h('span', {}, h('strong', {}, S.serviceName(ps.service_id)), ` — ${ps.planned_units} ${ps.planned_unit_type}(s)/${ps.frequency || 'period'}`),
          hasAuth ? badge('authorized', 'ok') : h('button', {
            class: 'btn small primary', onclick: () => authorizeService(k, ps, refresh)
          }, 'Authorize'));
      }),
      h('button', {
        class: 'btn small', onclick: () => formModal('Add planned service', [
          { k: 'service_id', label: 'Service', type: 'select', required: true, options: selectOptions('service_definition', 'service_id', s => `${s.service_name} (${s.unit_type})`) },
          { k: 'planned_units', label: 'Units per period', type: 'number', step: '0.25', required: true },
          { k: 'frequency', label: 'Frequency', type: 'select', options: ['weekly', 'monthly', 'as_needed'], value: 'weekly' },
          { k: 'planned_start_date', label: 'Start', type: 'date', required: true, value: todayISO() }
        ], out => {
          const sdef = S.get('service_definition', out.service_id);
          S.insert('care_plan_service', { ...out, care_plan_id: plan.care_plan_id, planned_unit_type: sdef.unit_type, priority: 3 });
          toast('Service planned'); refresh();
        })
      }, '+ Planned service'));
  } else {
    pCard.append(h('p', { class: 'muted' }, 'No care plan yet — assessments first, then plan.'));
  }

  root.append(h('div', { class: 'grid two' }, aCard, pCard));
}

function authorizeService(intakeCase, cps, onDone) {
  const S = Store;
  const sdef = S.get('service_definition', cps.service_id);
  formModal('Create authorization — ' + sdef.service_name, [
    { k: 'unit_count', label: `Authorized units (${sdef.unit_type}s)`, type: 'number', step: '0.25', required: true, hint: 'Total units for the authorization period.' },
    { k: 'rate_cents', label: 'Rate per unit ($)', type: 'number', step: '0.01', required: true, value: sdef.default_rate_cents / 100 },
    { k: 'effective_date', label: 'Effective', type: 'date', required: true, value: todayISO() },
    { k: 'end_date', label: 'Ends', type: 'date', required: true, value: new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10) },
    { k: 'approved_by', label: 'Approved by', type: 'select', required: true, options: selectOptions('staff', 'staff_id', s => s.display_name) }
  ], out => {
    const a = S.insert('service_authorization', {
      care_plan_service_id: cps.care_plan_service_id, program_id: intakeCase.program_id,
      client_id: intakeCase.client_id, authorization_no: S.nextNumber('AUTH-2026', 'service_authorization'),
      status: 'active', approved_at: todayISO(), approved_by: out.approved_by,
      effective_date: out.effective_date, end_date: out.end_date, funding_basis: 'unit'
    });
    S.insert('authorized_unit_batch', {
      authorization_id: a.authorization_id, service_id: cps.service_id,
      unit_count: out.unit_count, unit_type: sdef.unit_type,
      rate_cents: Math.round(out.rate_cents * 100), effective_date: out.effective_date,
      amendment_no: 1, authorized_by: out.approved_by
    });
    toast('Authorization ' + a.authorization_no + ' active');
    onDone();
  });
}

/* ------------------------------------------------ authorizations */
Views.authorizations = function (root) {
  const S = Store;
  root.append(pageHead('Service authorizations',
    'Authorize units → deliver units → bill units. Tables: service_authorization, authorized_unit_batch'));
  const rows = S.all('service_authorization');
  root.append(dataTable(rows, [
    { k: 'authorization_no', label: 'Auth #' },
    { k: 'client_id', label: 'Client', render: r => S.clientName(r.client_id), searchVal: r => S.clientName(r.client_id) },
    { k: 'program_id', label: 'Program', render: r => S.programName(r.program_id) },
    {
      k: '_svc', label: 'Service', render: r => {
        const b = S.all('authorized_unit_batch').find(x => x.authorization_id === r.authorization_id);
        return b ? S.serviceName(b.service_id) : '—';
      }
    },
    { k: 'end_date', label: 'Period', render: r => fmtDate(r.effective_date) + ' → ' + fmtDate(r.end_date), sortVal: r => r.end_date },
    {
      k: '_util', label: 'Utilization', render: r => {
        const u = S.authUtilization(r.authorization_id);
        return h('div', { class: 'util-cell' }, h('span', { class: 'muted' }, `${u.consumed}/${u.authorized}`), progressBar(u.pct));
      }, sortVal: r => S.authUtilization(r.authorization_id).pct
    },
    { k: 'status', label: 'Status', render: r => statusBadge(r.status) },
    {
      k: '_amend', label: '', render: r => h('button', {
        class: 'btn small', onclick: e => {
          e.stopPropagation();
          const b = S.all('authorized_unit_batch').filter(x => x.authorization_id === r.authorization_id);
          formModal('Amend — add unit batch', [
            { k: '_s', type: 'section', label: `Current batches: ${b.map(x => x.unit_count).join(' + ')} ${b[0]?.unit_type || ''}s` },
            { k: 'unit_count', label: 'Additional units', type: 'number', step: '0.25', required: true },
            { k: 'authorized_by', label: 'Authorized by', type: 'select', required: true, options: selectOptions('staff', 'staff_id', s => s.display_name) }
          ], out => {
            S.insert('authorized_unit_batch', {
              authorization_id: r.authorization_id, service_id: b[0].service_id,
              unit_count: out.unit_count, unit_type: b[0].unit_type, rate_cents: b[0].rate_cents,
              effective_date: todayISO(), amendment_no: b.length + 1, authorized_by: out.authorized_by
            });
            S.update('service_authorization', r.authorization_id, { status: 'amended' });
            toast('Batch added — authorization amended'); route();
          });
        }
      }, 'Amend')
    }
  ], { sortKey: '_util', sortDir: -1 }));
};

/* ------------------------------------------------ deliveries */
Views.deliveries = function (root) {
  const S = Store;
  const logBtn = h('button', {
    class: 'btn primary', onclick: () => {
      const activeAuths = S.all('service_authorization').filter(a => ['active', 'amended', 'approved'].includes(a.status));
      formModal('Log service delivery', [
        {
          k: 'authorization_id', label: 'Authorization', type: 'select', required: true,
          options: activeAuths.map(a => {
            const b = S.all('authorized_unit_batch').find(x => x.authorization_id === a.authorization_id);
            const u = S.authUtilization(a.authorization_id);
            return [a.authorization_id, `${S.clientName(a.client_id)} · ${b ? S.serviceName(b.service_id) : ''} (${u.consumed}/${u.authorized} used)`];
          })
        },
        { k: 'worker_id', label: 'Worker', type: 'select', options: selectOptions('worker', 'worker_id', w => `${w.legal_first_name} ${w.legal_last_name} — ${S.providerName(w.provider_id)}`) },
        { k: 'scheduled_date', label: 'Date', type: 'date', required: true, value: todayISO() },
        { k: 'unit_count', label: 'Units', type: 'number', step: '0.25', required: true, hint: 'Deliveries that would exceed the authorized units are rejected — same as the DB trigger.' },
        { k: 'status', label: 'Status', type: 'select', required: true, options: ENUMS.delivery_status, value: 'delivered' },
        { k: 'evv', label: 'EVV verified (Electronic Visit Verification)', type: 'checkbox', value: true },
        { k: 'notes', label: 'Notes', type: 'textarea', full: true }
      ], out => {
        const a = S.get('service_authorization', out.authorization_id);
        const b = S.all('authorized_unit_batch').find(x => x.authorization_id === a.authorization_id);
        const w = out.worker_id ? S.get('worker', out.worker_id) : null;
        S.insert('service_delivery', {
          authorization_id: a.authorization_id, batch_id: b.batch_id, client_id: a.client_id,
          worker_id: out.worker_id, provider_id: w ? w.provider_id : S.all('provider')[0].provider_id,
          service_id: b.service_id, scheduled_date: out.scheduled_date,
          delivered_date: out.status === 'delivered' ? out.scheduled_date : null,
          unit_count: out.unit_count, unit_type: b.unit_type, status: out.status,
          notes: out.notes,
          evv_reference: out.evv && out.status === 'delivered' ? 'EVV-' + Math.floor(Math.random() * 90000 + 10000) : null,
          evv_verified_at: out.evv && out.status === 'delivered' ? new Date().toISOString() : null
        });
        toast('Delivery logged'); route();
      });
    }
  }, '+ Log delivery');

  root.append(pageHead('Service deliveries',
    'Units actually delivered against authorizations — table: service_delivery', logBtn));

  const rows = S.all('service_delivery').slice().sort((a, b) => (b.scheduled_date || '').localeCompare(a.scheduled_date || ''));
  root.append(dataTable(rows, [
    { k: 'scheduled_date', label: 'Date', render: r => fmtDate(r.scheduled_date) },
    { k: 'client_id', label: 'Client', render: r => S.clientName(r.client_id), searchVal: r => S.clientName(r.client_id) },
    { k: 'service_id', label: 'Service', render: r => S.serviceName(r.service_id), searchVal: r => S.serviceName(r.service_id) },
    { k: 'worker_id', label: 'Worker', render: r => r.worker_id ? S.workerName(r.worker_id) : '—', searchVal: r => S.workerName(r.worker_id) },
    { k: 'unit_count', label: 'Units', render: r => `${r.unit_count} ${r.unit_type}(s)` },
    { k: 'evv_reference', label: 'EVV', render: r => r.evv_reference ? badge('verified', 'ok') : h('span', { class: 'muted' }, '—') },
    { k: 'status', label: 'Status', render: r => statusBadge(r.status) },
    {
      k: '_act', label: '', render: r => r.status === 'scheduled' ? h('button', {
        class: 'btn small primary', onclick: e => {
          e.stopPropagation();
          try {
            S.update('service_delivery', r.delivery_id, { status: 'delivered', delivered_date: todayISO(), evv_reference: 'EVV-' + Math.floor(Math.random() * 90000 + 10000), evv_verified_at: new Date().toISOString() });
            toast('Marked delivered'); route();
          } catch (err) { toast(err.message, 'err'); }
        }
      }, 'Mark delivered') : null
    }
  ], { sortKey: 'scheduled_date', sortDir: -1 }));
};
