import { api } from '../api.js';
import { h, clear, appendAll, icon, safe, toast, promptSheet, menuSheet, openSheet, pluralize } from '../util.js';
import { state, loadCatalog, activeGroups, activeDays, exercisesOfGroup, groupById, plateColor } from '../state.js';

const TEMPLATES = [
  {
    name: 'Push / Pull / Legs',
    blurb: 'Three days, upper body split by push and pull, plus a leg day.',
    days: [
      { name: 'Push', groups: ['Chest', 'Shoulders', 'Triceps'] },
      { name: 'Pull', groups: ['Back', 'Biceps'] },
      { name: 'Legs', groups: ['Quads', 'Hamstrings', 'Glutes', 'Calves'] },
    ],
  },
  {
    name: 'Upper / Lower',
    blurb: 'Two days, alternating upper and lower body.',
    days: [
      { name: 'Upper', groups: ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps'] },
      { name: 'Lower', groups: ['Quads', 'Hamstrings', 'Glutes', 'Calves'] },
    ],
  },
  {
    name: 'Full body',
    blurb: 'One day covering the whole body, repeated each session.',
    days: [{ name: 'Full Body', groups: ['Chest', 'Back', 'Shoulders', 'Legs', 'Arms'] }],
  },
];

export async function splitView(container) {
  const root = h('div');
  container.append(root);

  const refresh = async () => {
    await loadCatalog();
    render();
  };

  // ---------- Muscle groups ----------

  const addGroup = safe(async () => {
    const name = await promptSheet({ title: 'New muscle group', placeholder: 'e.g. Forearms', submitLabel: 'Add' });
    if (!name?.trim()) return;
    await api.post('/api/muscle-groups', { name: name.trim() });
    await refresh();
  });

  const renameGroup = safe(async (g) => {
    const name = await promptSheet({ title: 'Rename muscle group', value: g.name, submitLabel: 'Save' });
    if (!name?.trim() || name.trim() === g.name) return;
    await api.patch(`/api/muscle-groups/${g.id}`, { name: name.trim() });
    await refresh();
  });

  const archiveGroup = safe(async (g) => {
    await api.patch(`/api/muscle-groups/${g.id}`, { archived: true });
    await refresh();
    toast(`${g.name} archived`, { actionLabel: 'Undo', onAction: safe(async () => {
      await api.patch(`/api/muscle-groups/${g.id}`, { archived: false });
      await refresh();
    }) });
  });

  function groupMenu(g) {
    menuSheet(g.name, [
      { label: 'Rename', icon: 'edit', onSelect: () => renameGroup(g) },
      { label: 'Archive', hint: 'Hides it and its exercises. You can restore it later.', danger: true, icon: 'x', onSelect: () => archiveGroup(g) },
    ]);
  }

  // ---------- Exercises ----------

  const addExercise = safe(async (group, input) => {
    const name = input.value.trim();
    if (!name) return;
    await api.post('/api/exercises', { name, muscle_group_id: group.id });
    input.value = '';
    await refresh();
  });

  const renameExercise = safe(async (ex) => {
    const name = await promptSheet({ title: 'Rename exercise', value: ex.name, submitLabel: 'Save' });
    if (!name?.trim() || name.trim() === ex.name) return;
    await api.patch(`/api/exercises/${ex.id}`, { name: name.trim() });
    await refresh();
  });

  const toggleExerciseArchived = safe(async (ex, archived) => {
    await api.patch(`/api/exercises/${ex.id}`, { archived });
    await refresh();
  });

  function moveExercise(ex) {
    const others = activeGroups().filter((g) => g.id !== ex.muscle_group_id);
    if (!others.length) return;
    openSheet({
      title: `Move ${ex.name} to`,
      body: (close) =>
        h(
          'div',
          {},
          others.map((g) =>
            h(
              'button',
              {
                class: 'pick-row',
                style: { '--plate': plateColor(g.id) },
                onClick: safe(async () => {
                  close();
                  await api.patch(`/api/exercises/${ex.id}`, { muscle_group_id: g.id });
                  await refresh();
                }),
              },
              h('span', { class: 'dot' }),
              g.name
            )
          )
        ),
    });
  }

  function exerciseMenu(ex) {
    menuSheet(ex.name, [
      { label: 'Rename', icon: 'edit', onSelect: () => renameExercise(ex) },
      { label: 'Move to another muscle group', icon: 'link', onSelect: () => moveExercise(ex) },
      ex.archived
        ? { label: 'Restore', icon: 'restore', onSelect: () => toggleExerciseArchived(ex, false) }
        : { label: 'Archive', hint: 'Hides it from pickers. Past logs are unaffected.', danger: true, icon: 'x', onSelect: () => toggleExerciseArchived(ex, true) },
    ]);
  }

  function groupCard(g, { showArchivedExercises } = {}) {
    const list = exercisesOfGroup(g.id).concat(showArchivedExercises ? exercisesOfGroup(g.id, { archived: true }) : []);
    const input = h('input', { type: 'text', placeholder: `Add exercise to ${g.name}`, maxlength: 80, 'aria-label': `Add exercise to ${g.name}` });
    input.addEventListener('keydown', (e) => e.key === 'Enter' && addExercise(g, input));

    return h(
      'div',
      { class: 'group-card', style: { '--plate': plateColor(g.id) } },
      h(
        'div',
        { class: 'row between' },
        h('h3', {}, g.name),
        h('button', { class: 'icon-btn', 'aria-label': `Options for ${g.name}`, onClick: () => groupMenu(g) }, icon('dots', 20))
      ),
      list.length
        ? h(
            'ul',
            { class: 'ex-list' },
            list.map((ex) =>
              h(
                'li',
                { class: ex.archived ? 'archived' : '' },
                h('span', { class: 'grow' }, ex.name),
                h('button', { class: 'icon-btn', 'aria-label': `Options for ${ex.name}`, onClick: () => exerciseMenu(ex) }, icon('dots', 18))
              )
            )
          )
        : h('p', { class: 'muted small', style: { margin: '8px 0' } }, 'No exercises yet.'),
      h('div', { class: 'add-inline' }, input, h('button', { class: 'btn small', onClick: () => addExercise(g, input) }, icon('plus', 16)))
    );
  }

  // ---------- Split days ----------

  const createDay = safe(async (name, groupIds = []) => {
    await api.post('/api/split-days', { name, muscle_group_ids: groupIds });
    await refresh();
  });

  const addDay = safe(async () => {
    const name = await promptSheet({ title: 'New training day', placeholder: 'e.g. Push', submitLabel: 'Add' });
    if (!name?.trim()) return;
    await createDay(name.trim());
  });

  const renameDay = safe(async (day) => {
    const name = await promptSheet({ title: 'Rename day', value: day.name, submitLabel: 'Save' });
    if (!name?.trim() || name.trim() === day.name) return;
    await api.patch(`/api/split-days/${day.id}`, { name: name.trim() });
    await refresh();
  });

  const archiveDay = safe(async (day) => {
    await api.patch(`/api/split-days/${day.id}`, { archived: true });
    await refresh();
    toast(`${day.name} archived`, { actionLabel: 'Undo', onAction: safe(async () => {
      await api.patch(`/api/split-days/${day.id}`, { archived: false });
      await refresh();
    }) });
  });

  function editDayGroups(day) {
    const selected = new Set(day.muscle_group_ids);
    openSheet({
      title: `Muscle groups for ${day.name}`,
      body: (close) =>
        h(
          'div',
          {},
          activeGroups().map((g) => {
            const row = h(
              'button',
              {
                class: 'pick-row',
                style: { '--plate': plateColor(g.id) },
                onClick: () => {
                  selected.has(g.id) ? selected.delete(g.id) : selected.add(g.id);
                  row.querySelector('.tick')?.remove();
                  if (selected.has(g.id)) row.append(h('span', { class: 'tick' }, icon('check')));
                },
              },
              h('span', { class: 'dot' }),
              g.name,
              selected.has(g.id) ? h('span', { class: 'tick' }, icon('check')) : null
            );
            return row;
          }),
          h(
            'button',
            {
              class: 'btn primary block',
              style: { marginTop: '12px' },
              onClick: safe(async () => {
                close();
                await api.patch(`/api/split-days/${day.id}`, { muscle_group_ids: [...selected] });
                await refresh();
              }),
            },
            'Done'
          )
        ),
    });
  }

  function dayMenu(day) {
    menuSheet(day.name, [
      { label: 'Rename', icon: 'edit', onSelect: () => renameDay(day) },
      { label: 'Edit muscle groups', icon: 'split', onSelect: () => editDayGroups(day) },
      { label: 'Archive day', hint: 'Past workouts stay in History.', danger: true, icon: 'x', onSelect: () => archiveDay(day) },
    ]);
  }

  async function applyTemplate(tpl) {
    const existingNames = new Set(activeGroups().map((g) => g.name.toLowerCase()));
    const nameToId = new Map(activeGroups().map((g) => [g.name.toLowerCase(), g.id]));
    for (const day of tpl.days) {
      for (const name of day.groups) {
        if (!existingNames.has(name.toLowerCase())) {
          const g = await api.post('/api/muscle-groups', { name });
          nameToId.set(name.toLowerCase(), g.id);
          existingNames.add(name.toLowerCase());
        }
      }
    }
    for (const day of tpl.days) {
      await api.post('/api/split-days', { name: day.name, muscle_group_ids: day.groups.map((n) => nameToId.get(n.toLowerCase())) });
    }
    await refresh();
    toast(`${tpl.name} added — tweak it any time`);
  }

  function render() {
    const groups = activeGroups();
    const days = activeDays();

    const sections = [
      h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Split'), h('p', {}, 'Set this up once. Change it whenever your training changes.'))),
    ];

    if (!days.length) {
      sections.push(
        h('h2', { class: 'section-title' }, 'Pick a starting point'),
        h('div', { class: 'template-grid' }, TEMPLATES.map((tpl) => h('button', { class: 'template', onClick: () => applyTemplate(tpl) }, h('h3', {}, tpl.name), h('p', {}, tpl.blurb)))),
        h('p', { class: 'muted small', style: { margin: '14px 0' } }, 'Or build your own below.')
      );
    }

    sections.push(
      h('h2', { class: 'section-title' }, 'Training days'),
      days.length
        ? h(
            'div',
            {},
            days.map((day) =>
              h(
                'div',
                { class: 'day-row', style: { '--plate': plateColor(day.muscle_group_ids[0] ?? 0) } },
                h(
                  'div',
                  { class: 'grow' },
                  h('h3', {}, day.name),
                  h(
                    'div',
                    { class: 'chips', style: { marginTop: '6px' } },
                    day.muscle_group_ids.length
                      ? day.muscle_group_ids.map((id) => {
                          const g = groupById(id);
                          return g && h('span', { class: 'chip', style: { '--plate': plateColor(id) } }, h('span', { class: 'dot' }), g.name);
                        })
                      : h('span', { class: 'muted small' }, 'No muscle groups yet')
                  )
                ),
                h('button', { class: 'icon-btn', 'aria-label': `Options for ${day.name}`, onClick: () => dayMenu(day) }, icon('dots', 22))
              )
            )
          )
        : h('p', { class: 'muted' }, 'No training days yet.'),
      h('button', { class: 'btn block', style: { marginTop: '10px' }, onClick: addDay }, icon('plus', 18), 'Add training day')
    );

    sections.push(
      h('h2', { class: 'section-title' }, `Muscle groups & exercises`),
      groups.length ? h('div', {}, groups.map((g) => groupCard(g))) : h('p', { class: 'muted' }, 'No muscle groups yet.'),
      h('button', { class: 'btn block', style: { marginTop: '10px' }, onClick: addGroup }, icon('plus', 18), 'Add muscle group')
    );

    const archivedGroups = state.catalog.muscle_groups.filter((g) => g.archived);
    const archivedDays = state.catalog.split_days.filter((d) => d.archived);
    if (archivedGroups.length || archivedDays.length) {
      sections.push(
        h('h2', { class: 'section-title' }, 'Archived'),
        h(
          'div',
          { class: 'card' },
          archivedDays.map((d) =>
            h(
              'div',
              { class: 'row between', style: { padding: '6px 0' } },
              h('span', {}, d.name),
              h('button', { class: 'btn small', onClick: safe(async () => { await api.patch(`/api/split-days/${d.id}`, { archived: false }); await refresh(); }) }, 'Restore')
            )
          ),
          archivedGroups.map((g) =>
            h(
              'div',
              { class: 'row between', style: { padding: '6px 0' } },
              h('span', {}, g.name),
              h('button', { class: 'btn small', onClick: safe(async () => { await api.patch(`/api/muscle-groups/${g.id}`, { archived: false }); await refresh(); }) }, 'Restore')
            )
          )
        )
      );
    }

    sections.push(
      h(
        'p',
        { class: 'muted small', style: { marginTop: '24px', textAlign: 'center' } },
        pluralize(groups.reduce((a, g) => a + exercisesOfGroup(g.id).length, 0), 'exercise'),
        ' across ',
        pluralize(groups.length, 'muscle group')
      )
    );

    appendAll(clear(root), sections);
  }

  render();
}
