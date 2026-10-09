// ---------- DOM ----------

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  let value;
  for (const [key, val] of Object.entries(props || {})) {
    if (val === undefined || val === null || val === false) continue;
    if (key === 'class') el.className = val;
    else if (key === 'style' && typeof val === 'object') {
      for (const [prop, v] of Object.entries(val)) {
        if (prop.startsWith('--')) el.style.setProperty(prop, v);
        else el.style[prop] = v;
      }
    }
    else if (key.startsWith('on') && typeof val === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), val);
    } else if (key === 'value') value = val;
    else if (key === 'checked' || key === 'disabled' || key === 'selected' || key === 'hidden') {
      el[key] = !!val;
    } else if (key === 'for') el.htmlFor = val;
    else el.setAttribute(key, val === true ? '' : val);
  }
  append(el, children);
  if (value !== undefined) el.value = value;
  return el;
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function clear(el) {
  el.replaceChildren();
  return el;
}

/** Append a mix of nodes, nested arrays, and nullish placeholders (from `cond && h(...)`). */
export function appendAll(el, items) {
  append(el, items);
  return el;
}

const ICONS = {
  dots: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  down: '<path d="M12 5v13m0 0l-5-5m5 5l5-5"/>',
  train: '<path d="M6.5 7v10M3.5 9.5v5M17.5 7v10M20.5 9.5v5M6.5 12h11"/>',
  history: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  chart: '<path d="M4 4v16h16"/><path d="M8 15l4-5 3 3 4-6"/>',
  split: '<path d="M4 6h16M4 12h16M4 18h9"/>',
  chevron: '<path d="M9 5l7 7-7 7"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/>',
  restore: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3.5 4v5h5"/>',
  up: '<path d="M12 19V6m0 0l-5 5m5-5l5 5"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 13V9.5"/><path d="M9.5 2.5h5"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
};

export function icon(name, size = 20) {
  const span = document.createElement('span');
  span.className = 'icon';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
  return span;
}

// ---------- Formatting ----------

const pad = (n) => String(n).padStart(2, '0');

export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const parseLocal = (s) => new Date(`${s}T00:00:00`);

export function fmtDate(s, { weekday = true, year = false } = {}) {
  return parseLocal(s).toLocaleDateString(undefined, {
    weekday: weekday ? 'short' : undefined,
    month: 'short',
    day: 'numeric',
    year: year ? 'numeric' : undefined,
  });
}

export function relDay(s) {
  const today = parseLocal(todayStr());
  const days = Math.round((today - parseLocal(s)) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return fmtDate(s);
}

export function mondayOf(s) {
  const d = parseLocal(s);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const fmtWeek = (s) => parseLocal(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export function fmtNum(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return '';
  return String(Number(Number(n).toFixed(digits)));
}

export function fmtVolume(n) {
  if (!n) return '0';
  return n >= 10000 ? `${(n / 1000).toFixed(1)}k` : Math.round(n).toLocaleString();
}

export const pluralize = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function fmtSet(s) {
  return `${fmtNum(s.weight ?? 0)}×${s.reps}`;
}

/** A live ticking clock, e.g. "4:05" or "1:04:05" once past an hour. */
export function fmtClock(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  return hrs > 0 ? `${hrs}:${pad(mins)}:${pad(secs)}` : `${mins}:${pad(secs)}`;
}

/** A finished duration for analytics/summaries, e.g. "1h 15m" or "42m". */
export function fmtDuration(totalMinutes) {
  if (totalMinutes === null || totalMinutes === undefined || Number.isNaN(totalMinutes)) return '–';
  const mins = Math.round(totalMinutes);
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  if (hrs <= 0) return `${rem}m`;
  return rem ? `${hrs}h ${rem}m` : `${hrs}h`;
}

// ---------- Toasts ----------

export function toast(message, { actionLabel, onAction, ms = 5000, error = false, variant = '' } = {}) {
  const host = document.getElementById('toasts');
  const el = h(
    'div',
    { class: `toast${error ? ' error' : ''}${variant ? ` ${variant}` : ''}`, role: error ? 'alert' : 'status' },
    h('span', {}, message),
    actionLabel &&
      h(
        'button',
        {
          class: 'toast-action',
          onClick: () => {
            el.remove();
            onAction?.();
          },
        },
        actionLabel
      )
  );
  host.append(el);
  setTimeout(() => el.remove(), error ? Math.max(ms, 6500) : ms);
}

/** A gold toast plus a short confetti burst, for personal records. */
export function celebratePR(message) {
  toast(message, { ms: 4500, variant: 'pr' });
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

  const host = h('div', { class: 'confetti-host', 'aria-hidden': 'true' });
  const palette = ['--p0', '--p1', '--p2', '--p3', '--p4', '--p5', '--p6'];
  for (let i = 0; i < 18; i++) {
    const piece = h('span', { class: 'confetti-piece' });
    piece.style.setProperty('--x', `${Math.round((Math.random() - 0.5) * 260)}px`);
    piece.style.setProperty('--y', `${120 + Math.round(Math.random() * 120)}px`);
    piece.style.setProperty('--rot', `${Math.round((Math.random() - 0.5) * 540)}deg`);
    piece.style.setProperty('--delay', `${Math.round(Math.random() * 120)}ms`);
    piece.style.background = `var(${palette[i % palette.length]})`;
    host.append(piece);
  }
  document.body.append(host);
  setTimeout(() => host.remove(), 1200);
}

export function safe(fn) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err.status !== 401) toast(err.message || 'Something went wrong', { error: true });
    }
  };
}

