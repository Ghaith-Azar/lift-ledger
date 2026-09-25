import { api } from './api.js';
import { h, clear, icon, toast } from './util.js';
import { loadCatalog } from './state.js';
import { destroyCharts } from './charts.js';
import { homeView } from './views/home.js';
import { workoutView } from './views/workout.js';
import { historyView } from './views/history.js';
import { progressView, exerciseProgressView } from './views/progress.js';
import { splitView } from './views/split.js';

const app = document.getElementById('app');

const routes = [
  [/^#\/workout\/(\d+)$/, workoutView, 'train'],
  [/^#\/history$/, historyView, 'history'],
  [/^#\/progress\/exercise\/(\d+)$/, exerciseProgressView, 'progress'],
  [/^#\/progress$/, progressView, 'progress'],
  [/^#\/split$/, splitView, 'split'],
  [/^#?\/?$/, homeView, 'train'],
];

let viewHost = null;
let tabsEl = null;
let cleanup = null;
let routeToken = 0;
let running = false;

function buildShell() {
  const tab = (href, key, label, iconName) =>
    h('a', { class: 'tab', href, 'data-tab': key }, icon(iconName, 24), label);
  viewHost = h('main', { id: 'view' });
  tabsEl = h(
    'nav',
    { class: 'tabs', 'aria-label': 'Main' },
    h(
      'div',
      { class: 'tabs-inner' },
      tab('#/', 'train', 'Train', 'train'),
      tab('#/history', 'history', 'History', 'history'),
      tab('#/progress', 'progress', 'Progress', 'chart'),
      tab('#/split', 'split', 'Split', 'split')
    )
  );
  clear(app).append(viewHost, tabsEl);
}

async function route() {
  if (!running) return;
  cleanup?.();
  cleanup = null;
  destroyCharts();

  const hash = location.hash || '#/';
  const [re, view, tab] = routes.find(([pattern]) => pattern.test(hash)) || routes[routes.length - 1];
  const params = (hash.match(re) || []).slice(1);
  tabsEl.querySelectorAll('.tab').forEach((el) => {
    if (el.dataset.tab === tab) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
  });

  const token = ++routeToken;
  const container = h('div', {}, h('div', { class: 'loading' }, 'Loading…'));
  viewHost.replaceChildren(container);
  window.scrollTo(0, 0);
  try {
    const stub = h('div');
    const result = await view(stub, params);
    if (token !== routeToken) {
      result?.();
      return;
    }
    container.replaceWith(stub);
    cleanup = result;
  } catch (err) {
    if (token !== routeToken || err.status === 401) return;
    container.replaceChildren(
      h(
        'div',
        { class: 'empty' },
        h('h2', {}, 'Could not load this page'),
        h('p', {}, err.message || 'Something went wrong.'),
        h('button', { class: 'btn primary', onClick: route }, 'Try again')
      )
    );
  }
}

function showLogin(message = '') {
  running = false;
  cleanup?.();
  cleanup = null;
  destroyCharts();
  const input = h('input', {
    type: 'password',
    placeholder: 'Password',
    autocomplete: 'current-password',
    'aria-label': 'Password',
  });
  const error = h('p', { class: 'error-text', role: 'alert' }, message);
  const button = h('button', { class: 'btn primary block' }, 'Sign in');
  const submit = async () => {
    button.disabled = true;
    error.textContent = '';
    try {
      await api.post('/api/auth/login', { password: input.value });
      await boot();
    } catch (err) {
      error.textContent = err.message;
      button.disabled = false;
      input.select();
    }
  };
  button.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => e.key === 'Enter' && submit());

  clear(app).append(
    h(
      'div',
      { class: 'login' },
      h(
        'div',
        { class: 'plates', 'aria-hidden': 'true' },
        h('span', { style: { '--c': 'var(--p1)' } }),
        h('span', { style: { '--c': 'var(--p6)' } }),
        h('span', { style: { '--c': 'var(--p0)' } })
      ),
      h('h1', {}, 'Lift Ledger'),
      h('p', { class: 'muted' }, 'Every set, every week. Nothing is ever deleted.'),
      input,
      error,
      button
    )
  );
  input.focus();
}

async function boot() {
  const session = await api.get('/api/auth/session');
  if (session.authRequired && !session.authenticated) return showLogin();
  await loadCatalog();
  buildShell();
  running = true;
  await route();
}

window.addEventListener('hashchange', route);
window.addEventListener('auth:required', () => showLogin('Your session ended. Sign in again.'));

boot().catch((err) => {
  clear(app).append(
    h(
      'div',
      { class: 'login' },
      h('h1', {}, 'Cannot connect'),
      h('p', { class: 'muted' }, err.message),
      h('button', { class: 'btn primary block', onClick: () => location.reload() }, 'Try again')
    )
  );
  toast(err.message, { error: true });
});
