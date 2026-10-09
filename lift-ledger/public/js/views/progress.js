import { api } from '../api.js';
import {
  h,
  clear,
  appendAll,
  icon,
  toast,
  safe,
  openSheet,
  menuSheet,
  todayStr,
  fmtDate,
  fmtNum,
  fmtVolume,
  fmtWeek,
  fmtDuration,
  pluralize,
} from '../util.js';
import { state, setUnit, plateColor } from '../state.js';
import { drawChart, destroyCharts, colors } from '../charts.js';
import { groupChip, sparkline, trendBadge, bodyweightForm, signedWeight } from './shared.js';
import { pushSupported, currentSubscription, subscribeToPush, unsubscribeFromPush } from '../push.js';

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

// ---------- Muscle balance ----------

/**
 * Compare each muscle group's sets over the last few weeks with the most-trained group.
 * Uses sets rather than volume, because heavy compound lifts would otherwise dominate.
 * Returns null when there isn't enough training history to say anything useful.
 */
function computeBalance(overview) {
  if (!overview.has_data) return null;
  const weeks = Math.min(4, overview.weeks.length);
  if (weeks < 2 || overview.muscle_groups.length < 2) return null;

  const from = overview.weeks.length - weeks;
  const totals = overview.muscle_groups.map((g) => ({
    id: g.id,
    name: g.name,
    sets: g.sets.slice(from).reduce((a, b) => a + b, 0),
  }));
  const leader = totals.reduce((a, b) => (b.sets > a.sets ? b : a), totals[0]);
  if (leader.sets < 3) return null;

  const flags = [];
  for (const t of totals) {
    if (t.id === leader.id) continue;
    if (t.sets === 0) {
      flags.push({ id: t.id, name: t.name, sets: 0, pct: 100, text: `no sets in the last ${weeks} weeks` });
      continue;
    }
    const pct = Math.round((1 - t.sets / leader.sets) * 100);
    if (pct >= 30) {
      flags.push({
        id: t.id,
        name: t.name,
        sets: t.sets,
        pct,
        text: `${pct}% fewer sets than ${leader.name} (${t.sets} vs ${leader.sets})`,
      });
    }
  }
  flags.sort((a, b) => b.pct - a.pct);
  return { weeks, leader, flags };
}

/**
 * Enough stalled lifts to suggest backing off: at least 3, or at least half
 * of everything with enough history to have a verdict (building/inactive
 * lifts don't count either way — there is not enough signal yet).
 */
function computeDeload(overview) {
  if (!overview.has_data) return null;
  const tracked = overview.lifts.filter((l) => ['progressing', 'plateau', 'regressing'].includes(l.status));
  if (tracked.length < 2) return null;
  const stalled = tracked.filter((l) => l.status === 'plateau' || l.status === 'regressing');
  if (stalled.length < 3 && stalled.length / tracked.length < 0.5) return null;
  return { stalled, total: tracked.length };
}

function deloadCard(overview) {
  const result = computeDeload(overview);
  if (!result) return null;
  const names = result.stalled.map((l) => l.name);
  const shown = names.slice(0, 4).join(', ') + (names.length > 4 ? `, +${names.length - 4} more` : '');
  return h(
    'div',
    { class: 'card', style: { borderLeft: '4px solid var(--flat)' } },
    h('p', { style: { fontWeight: 700 } }, `${pluralize(result.stalled.length, 'lift')} plateaued or regressing`),
    h('p', { class: 'muted small', style: { margin: '4px 0 8px' } }, `${shown} — out of ${result.total} lifts with enough history to judge.`),
    h('p', { class: 'small' }, 'Might be worth a lighter week before pushing again: same exercises, less weight or fewer sets, then back to normal.')
  );
}

function balanceCard(overview) {
  const result = computeBalance(overview);
  if (!result) return null;
  return h(
    'div',
    { class: 'chart-card' },
    h('h3', {}, 'Muscle balance'),
    h('p', {}, `Sets over the last ${result.weeks} weeks, compared with ${result.leader.name}, your most-trained group.`),
    result.flags.length
      ? h(
          'div',
          { class: 'stack', style: { marginTop: '10px' } },
          result.flags.map((f) =>
            h(
              'div',
              { class: 'row', style: { alignItems: 'flex-start' } },
              h('span', { class: 'dot', style: { '--plate': plateColor(f.id), marginTop: '5px' } }),
              h('span', {}, h('strong', {}, f.name), h('span', { class: 'muted' }, `: ${f.text}`))
            )
          ),
          h('p', { class: 'muted small' }, 'Worth a look if that is not on purpose.')
        )
      : h('p', { style: { marginTop: '8px' } }, 'Your sets look evenly spread across muscle groups.')
  );
}

