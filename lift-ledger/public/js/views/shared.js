import { h, icon, openSheet, toast, safe, fmtDate, fmtNum, relDay, fmtVolume, pluralize, todayStr } from '../util.js';
import { state, groupById, plateColor } from '../state.js';
import { suggestionsFor } from '../exerciseLibrary.js';
import { api } from '../api.js';

export function groupChip(groupId) {
  const g = groupById(groupId);
  if (!g) return null;
  return h('span', { class: 'chip', style: { '--plate': plateColor(g.id) } }, h('span', { class: 'dot' }), g.name);
}

export const workoutTitle = (w) => w.title || w.split_day_name || 'Workout';

export function workoutCard(w, { extra } = {}) {
  return h(
    'div',
    {},
    h(
      'a',
      { class: 'workout-link', href: `#/workout/${w.id}` },
      h(
        'div',
        { class: 'row between' },
        h('h3', {}, workoutTitle(w)),
        h('span', { class: 'muted small' }, relDay(w.date))
      ),
      h(
        'div',
        { class: 'meta' },
        h('span', {}, pluralize(w.exercise_count, 'exercise')),
        h('span', {}, pluralize(w.set_count, 'set')),
        h('span', {}, `${fmtVolume(w.volume)} ${state.unit}`)
      ),
      w.muscle_group_ids?.length
        ? h('div', { class: 'chips', style: { marginTop: '8px' } }, w.muscle_group_ids.map(groupChip))
        : null
    ),
    extra
  );
}

export { fmtDate };

