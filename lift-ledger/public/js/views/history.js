import { api } from '../api.js';
import { h, clear, appendAll, safe, mondayOf, fmtWeek } from '../util.js';
import { workoutCard } from './shared.js';

export async function historyView(container) {
  let mode = 'active';
  let items = [];
  let hasMore = false;
  const root = h('div');
  container.append(root);

  async function load(reset) {
    if (reset) items = [];
    const res = await api.get(
      `/api/workouts?archived=${mode === 'archived' ? 1 : 0}&limit=30&offset=${items.length}`
    );
    items = items.concat(res.workouts);
    hasMore = res.has_more;
  }

  const setMode = safe(async (next) => {
    mode = next;
    await load(true);
    render();
  });

  const loadMore = safe(async () => {
    await load(false);
    render();
  });

  const restore = safe(async (w) => {
    await api.patch(`/api/workouts/${w.id}`, { archived: false });
    await load(true);
    render();
  });

  function render() {
    const parts = [];
    let currentWeek = null;
    for (const w of items) {
      const week = mondayOf(w.date);
      if (week !== currentWeek) {
        currentWeek = week;
        parts.push(h('p', { class: 'week-label' }, `Week of ${fmtWeek(week)}`));
      }
      parts.push(
        workoutCard(w, {
          extra:
            mode === 'archived'
              ? h('div', { style: { margin: '6px 0 0' } }, h('button', { class: 'btn small', onClick: () => restore(w) }, 'Restore workout'))
              : null,
        })
      );
    }

    const top = [
      h(
        'div',
        { class: 'page-head' },
        h('div', {}, h('h1', {}, 'History'), h('p', {}, 'Tap a workout to see it or edit it.'))
      ),
      h(
        'div',
        { class: 'segmented', role: 'group', 'aria-label': 'Show' },
        ['active', 'archived'].map((m) =>
          h('button', { 'aria-pressed': String(mode === m), onClick: () => mode !== m && setMode(m) }, m === 'active' ? 'Workouts' : 'Archived')
        )
      ),
      items.length
        ? parts
        : h(
            'div',
            { class: 'empty' },
            h('h2', {}, mode === 'active' ? 'No workouts yet' : 'Nothing archived'),
            h('p', {}, mode === 'active' ? 'Start a workout from the Train tab and it will show up here.' : 'Workouts you archive stay here so you can restore them.'),
            mode === 'active' ? h('a', { class: 'btn primary', href: '#/' }, 'Go to Train') : null
          ),
      hasMore ? h('div', { style: { marginTop: '14px' } }, h('button', { class: 'btn block', onClick: loadMore }, 'Load more')) : null,
    ];
    appendAll(clear(root), top);
  }

  await load(true);
  render();
}
