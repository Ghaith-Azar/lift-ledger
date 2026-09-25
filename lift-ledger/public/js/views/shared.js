import { h, fmtDate, relDay, fmtVolume, pluralize } from '../util.js';
import { state, groupById, plateColor } from '../state.js';

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