/** A tiny inline sparkline. Null values leave a gap. */
export function sparkline(values, { width = 72, height = 28, color = 'currentColor' } = {}) {
  const pts = values.map((v, i) => ({ i, v })).filter((p) => p.v !== null && p.v !== undefined);
  const svgns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('spark');
  if (pts.length < 2) return svg;

  const pad = 3;
  const min = Math.min(...pts.map((p) => p.v));
  const max = Math.max(...pts.map((p) => p.v));
  const span = max - min || 1;
  const xStep = (width - pad * 2) / (values.length - 1 || 1);
  const x = (i) => pad + i * xStep;
  const y = (v) => height - pad - ((v - min) / span) * (height - pad * 2);

  const path = document.createElementNS(svgns, 'path');
  path.setAttribute('d', pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.i)},${y(p.v)}`).join(' '));
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', color);
  path.setAttribute('stroke-width', '2');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);

  const last = pts[pts.length - 1];
  const dot = document.createElementNS(svgns, 'circle');
  dot.setAttribute('cx', x(last.i));
  dot.setAttribute('cy', y(last.v));
  dot.setAttribute('r', '2.6');
  dot.setAttribute('fill', color);
  svg.append(dot);
  return svg;
}

/**
 * Tappable chips of common exercises for a muscle group, skipping any name
 * already in `existingNames`. Returns null if there's nothing left to
 * suggest, so callers can drop it straight into a layout with `&&`.
 */
export function suggestionChips(groupName, existingNames, onPick) {
  const existingLower = new Set([...existingNames].map((n) => n.toLowerCase()));
  const names = suggestionsFor(groupName).filter((n) => !existingLower.has(n.toLowerCase()));
  if (!names.length) return null;
  return h(
    'div',
    { style: { margin: '10px 0' } },
    h('p', { class: 'field-label', style: { margin: '0 0 6px' } }, 'Common exercises'),
    h(
      'div',
      { class: 'chips' },
      names.map((name) => h('button', { class: 'chip', onClick: () => onPick(name) }, icon('plus', 14), name))
    )
  );
}

// ---------- Bodyweight ----------

/** Resolves with { date, weight, notes }, or null if dismissed. Shared so
 *  both the Progress page and the Train-page reminder banner can log a
 *  weigh-in without a detour through Progress. */
export function bodyweightForm(existing) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (value, close) => {
      if (done) return;
      done = true;
      close();
      resolve(value);
    };

    openSheet({
      title: existing ? 'Edit weigh-in' : 'Log weight',
      onClose: () => {
        if (!done) {
          done = true;
          resolve(null);
        }
      },
      body: (close) => {
        const date = h('input', { type: 'date', value: existing?.date || todayStr(), 'aria-label': 'Date' });
        const weight = h('input', {
          type: 'text',
          inputmode: 'decimal',
          autocomplete: 'off',
          placeholder: state.unit,
          value: existing ? fmtNum(existing.weight, 2) : '',
          'aria-label': `Weight in ${state.unit}`,
        });
        const note = h('input', {
          type: 'text',
          maxlength: 300,
          placeholder: 'e.g. morning, after training',
          value: existing?.notes || '',
          'aria-label': 'Note',
        });
        const submit = () => {
          const value = Number(weight.value.trim().replace(',', '.'));
          if (!date.value) return toast('Pick a date', { error: true });
          if (!weight.value.trim() || !Number.isFinite(value) || value <= 0 || value > 700) {
            return toast('Enter a valid weight', { error: true });
          }
          finish({ date: date.value, weight: value, notes: note.value.trim() || null }, close);
        };
        weight.addEventListener('keydown', (e) => e.key === 'Enter' && submit());
        return h(
          'div',
          { class: 'stack' },
          h('label', { class: 'field-label' }, 'Date'),
          date,
          h('label', { class: 'field-label' }, `Weight (${state.unit})`),
          weight,
          h('label', { class: 'field-label' }, 'Note (optional)'),
          note,
          h('button', { class: 'btn primary block', onClick: submit }, existing ? 'Save' : 'Log weight')
        );
      },
    });
  });
}

/** Weight going up or down is not good or bad by itself, so no green/red here. */
export const signedWeight = (n) => `${n > 0 ? '+' : ''}${fmtNum(n, 1)} ${state.unit}`;

/** Days since the last weigh-in, or null if none has ever been logged. */
export function daysSinceWeighIn(bw) {
  if (!bw?.has_data) return null;
  const today = new Date(`${todayStr()}T00:00:00`);
  const last = new Date(`${bw.latest.date}T00:00:00`);
  return Math.round((today - last) / 86400000);
}

// ---------- Progressive overload settings ----------

const STRATEGY_LABEL = { double: 'Double progression', linear: 'Linear' };

/**
 * Opens a sheet to configure the progressive-overload assistant. Shared by
 * the Progress page (gear icon) and the in-workout menu, so it's reachable
 * from wherever someone notices a suggestion. Every change here is the
 * person explicitly choosing how the assistant should behave — nothing
 * about weight or reps is ever changed on its own.
 */
export function progressionSettingsSheet() {
  const body = h('div');

  async function paint() {
    body.replaceChildren(h('p', { class: 'muted' }, 'Loading…'));
    const s = await api.get('/api/progression/settings');

    const enabledToggle = h(
      'div',
      { class: 'segmented' },
      [
        { v: true, label: 'On' },
        { v: false, label: 'Off' },
      ].map((opt) =>
        h(
          'button',
          {
            'aria-pressed': String(s.enabled === opt.v),
            onClick: safe(async () => {
              await api.patch('/api/progression/settings', { enabled: opt.v });
              await paint();
            }),
          },
          opt.label
        )
      )
    );

    if (!s.enabled) {
      body.replaceChildren(
        h('label', { class: 'field-label' }, 'Suggestions'),
        enabledToggle,
        h('p', { class: 'muted small', style: { marginTop: '8px' } }, "Turned off — your workouts won't show a suggested next target.")
      );
      return;
    }

    const strategyToggle = h(
      'div',
      { class: 'segmented' },
      ['double', 'linear'].map((v) =>
        h(
          'button',
          {
            'aria-pressed': String(s.strategy === v),
            onClick: safe(async () => {
              await api.patch('/api/progression/settings', { strategy: v });
              await paint();
            }),
          },
          STRATEGY_LABEL[v]
        )
      )
    );

    const numField = (label, key, value, { min = 0, max = 100, step = 1 } = {}) => {
      const input = h('input', { type: 'number', min, max, step, value, style: { maxWidth: '110px' } });
      input.addEventListener(
        'change',
        safe(async () => {
          const n = Number(input.value);
          if (!Number.isFinite(n)) return toast('Enter a number', { error: true });
          await api.patch('/api/progression/settings', { [key]: n });
          await paint();
        })
      );
      return h('div', { class: 'row between', style: { marginTop: '10px', gap: '10px' } }, h('label', { class: 'field-label' }, label), input);
    };

    body.replaceChildren(
      h('label', { class: 'field-label' }, 'Suggestions'),
      enabledToggle,
      h('label', { class: 'field-label', style: { marginTop: '14px' } }, 'Strategy'),
      strategyToggle,
      h(
        'p',
        { class: 'muted small', style: { margin: '6px 0 0' } },
        s.strategy === 'double'
          ? 'Climb reps to the top of your range first, then add weight and reset reps.'
          : 'Add weight as soon as every set reaches the top of your rep range.'
      ),
      numField('Rep range — low', 'rep_low', s.rep_low, { min: 1, max: 50 }),
      numField('Rep range — high', 'rep_high', s.rep_high, { min: 1, max: 50 }),
      numField('Weight increment', 'weight_increment', s.weight_increment, { min: 0.5, max: 50, step: 0.5 }),
      numField('Flag a decline after (sessions)', 'plateau_sessions', s.plateau_sessions, { min: 2, max: 10 }),
      h(
        'p',
        { class: 'muted small', style: { margin: '14px 0 0' } },
        'A suggestion is only ever an offer — use it, edit the numbers, or ignore it. Nothing is changed automatically.'
      )
    );
  }

  openSheet({ title: 'Progression settings', body: () => body });
  paint();
}

/** progressing / regressing / plateau / building / inactive → a small coloured badge. */
export function trendBadge(trend) {
  const map = {
    progressing: { cls: 'up', label: `Up ${Math.abs(trend.slope_pct)}%/wk` },
    regressing: { cls: 'down', label: `Down ${Math.abs(trend.slope_pct)}%/wk` },
    plateau: { cls: 'flat', label: 'Holding steady' },
    building: { cls: '', label: 'Still building trend' },
    inactive: { cls: '', label: 'Not trained recently' },
    none: { cls: '', label: 'No data yet' },
  };
  const m = map[trend.status] || map.none;
  return h('span', { class: `badge ${m.cls}`.trim() }, m.label);
}