// ---------- Bodyweight ----------

/** Resolves with { date, weight, notes }, or null if dismissed. */
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const pad2 = (n) => String(n).padStart(2, '0');

function openReminderSheet() {
  const body = h('div');

  async function paint() {
    body.replaceChildren(h('p', { class: 'muted' }, 'Loading…'));

    if (!pushSupported()) {
      body.replaceChildren(h('p', {}, "This browser doesn't support push notifications. The in-app reminder on Train still works."));
      return;
    }

    const [settings, sub] = await Promise.all([api.get('/api/push/settings'), currentSubscription()]);

    if (!settings.configured) {
      body.replaceChildren(
        h('p', {}, "Push isn't set up on this server yet — it needs a one-time key pair (see the README's “Weekly reminders” section)."),
        h('p', { class: 'muted small' }, "Once that's done this device can turn reminders on.")
      );
      return;
    }

    if (!sub) {
      body.replaceChildren(
        h('p', {}, "Get a notification on this device once a week if you haven't logged your weight yet."),
        h(
          'button',
          {
            class: 'btn primary block',
            onClick: safe(async () => {
              await subscribeToPush();
              toast('Reminders turned on for this device');
              await paint();
            }),
          },
          'Turn on for this device'
        )
      );
      return;
    }

    const dayChips = h(
      'div',
      { class: 'chips' },
      DAY_NAMES.map((name, i) =>
        h(
          'button',
          {
            class: 'chip',
            'aria-pressed': String(settings.day === i),
            onClick: safe(async () => {
              await api.patch('/api/push/settings', { day: i });
              await paint();
            }),
          },
          name.slice(0, 3)
        )
      )
    );
    const hourInput = h('input', {
      type: 'number',
      min: 0,
      max: 23,
      value: settings.hour,
      style: { maxWidth: '90px' },
      'aria-label': 'Reminder hour, UTC',
    });
    hourInput.addEventListener(
      'change',
      safe(async () => {
        const hr = Number(hourInput.value);
        if (!Number.isInteger(hr) || hr < 0 || hr > 23) return toast('Hour must be 0-23', { error: true });
        await api.patch('/api/push/settings', { hour: hr });
        toast('Saved');
      })
    );

    body.replaceChildren(
      h(
        'p',
        { class: 'row' },
        h('span', { class: 'badge up' }, 'On for this device'),
        h('span', { class: 'muted small' }, ` · ${pluralize(settings.subscription_count, 'device')} subscribed`)
      ),
      h('label', { class: 'field-label', style: { marginTop: '10px' } }, 'Remind on'),
      dayChips,
      h(
        'div',
        { class: 'row', style: { marginTop: '10px', alignItems: 'center', gap: '10px' } },
        h('label', { class: 'field-label' }, 'At (UTC hour)'),
        hourInput
      ),
      h(
        'p',
        { class: 'muted small', style: { margin: '8px 0 14px' } },
        `Skipped automatically if you've already logged a weigh-in that week. Next check: ${DAY_NAMES[settings.day]}, ${pad2(settings.hour)}:00 UTC.`
      ),
      h(
        'button',
        {
          class: 'btn block',
          onClick: safe(async () => {
            const res = await api.post('/api/push/test', {});
            toast(res.sent ? 'Test notification sent' : 'Could not send — check the server logs');
          }),
        },
        'Send a test notification'
      ),
      h(
        'button',
        {
          class: 'btn danger block',
          style: { marginTop: '8px' },
          onClick: safe(async () => {
            await unsubscribeFromPush();
            toast('Reminders turned off for this device');
            await paint();
          }),
        },
        'Turn off for this device'
      )
    );
  }

  openSheet({ title: 'Weekly reminder', body: () => body });
  paint();
}

