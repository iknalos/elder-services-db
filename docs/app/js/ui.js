/* ============================================================
 * ui.js — tiny component helpers (no framework)
 * ============================================================ */

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null) continue;
    el.append(c.nodeType ? c : document.createTextNode(c));
  }
  return el;
}

function toast(msg, kind = 'ok') {
  const t = h('div', { class: 'toast ' + kind }, msg);
  document.getElementById('toasts').append(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, kind === 'err' ? 6000 : 3200);
}

function badge(text, kind = '') {
  return h('span', { class: 'badge ' + kind }, label(text));
}

function statusBadge(status) {
  const map = {
    delivered: 'ok', paid: 'ok', active: 'ok', eligible: 'ok', approved: 'ok',
    scheduled: 'info', submitted: 'info', ready: 'info', draft: 'muted',
    missed: 'warn', partial: 'warn', pending: 'warn', amended: 'warn',
    denied: 'err', no_show: 'err', voided: 'err', expired: 'err', terminated: 'err',
    cancelled_client: 'muted', cancelled_provider: 'muted', cancelled_weather: 'muted'
  };
  return badge(status, map[status] || 'muted');
}

function progressBar(pct, warnAt = 85) {
  const kind = pct >= 100 ? 'err' : pct >= warnAt ? 'warn' : 'ok';
  return h('div', { class: 'prog', title: pct + '%' },
    h('div', { class: 'prog-fill ' + kind, style: `width:${Math.min(pct, 100)}%` }),
    h('span', { class: 'prog-label' }, pct + '%'));
}

/* sortable/searchable table. cols: [{k, label, render?, sort?}] */
function dataTable(rows, cols, opts = {}) {
  const wrap = h('div', { class: 'card table-card' });
  let sortKey = opts.sortKey || null, sortDir = opts.sortDir || 1, query = '';

  const head = h('div', { class: 'table-head' },
    opts.title ? h('h3', {}, opts.title) : null,
    h('div', { class: 'spacer' }),
    opts.searchable !== false ? h('input', {
      class: 'input search', type: 'search', placeholder: 'Search…',
      oninput: e => { query = e.target.value.toLowerCase(); paint(); }
    }) : null,
    ...(opts.actions || []));

  const tbl = h('table', { class: 'table' });
  const empty = h('div', { class: 'empty' }, opts.empty || 'Nothing here yet.');
  wrap.append(head, tbl, empty);

  function paint() {
    let data = [...rows];
    if (query) data = data.filter(r => cols.some(c => {
      const v = c.searchVal ? c.searchVal(r) : r[c.k];
      return v != null && String(v).toLowerCase().includes(query);
    }));
    if (sortKey) {
      const col = cols.find(c => c.k === sortKey);
      data.sort((a, b) => {
        const va = col.sortVal ? col.sortVal(a) : a[sortKey];
        const vb = col.sortVal ? col.sortVal(b) : b[sortKey];
        return (va > vb ? 1 : va < vb ? -1 : 0) * sortDir;
      });
    }
    tbl.innerHTML = '';
    tbl.append(h('thead', {}, h('tr', {}, cols.map(c =>
      h('th', {
        class: c.k === sortKey ? 'sorted' : '',
        onclick: () => { sortDir = c.k === sortKey ? -sortDir : 1; sortKey = c.k; paint(); }
      }, c.label, c.k === sortKey ? (sortDir > 0 ? ' ▲' : ' ▼') : '')))));
    tbl.append(h('tbody', {}, data.map(r => {
      const tr = h('tr', opts.onRow ? { class: 'clickable', onclick: () => opts.onRow(r) } : {},
        cols.map(c => h('td', {}, c.render ? c.render(r) : (r[c.k] ?? '—'))));
      return tr;
    })));
    empty.style.display = data.length ? 'none' : '';
    tbl.style.display = data.length ? '' : 'none';
  }
  paint();
  return wrap;
}

/* modal form. fields: [{k,label,type,options?,required?,value?,hint?}]
 * types: text, date, number, select, multicheck, checkbox, textarea */
