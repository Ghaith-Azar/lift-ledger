import { api } from '../api.js';
import { h, icon, fmtNum, fmtVolume, fmtWeek, pluralize } from '../util.js';
import { state, setUnit, plateColor } from '../state.js';
import { drawChart, colors } from '../charts.js';
import { groupChip, sparkline, trendBadge } from './shared.js';

function deltaBadge(pct) {
  if (pct === null || pct === undefined) return null;
  const cls = pct > 0.5 ? 'up' : pct < -0.5 ? 'down' : 'flat';
  const sign = pct > 0 ? '+' : '';
  return h('span', { class: `badge ${cls}` }, `${sign}${pct}%`);
}

function statCard(label, value, unit, delta) {
  return h(
    'div',
    { class: 'stat' },
    h('div', { class: 'value' }, value, unit ? h('small', {}, ` ${unit}`) : null),
    h('div', { class: 'label' }, label),
    delta !== undefined ? h('div', { class: 'delta' }, delta) : null
  );
}

// ---------- Overview ----------

export async function progressView(container) {
  const data = await api.get('/api/progress/overview');
  const root = h('div');
  container.append(root);

  if (!data.has_data) {
    root.append(
      h('div', { class: 'page-head' }, h('h1', {}, 'Progress')),
      h(
        'div',
        { class: 'empty' },
        h('h2', {}, 'Nothing to show yet'),
        h('p', {}, 'Log a few workouts and your trends will show up here — weight, reps, volume, week by week.'),
        h('a', { class: 'btn primary', href: '#/' }, 'Start a workout')
      )
    );
    return;
  }

  const pctChange = (a, b) => (a > 0 ? Math.round(((b - a) / a) * 1000) / 10 : null);
  const wDelta = pctChange(data.last_week.workouts, data.this_week.workouts);
  const sDelta = pctChange(data.last_week.sets, data.this_week.sets);
  const vDelta = pctChange(data.last_week.volume, data.this_week.volume);

  root.append(
    h(
      'div',
      { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Progress'), h('p', {}, `${pluralize(data.total_workouts, 'workout')} logged in total`)),
      h(
        'div',
        { class: 'segmented' },
        ['kg', 'lb'].map((u) =>
          h(
            'button',
            {
              'aria-pressed': String(state.unit === u),
              onClick: () => {
                setUnit(u);
                location.reload();
              },
            },
            u
          )
        )
      )
    ),
    h(
      'div',
      { class: 'stats' },
      statCard('Workouts this week', data.this_week.workouts, null, deltaBadge(wDelta)),
      statCard('Sets this week', data.this_week.sets, null, deltaBadge(sDelta)),
      statCard('Volume this week', fmtVolume(data.this_week.volume), state.unit, deltaBadge(vDelta)),
      statCard('Total workouts', data.total_workouts, null)
    )
  );

  const weekLabels = data.weeks.map(fmtWeek);

  const freqCard = h(
    'div',
    { class: 'chart-card' },
    h('h3', {}, 'Workouts per week'),
    h('p', {}, 'How many sessions you logged, week by week.'),
    h('div', { class: 'chart-box' })
  );
  root.append(freqCard);
  drawChart(freqCard.querySelector('.chart-box'), {
    type: 'bar',
    data: {
      labels: weekLabels,
      datasets: [{ data: data.workouts_per_week, backgroundColor: colors().a, borderRadius: 5, maxBarThickness: 26 }],
    },
    options: { scales: { y: { ticks: { precision: 0 } } } },
  });

  const groups = data.muscle_groups.slice(0, 6);
  if (groups.length) {
    const palette = [colors().a, colors().b, colors().c, colors().d, '#a284ea', '#2ec4be'];
    const setsCard = h(
      'div',
      { class: 'chart-card' },
      h('h3', {}, 'Sets per muscle group'),
      h('p', {}, 'Working sets logged each week, by muscle group.'),
      h('div', { class: 'chart-box' }),
      h(
        'div',
        { class: 'legend' },
        groups.map((g, i) =>
          h('span', { class: 'row' }, h('span', { class: 'dot', style: { background: palette[i % palette.length] } }), g.name)
        )
      )
    );
    root.append(setsCard);
    drawChart(setsCard.querySelector('.chart-box'), {
      type: 'bar',
      data: {
        labels: weekLabels,
        datasets: groups.map((g, i) => ({
          label: g.name,
          data: g.sets,
          backgroundColor: palette[i % palette.length],
          stack: 'sets',
        })),
      },
      options: { scales: { x: { stacked: true }, y: { stacked: true, ticks: { precision: 0 } } } },
    });
  }

  root.append(h('h2', { class: 'section-title' }, 'Your lifts'));
  if (!data.lifts.length) {
    root.append(h('p', { class: 'muted' }, 'Log some sets and each exercise will get its own trend line.'));
  }
  for (const lift of data.lifts) {
    const value =
      lift.latest === null
        ? '–'
        : lift.primary_metric === 'e1rm'
        ? `${fmtNum(lift.latest)} ${state.unit}`
        : `${fmtNum(lift.latest, 0)} reps`;
    root.append(
      h(
        'a',
        { class: 'lift-row', href: `#/progress/exercise/${lift.id}`, style: { '--plate': plateColor(lift.muscle_group_id) } },
        h(
          'div',
          { class: 'grow' },
          h('h3', {}, lift.name),
          h(
            'div',
            { class: 'row wrap', style: { marginTop: '4px', gap: '6px' } },
            groupChip(lift.muscle_group_id),
            trendBadge({ status: lift.status, slope_pct: lift.slope_pct })
          )
        ),
        h('div', { style: { textAlign: 'right' } }, h('div', { style: { fontWeight: 700 } }, value)),
        sparkline(lift.spark, { color: colors().a })
      )
    );
  }
}

// ---------- Exercise detail ----------

const METRICS = {
  e1rm: [
    { key: 'top_weight', label: 'Top set' },
    { key: 'best_e1rm', label: 'Est. 1RM' },
    { key: 'avg_reps', label: 'Avg reps' },
    { key: 'volume', label: 'Volume' },
  ],
  reps: [
    { key: 'best_reps', label: 'Best reps' },
    { key: 'volume', label: 'Volume' },
    { key: 'working_sets', label: 'Sets' },
  ],
};

const METRIC_UNIT = {
  top_weight: () => state.unit,
  best_e1rm: () => state.unit,
  avg_reps: () => 'reps',
  best_reps: () => 'reps',
  volume: () => `${state.unit}·reps`,
  working_sets: () => 'sets',
};
const METRIC_DIGITS = { top_weight: 1, best_e1rm: 1, avg_reps: 1, best_reps: 0, volume: 0, working_sets: 0 };

function fmtMetric(v, key) {
  if (v === null || v === undefined) return '–';
  return `${fmtNum(v, METRIC_DIGITS[key])} ${METRIC_UNIT[key]()}`;
}

export async function exerciseProgressView(container, [idParam]) {
  const id = Number(idParam);
  const data = await api.get(`/api/progress/exercises/${id}`);
  const root = h('div');
  container.append(root);

  if (!data.has_data) {
    root.append(
      h('a', { class: 'icon-btn', href: '#/progress', 'aria-label': 'Back to progress' }, icon('back', 24)),
      h(
        'div',
        { class: 'empty' },
        h('h2', {}, 'No data yet'),
        h('p', {}, 'Log a few sets of this exercise and its trend will show up here.')
      )
    );
    return;
  }

  const { exercise, summary, records, sessions } = data;
  const metrics = METRICS[data.primary_metric];
  const headline = metrics[0].key;
  let metric = headline;

  root.append(
    h('a', { class: 'icon-btn', href: '#/progress', 'aria-label': 'Back to progress' }, icon('back', 24)),
    h(
      'div',
      { class: 'page-head' },
      h('div', {}, h('h1', {}, exercise.name), h('div', { style: { marginTop: '6px' } }, groupChip(exercise.muscle_group_id)))
    ),
    h(
      'div',
      { class: 'stats' },
      statCard('First logged', fmtMetric(summary.first[headline] ?? summary.first.best_reps, headline), null),
      statCard(
        'Latest',
        fmtMetric(summary.latest[headline] ?? summary.latest.best_reps, headline),
        null,
        deltaBadge(summary.change[headline] ?? summary.change.best_reps)
      )
    ),
    h('div', { style: { margin: '12px 0' } }, trendBadge(summary.trend))
  );

  const chartCard = h(
    'div',
    { class: 'chart-card' },
    h(
      'div',
      { class: 'row between' },
      h('h3', {}, 'Trend'),
      h(
        'div',
        { class: 'segmented' },
        metrics.map((m) =>
          h('button', { 'aria-pressed': String(m.key === metric), onClick: () => selectMetric(m.key) }, m.label)
        )
      )
    ),
    h('p', {}, data.weeks.length > 1 ? `Week by week since ${fmtWeek(data.weeks[0])}` : 'Only one week logged so far'),
    h('div', { class: 'chart-box' })
  );
  root.append(chartCard);

  function selectMetric(key) {
    metric = key;
    const wanted = metrics.find((m) => m.key === key).label;
    chartCard.querySelectorAll('.segmented button').forEach((b) => b.setAttribute('aria-pressed', String(b.textContent === wanted)));
    paintChart();
  }

  function paintChart() {
    const values = data.series[metric];
    drawChart(chartCard.querySelector('.chart-box'), {
      type: 'line',
      data: {
        labels: data.weeks.map(fmtWeek),
        datasets: [
          {
            data: values,
            borderColor: colors().a,
            backgroundColor: colors().a,
            pointRadius: values.map((v) => (v === null ? 0 : 3)),
            pointHoverRadius: 5,
            tension: 0.3,
            spanGaps: true,
            fill: false,
          },
        ],
      },
    });
  }
  paintChart();

  root.append(
    h('h2', { class: 'section-title' }, 'Records'),
    h(
      'div',
      { class: 'stats' },
      statCard('Heaviest set', records.heaviest ? `${fmtNum(records.heaviest.weight)}×${records.heaviest.reps}` : '–', null),
      records.best_e1rm
        ? statCard('Best est. 1RM', fmtNum(records.best_e1rm.value), state.unit)
        : statCard('Best set', '–', null)
    )
  );

  root.append(
    h('h2', { class: 'section-title' }, 'Recent sessions'),
    h(
      'div',
      { class: 'card' },
      sessions.map((s) =>
        h(
          'div',
          { class: 'session' },
          h(
            'a',
            { href: `#/workout/${s.workout_id}` },
            h(
              'div',
              { class: 'row between' },
              h('span', { style: { fontWeight: 700 } }, fmtWeek(s.date)),
              h('span', { class: 'muted small' }, `${fmtVolume(s.volume)} ${state.unit}`)
            )
          ),
          h(
            'div',
            { class: 'session-sets' },
            s.sets.map((set) => h('span', { class: `set-pill${set.drop_index ? ' drop' : ''}` }, `${fmtNum(set.weight)}×${set.reps}`))
          )
        )
      )
    )
  );
}
