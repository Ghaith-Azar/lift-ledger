import { api } from '../api.js';
import { h, safe, todayStr, fmtDate, mondayOf } from '../util.js';
import { activeDays, plateColor } from '../state.js';
import { groupChip, workoutCard, workoutTitle } from './shared.js';

/** The day after the one you trained most recently, wrapping around the split. */
function nextDay(days, workouts) {
  const last = workouts.find((w) => w.split_day_id && days.some((d) => d.id === w.split_day_id));
  if (!last) return days[0];
  const i = days.findIndex((d) => d.id === last.split_day_id);
  return days[(i + 1) % days.length];
}

export async function homeView(container) {
  const { workouts } = await api.get('/api/workouts?limit=40');
  const days = activeDays();
  const today = todayStr();

  const dateInput = h('input', { type: 'date', value: today, class: 'date-input', id: 'workout-date', 'aria-label': 'Workout date' });
  const copyToggle = h('input', { type: 'checkbox', checked: true, id: 'copy-last' });

  const start = safe(async (dayId, button) => {
    if (!dateInput.value) return;
    button.disabled = true;
    try {
      const data = await api.post('/api/workouts', {
        date: dateInput.value,
        split_day_id: dayId,
        copy_last: copyToggle.checked,
      });
      location.hash = `#/workout/${data.workout.id}`;
    } finally {
      button.disabled = false;
    }
  });

  const startButton = (day, label, primary = false) => {
    const button = h(
      'button',
      { class: `btn ${primary ? 'primary' : ''}`.trim(), onClick: () => start(day?.id ?? null, button) },
      label
    );
    return button;
  };

  const todays = workouts.find((w) => w.date === today);
  const thisWeek = workouts.filter((w) => w.date >= mondayOf(today)).length;

  const parts = [
    h(
      'div',
      { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Train'), h('p', {}, fmtDate(today, { year: false }))),
      thisWeek ? h('span', { class: 'chip' }, `${thisWeek} this week`) : null
    ),
  ];

  if (todays) {
    parts.push(
      h(
        'a',
        { class: 'workout-link', href: `#/workout/${todays.id}`, style: { marginBottom: '14px' } },
        h('div', { class: 'row between' }, h('h3', {}, `Continue ${workoutTitle(todays)}`), h('span', { class: 'muted small' }, 'Today'))
      )
    );
  }

  if (!days.length) {
    parts.push(
      h(
        'div',
        { class: 'empty' },
        h('h2', {}, 'Set up your split'),
        h('p', {}, 'Add your training days and the muscle groups on each one. You only do this once.'),
        h('a', { class: 'btn primary', href: '#/split' }, 'Build my split'),
        h('div', { style: { marginTop: '12px' } }, startButton(null, 'Or start a free workout'))
      ),
      h('div', { class: 'row between' }, h('label', { class: 'field-label', for: 'workout-date' }, 'Workout date'), dateInput)
    );
  } else {
    const next = nextDay(days, workouts);
    const lastOfDay = workouts.find((w) => w.split_day_id === next.id);
    parts.push(
      h(
        'section',
        { class: 'hero', style: { '--plate': plateColor(next.muscle_group_ids[0] ?? 0) } },
        h('p', { class: 'eyebrow' }, lastOfDay ? `Up next. Last ${next.name}: ${fmtDate(lastOfDay.date)}` : 'Up next'),
        h('h2', {}, next.name),
        h('div', { class: 'chips' }, next.muscle_group_ids.map(groupChip)),
        startButton(next, `Start ${next.name}`, true)
      ),
      h(
        'div',
        { class: 'start-options' },
        h(
          'div',
          { class: 'row between' },
          h('label', { class: 'field-label', for: 'workout-date' }, 'Workout date'),
          dateInput
        ),
        h('label', { class: 'check', for: 'copy-last' }, copyToggle, h('span', {}, 'Start with the exercises from last time'))
      )
    );

    const others = days.filter((d) => d.id !== next.id);
    if (others.length) {
      parts.push(h('h2', { class: 'section-title' }, 'Other days'));
      for (const day of others) {
        parts.push(
          h(
            'div',
            { class: 'day-row', style: { '--plate': plateColor(day.muscle_group_ids[0] ?? 0) } },
            h(
              'div',
              { class: 'grow' },
              h('h3', {}, day.name),
              h('div', { class: 'chips', style: { marginTop: '6px' } }, day.muscle_group_ids.map(groupChip))
            ),
            startButton(day, 'Start')
          )
        );
      }
    }
    parts.push(h('div', { style: { marginTop: '14px' } }, startButton(null, 'Start a free workout')));
  }

  const recent = workouts.slice(0, 4);
  if (recent.length) {
    parts.push(
      h('div', { class: 'row between', style: { margin: '24px 0 10px' } }, h('h2', { style: { fontSize: '24px' } }, 'Recent'), h('a', { href: '#/history', class: 'small', style: { color: 'var(--accent-text)', fontWeight: 700 } }, 'See all')),
      recent.map((w) => workoutCard(w))
    );
  }

  container.append(...parts.flat());
}