function formModal(title, fields, onSubmit, opts = {}) {
  const overlay = h('div', { class: 'overlay', onclick: e => { if (e.target === overlay) close(); } });
  const form = h('form', { class: 'modal', onsubmit: e => { e.preventDefault(); submit(); } });

  form.append(h('div', { class: 'modal-head' },
    h('h3', {}, title),
    h('button', { type: 'button', class: 'btn icon', onclick: close }, '✕')));

  const body = h('div', { class: 'modal-body' });
  const inputs = {};
  for (const f of fields) {
    if (f.type === 'section') { body.append(h('div', { class: 'form-section' }, f.label)); continue; }
    const lab = h('label', { class: 'field' + (f.full ? ' full' : '') },
      h('span', { class: 'field-label' }, f.label, f.required ? h('em', {}, ' *') : null));
    let inp;
    if (f.type === 'select') {
      inp = h('select', { class: 'input' },
        f.required ? null : h('option', { value: '' }, '—'),
        (f.options || []).map(o => {
          const [val, text] = Array.isArray(o) ? o : [o, label(o)];
          return h('option', { value: val, selected: String(f.value) === String(val) ? '' : null }, text);
        }));
    } else if (f.type === 'textarea') {
      inp = h('textarea', { class: 'input', rows: 3 }, f.value || '');
    } else if (f.type === 'checkbox') {
      inp = h('input', { type: 'checkbox' });
      inp.checked = !!f.value;
      lab.classList.add('check');
    } else if (f.type === 'multicheck') {
      inp = h('div', { class: 'multicheck' }, (f.options || []).map(o =>
        h('label', {}, h('input', { type: 'checkbox', value: o, checked: (f.value || []).includes(o) ? '' : null }), ' ' + label(o))));
      inp.getValue = () => [...inp.querySelectorAll('input:checked')].map(i => i.value);
    } else {
      inp = h('input', { class: 'input', type: f.type || 'text', value: f.value ?? '', step: f.step || null, min: f.min ?? null });
    }
    if (f.required && inp.tagName !== 'DIV') inp.required = true;
    inputs[f.k] = { inp, f };
    lab.append(inp);
    if (f.hint) lab.append(h('span', { class: 'hint' }, f.hint));
    body.append(lab);
  }

  form.append(body, h('div', { class: 'modal-foot' },
    h('button', { type: 'button', class: 'btn', onclick: close }, 'Cancel'),
    h('button', { type: 'submit', class: 'btn primary' }, opts.submitLabel || 'Save')));
  overlay.append(form);
  document.body.append(overlay);
  const first = form.querySelector('.input'); if (first) first.focus();

  function close() { overlay.remove(); }
  function submit() {
    const out = {};
    for (const [k, { inp, f }] of Object.entries(inputs)) {
      if (f.type === 'checkbox') out[k] = inp.checked;
      else if (f.type === 'multicheck') out[k] = inp.getValue();
      else if (f.type === 'number') out[k] = inp.value === '' ? null : Number(inp.value);
      else out[k] = inp.value === '' ? null : inp.value;
    }
    try { onSubmit(out); close(); }
    catch (err) { toast(err.message, 'err'); }
  }
  return overlay;
}

function confirmBox(msg, onYes) {
  formModal('Confirm', [{ k: '_', type: 'section', label: msg }], onYes, { submitLabel: 'Yes, continue' });
}

function statCard(value, labelText, sub, kind = '') {
  return h('div', { class: 'card stat ' + kind },
    h('div', { class: 'stat-value' }, String(value)),
    h('div', { class: 'stat-label' }, labelText),
    sub ? h('div', { class: 'stat-sub' }, sub) : null);
}

function downloadCSV(filename, rows, cols) {
  const esc = v => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const lines = [cols.map(c => esc(c.label)).join(',')];
  rows.forEach(r => lines.push(cols.map(c => esc(c.csv ? c.csv(r) : r[c.k])).join(',')));
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const a = h('a', { href: URL.createObjectURL(blob), download: filename });
  a.click();
  URL.revokeObjectURL(a.href);
}

function pageHead(title, subtitle, ...actions) {
  return h('div', { class: 'page-head' },
    h('div', {}, h('h2', {}, title), subtitle ? h('p', { class: 'subtitle' }, subtitle) : null),
    h('div', { class: 'spacer' }), ...actions);
}

function selectOptions(table, pk, labelFn, filter) {
  return Store.all(table).filter(filter || (() => true)).map(r => [r[pk], labelFn(r)]);
}