function bodyweightCard(bw, { onLog, onEntry }) {
  const head = h(
    'div',
    { class: 'row between' },
    h('h3', {}, 'Bodyweight'),
    h(
      'div',
      { class: 'row', style: { gap: '6px' } },
      h('button', { class: 'btn small', onClick: openReminderSheet, 'aria-label': 'Weekly reminder settings' }, '🔔'),
      h('button', { class: 'btn small', onClick: onLog }, icon('plus', 16), 'Log')
    )
  );

  if (!bw.has_data) {
    return h(
      'div',
      { class: 'chart-card' },
      head,
      h('p', { style: { margin: '8px 0 4px' } }, 'Log your weight now and then to see the trend next to your lifts.')
    );
  }

  return h(
    'div',
    { class: 'chart-card' },
    head,
    h(
      'div',
      { class: 'row wrap', style: { gap: '4px 16px', margin: '6px 0 8px', alignItems: 'flex-end' } },
      h(
        'div',
        {},
        h(
          'div',
          { style: { fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '36px', lineHeight: 1 } },
          fmtNum(bw.latest.weight, 1),
          h('small', { style: { fontSize: '17px', color: 'var(--muted)', marginLeft: '4px' } }, state.unit)
        ),
        h('div', { class: 'muted small' }, `Latest, ${fmtDate(bw.latest.date)}`)
      ),
      bw.recent_change !== null
        ? h('div', {}, h('span', { class: 'badge' }, signedWeight(bw.recent_change)), h('div', { class: 'muted small', style: { marginTop: '4px' } }, 'last 7 vs the 7 before'))
        : null,
      bw.entries.length > 1
        ? h('div', {}, h('span', { class: 'badge' }, signedWeight(bw.change_total)), h('div', { class: 'muted small', style: { marginTop: '4px' } }, `since ${fmtDate(bw.first.date, { weekday: false })}`))
        : null
    ),
    bw.entries.length > 1
      ? h('div', { class: 'chart-box' })
      : h('p', { style: { margin: '4px 0' } }, 'Log a second weigh-in to start drawing a trend.'),
    h('p', { class: 'muted small', style: { margin: '10px 0 6px' } }, 'Recent weigh-ins. Tap one to edit it.'),
    h(
      'div',
      { class: 'chips' },
      bw.entries
        .slice(-6)
        .reverse()
        .map((e) =>
          h(
            'button',
            { class: 'chip', onClick: () => onEntry(e) },
            `${fmtDate(e.date, { weekday: false })}: ${fmtNum(e.weight, 1)}`
          )
        )
    )
  );
}

function drawBodyweightChart(host, bw) {
  const c = colors();
  drawChart(host, {
    type: 'line',
    data: {
      labels: bw.entries.map((e) => fmtDate(e.date, { weekday: false })),
      datasets: [
        {
          label: 'Weigh-in',
          data: bw.entries.map((e) => e.weight),
          borderColor: 'transparent',
          backgroundColor: c.a,
          pointRadius: 3,
          pointHoverRadius: 5,
          showLine: false,
        },
        {
          label: '7-weigh-in average',
          data: bw.entries.map((e) => e.avg),
          borderColor: c.c,
          backgroundColor: c.c,
          borderWidth: 3,
          pointRadius: 0,
          tension: 0.3,
        },
      ],
    },
    // Weight never starts at zero, so let the axis fit the data.
    optionsExtra: { yScale: { beginAtZero: false } },
  });
}

// ---------- Workout duration ----------

function durationCard(duration) {
  if (!duration?.has_data) return null;

  const notes = [];
  if (duration.open_workouts) {
    notes.push(`${pluralize(duration.open_workouts, 'workout')} still missing an end time`);
  }
  if (duration.excluded_implausible) {
    notes.push(
      `${pluralize(duration.excluded_implausible, 'session')} left out of the average (over 4 hours — probably a forgotten "End workout" tap)`
    );
  }

  if (!duration.sessions_with_duration) {
    return h(
      'div',
      { class: 'chart-card' },
      h('h3', {}, 'Workout duration'),
      h('p', {}, 'Once a workout has both a start and an end time, your average session length will show up here.'),
      notes.length ? h('p', { class: 'muted small', style: { marginTop: '8px' } }, notes.join(' · ')) : null
    );
  }

  return h(
    'div',
    { class: 'chart-card' },
    h('h3', {}, 'Workout duration'),
    h('p', {}, 'How long your sessions run, week by week.'),
    h(
      'div',
      { class: 'row wrap', style: { gap: '4px 16px', margin: '6px 0 8px', alignItems: 'flex-end' } },
      h(
        'div',
        {},
        h(
          'div',
          { style: { fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '36px', lineHeight: 1 } },
          fmtDuration(duration.avg_minutes)
        ),
        h('div', { class: 'muted small' }, 'Average session')
      ),
      duration.trend_pct !== null
        ? h(
            'div',
            {},
            deltaBadge(duration.trend_pct),
            h('div', { class: 'muted small', style: { marginTop: '4px' } }, 'last 5 vs the 5 before')
          )
        : null,
      duration.longest
        ? h(
            'div',
            {},
            h('span', { class: 'badge' }, fmtDuration(duration.longest.minutes)),
            h('div', { class: 'muted small', style: { marginTop: '4px' } }, 'longest')
          )
        : null
    ),
    h('div', { class: 'chart-box' }),
    notes.length ? h('p', { class: 'muted small', style: { marginTop: '10px' } }, notes.join(' · ')) : null
  );
}