// ---------- Sheets (bottom panels) ----------

export function openSheet({ title, body, onClose }) {
  const previousFocus = document.activeElement;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    backdrop.remove();
    previousFocus?.focus?.();
    onClose?.();
  };
  const onKey = (e) => e.key === 'Escape' && close();

  const content = typeof body === 'function' ? body(close) : body;
  const panel = h(
    'div',
    { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h(
      'div',
      { class: 'sheet-head' },
      h('h2', {}, title),
      h('button', { class: 'icon-btn', 'aria-label': 'Close', onClick: close }, icon('x'))
    ),
    h('div', { class: 'sheet-body' }, content)
  );
  const backdrop = h('div', { class: 'sheet-backdrop', onClick: (e) => e.target === backdrop && close() }, panel);
  document.addEventListener('keydown', onKey);
  document.body.append(backdrop);
  panel.querySelector('input, textarea')?.focus();
  return { close, panel };
}

/** Ask for one line (or a paragraph) of text. Resolves to the text, or null if dismissed. */
export function promptSheet({ title, label, value = '', placeholder = '', submitLabel = 'Save', multiline = false }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (result, close) => {
      if (done) return;
      done = true;
      close();
      resolve(result);
    };
    openSheet({
      title,
      onClose: () => {
        if (!done) {
          done = true;
          resolve(null);
        }
      },
      body: (close) => {
        const input = multiline
          ? h('textarea', { rows: 4, placeholder, value, 'aria-label': label || title })
          : h('input', { type: 'text', placeholder, value, maxlength: 80, autocomplete: 'off', 'aria-label': label || title });
        const submit = () => finish(input.value, close);
        if (!multiline) input.addEventListener('keydown', (e) => e.key === 'Enter' && submit());
        return h(
          'div',
          { class: 'stack' },
          label && h('label', { class: 'field-label' }, label),
          input,
          h('button', { class: 'btn primary block', onClick: submit }, submitLabel)
        );
      },
    });
  });
}

/**
 * For destructive, irreversible actions: the person must type an exact
 * phrase before the confirm button even becomes clickable. Resolves true
 * if confirmed, false if cancelled or dismissed.
 */
export function confirmTypingSheet({ title, warning, confirmWord = 'DELETE', confirmLabel = 'Delete' }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (result, close) => {
      if (done) return;
      done = true;
      close();
      resolve(result);
    };
    openSheet({
      title,
      onClose: () => {
        if (!done) {
          done = true;
          resolve(false);
        }
      },
      body: (close) => {
        const input = h('input', {
          type: 'text',
          autocomplete: 'off',
          spellcheck: 'false',
          placeholder: confirmWord,
          'aria-label': `Type ${confirmWord} to confirm`,
        });
        const confirmBtn = h('button', { class: 'btn danger block', disabled: true }, confirmLabel);
        input.addEventListener('input', () => {
          confirmBtn.disabled = input.value !== confirmWord;
        });
        confirmBtn.addEventListener('click', () => finish(true, close));
        return h(
          'div',
          { class: 'stack' },
          h('p', {}, warning),
          h('label', { class: 'field-label' }, `Type ${confirmWord} to confirm`),
          input,
          confirmBtn,
          h('button', { class: 'btn ghost block', onClick: () => finish(false, close) }, 'Cancel')
        );
      },
    });
  });
}

/** A list of tappable actions, used for "…" menus. */
export function menuSheet(title, items) {
  return openSheet({
    title,
    body: (close) =>
      h(
        'div',
        { class: 'menu' },
        items
          .filter(Boolean)
          .map((item) =>
            h(
              'button',
              {
                class: `menu-item${item.danger ? ' danger' : ''}`,
                onClick: () => {
                  close();
                  item.onSelect();
                },
              },
              item.icon && icon(item.icon),
              h('span', {}, h('strong', {}, item.label), item.hint && h('small', {}, item.hint))
            )
          )
      ),
  });
}
