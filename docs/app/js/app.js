/* ============================================================
 * app.js — hash router + boot
 * ============================================================ */

const ROUTES = [
  ['dashboard', '⌂', 'Dashboard'],
  ['referrals', '☎', 'Referrals'],
  ['clients', '👤', 'Clients'],
  ['cases', '📋', 'Cases & care plans'],
  ['authorizations', '✔', 'Authorizations'],
  ['deliveries', '🚚', 'Deliveries'],
  ['providers', '🏢', 'Providers'],
  ['billing', '💵', 'Billing'],
  ['selfdirection', '🧭', 'Self-direction'],
  ['reports', '📊', 'Reports'],
  ['data', '🗄', 'Data']
];

function route() {
  const hash = (location.hash || '#dashboard').slice(1);
  const [name, params] = hash.split('/');
  const view = Views[name] || Views.dashboard;
  const main = document.getElementById('main');
  main.innerHTML = '';
  document.querySelectorAll('.nav a').forEach(a =>
    a.classList.toggle('active', a.dataset.route === name));
  try { view(main, params); }
  catch (err) {
    console.error(err);
    main.append(h('div', { class: 'card' }, h('p', {}, 'Something went wrong: ' + err.message)));
  }
  document.getElementById('sidebar').classList.remove('open');
}

function boot() {
  const nav = document.querySelector('.nav');
  ROUTES.forEach(([r, icon, text]) => nav.append(
    h('a', { href: '#' + r, 'data-route': r },
      h('span', { class: 'nav-icon' }, icon), text)));

  if (!Store.load() || !Store.all('organization').length) {
    seedDemoData();
  }
  window.addEventListener('hashchange', route);
  document.getElementById('menu-btn').addEventListener('click', () =>
    document.getElementById('sidebar').classList.toggle('open'));
  route();
}

document.addEventListener('DOMContentLoaded', boot);