function drawDurationChart(host, duration) {
  const c = colors();
  drawChart(host, {
    type: 'line',
    data: {
      labels: duration.weeks.map(fmtWeek),
      datasets: [
        {
          label: 'Avg minutes',
          data: duration.series,
          borderColor: c.a,
          backgroundColor: c.a,
          borderWidth: 3,
          pointRadius: duration.series.map((v) => (v === null ? 0 : 3)),
          pointHoverRadius: 5,
          tension: 0.3,
          spanGaps: true,
        },
      ],
    },
  });
}

// ---------- Overview ----------

export async function progressView(container) {
  const root = h('div');
  container.append(root);
  let overview;
  let bw;
  let duration;

  const load = async () => {
    [overview, bw, duration] = await Promise.all([
      api.get('/api/progress/overview'),
      api.get('/api/progress/bodyweight'),
      api.get('/api/progress/duration'),
    ]);
  };
  const refresh = async () => {
    await load();
    render();
  };

  const logWeight = safe(async () => {
    const entry = await bodyweightForm();
    if (!entry) return;
    await api.post('/api/bodyweight', entry);
    toast('Weight logged');
    await refresh();
  });

  const editEntry = safe(async (e) => {
    const entry = await bodyweightForm(e);
    if (!entry) return;
    await api.patch(`/api/bodyweight/${e.id}`, entry);
    await refresh();
  });

  const setArchived = safe(async (e, archived) => {
    await api.patch(`/api/bodyweight/${e.id}`, { archived });
    await refresh();
    return true;
  });

  const entryMenu = (e) =>
    menuSheet(`${fmtNum(e.weight, 1)} ${state.unit}, ${fmtDate(e.date)}`, [
      { label: 'Edit', icon: 'edit', onSelect: () => editEntry(e) },
      {
        label: 'Remove weigh-in',
        hint: 'Hidden, not deleted. You can undo right after.',
        danger: true,
        icon: 'x',
        onSelect: async () => {
          if (await setArchived(e, true)) {
            toast('Weigh-in removed', { actionLabel: 'Undo', onAction: () => setArchived(e, false) });
          }
        },
      },
    ]);

  function render() {
    destroyCharts();
    clear(root);

    root.append(
      h(
        'div',
        { class: 'page-head' },
        h(
          'div',
          {},
          h('h1', {}, 'Progress'),
          overview.has_data ? h('p', {}, `${pluralize(overview.total_workouts, 'workout')} logged in total`) : null
        ),
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
                  render();
                },
              },
              u
            )
          )
        )
      )
    );

    if (overview.has_data) {
      const pctChange = (a, b) => (a > 0 ? Math.round(((b - a) / a) * 1000) / 10 : null);
      root.append(
        h(
          'div',
          { class: 'stats' },
          statCard('Workouts this week', overview.this_week.workouts, null, deltaBadge(pctChange(overview.last_week.workouts, overview.this_week.workouts))),
          statCard('Sets this week', overview.this_week.sets, null, deltaBadge(pctChange(overview.last_week.sets, overview.this_week.sets))),
          statCard('Volume this week', fmtVolume(overview.this_week.volume), state.unit, deltaBadge(pctChange(overview.last_week.volume, overview.this_week.volume))),
          statCard('Total workouts', overview.total_workouts, null)
        )
      );
    }

    // Bodyweight stands on its own: it works before any workout is logged.
    const bwCard = bodyweightCard(bw, { onLog: logWeight, onEntry: entryMenu });
    root.append(bwCard);
    const bwBox = bwCard.querySelector('.chart-box');
    if (bwBox) drawBodyweightChart(bwBox, bw);

    const durCard = durationCard(duration);
    if (durCard) {
      root.append(durCard);
      const durBox = durCard.querySelector('.chart-box');
      if (durBox) drawDurationChart(durBox, duration);
    }

    if (!overview.has_data) {
      root.append(
        h(
          'div',
          { class: 'empty' },
          h('h2', {}, 'No workouts yet'),
          h('p', {}, 'Log a few workouts and your weight, reps and volume trends will show up here, week by week.'),
          h('a', { class: 'btn primary', href: '#/' }, 'Start a workout')
        )
      );
      return;
    }

    const weekLabels = overview.weeks.map(fmtWeek);

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
        datasets: [{ data: overview.workouts_per_week, backgroundColor: colors().a, borderRadius: 5, maxBarThickness: 26 }],
      },
      options: { scales: { y: { ticks: { precision: 0 } } } },
    });

    const groups = overview.muscle_groups.slice(0, 6);
    if (groups.length) {
      // Same colour a muscle group has everywhere else in the app.
      const rootStyle = getComputedStyle(document.documentElement);
      const palette = groups.map((g) => rootStyle.getPropertyValue(`--p${Math.abs(g.id) % 8}`).trim());
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

    const balance = balanceCard(overview);
    if (balance) root.append(balance);

    const deload = deloadCard(overview);
    if (deload) root.append(deload);

    root.append(
      h(
        'div',
        { class: 'row between', style: { margin: '24px 0 10px' } },
        h('h2', { style: { fontSize: '24px', margin: 0 } }, 'Your lifts'),
        h('a', { href: '#/progress/records', class: 'small', style: { color: 'var(--accent-text)', fontWeight: 700 } }, '🏆 Records')
      )
    );
    if (!overview.lifts.length) {
      root.append(h('p', { class: 'muted' }, 'Log some sets and each exercise will get its own trend line.'));
    }
    for (const lift of overview.lifts) {
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

  await load();
  render();
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

function recordRow(r) {
  const lines = [];
  if (r.heaviest) lines.push(`Heaviest ${fmtNum(r.heaviest.weight)} × ${r.heaviest.reps}`);
  if (r.best_e1rm) lines.push(`Est. 1RM ${fmtNum(r.best_e1rm.value)} ${state.unit}`);
  if (!r.has_weight && r.best_reps) lines.push(`Best ${r.best_reps.reps} reps`);
  return h(
    'a',
    { class: 'lift-row', href: `#/progress/exercise/${r.exercise_id}`, style: { '--plate': plateColor(r.muscle_group_id) } },
    h(
      'div',
      { class: 'grow' },
      h('h3', {}, r.name),
      h('div', { class: 'row wrap', style: { marginTop: '4px', gap: '6px' } }, groupChip(r.muscle_group_id))
    ),
    h(
      'div',
      { style: { textAlign: 'right' } },
      lines.map((l) => h('div', { class: 'small', style: { fontWeight: 700 } }, l))
    )
  );
}

export async function recordsView(container) {
  const data = await api.get('/api/progress/records');
  const root = h('div');
  container.append(root);

  if (!data.has_data) {
    root.append(
      h('a', { class: 'icon-btn', href: '#/progress', 'aria-label': 'Back to progress' }, icon('back', 24)),
      h(
        'div',
        { class: 'empty' },
        h('h2', {}, 'No records yet'),
        h('p', {}, 'Log a few sets and your personal bests will show up here, one line per exercise.')
      )
    );
    return;
  }

  let filterGroup = null;
  const groups = [...new Map(data.records.map((r) => [r.muscle_group_id, r.muscle_group_name])).entries()];

  function render() {
    const list = filterGroup ? data.records.filter((r) => r.muscle_group_id === filterGroup) : data.records;
    appendAll(clear(root), [
      h('a', { class: 'icon-btn', href: '#/progress', 'aria-label': 'Back to progress' }, icon('back', 24)),
      h(
        'div',
        { class: 'page-head' },
        h('div', {}, h('h1', {}, '🏆 Personal Records'), h('p', {}, pluralize(data.records.length, 'exercise')))
      ),
      h(
        'div',
        { class: 'chips', style: { marginBottom: '14px' } },
        h('button', { class: 'chip', 'aria-pressed': String(filterGroup === null), onClick: () => { filterGroup = null; render(); } }, 'All'),
        groups.map(([gid, name]) =>
          h(
            'button',
            {
              class: 'chip',
              style: { '--plate': plateColor(gid) },
              'aria-pressed': String(filterGroup === gid),
              onClick: () => { filterGroup = gid; render(); },
            },
            h('span', { class: 'dot' }),
            name
          )
        )
      ),
      list.map(recordRow),
    ]);
  }
  render();
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
