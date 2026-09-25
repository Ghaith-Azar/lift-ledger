import { api } from '../api.js';
import {
  h,
  clear,
  appendAll,
  icon,
  toast,
  safe,
  openSheet,
  promptSheet,
  menuSheet,
  relDay,
  fmtNum,
  fmtVolume,
  pluralize,
} from '../util.js';
import { state, loadCatalog, activeGroups, exercisesOfGroup, plateColor, groupById } from '../state.js';
import { groupChip, workoutTitle } from './shared.js';

const LETTERS = 'ABCDEFGH';

export async function workoutView(container, [idParam]) {
  const id = Number(idParam);
  let data = await api.get(`/api/workouts/${id}`);
  let showRemoved = false;
  let focus = null; // { exId, field }

  const root = h('div');
  const summary = h('div', { class: 'chips' });
  container.append(root);

  // ---------- Small helpers ----------

  /** Run an API call that returns the fresh workout, then redraw. */
  const act = (fn) =>
    safe(async (...args) => {
      const next = await fn(...args);
      if (next?.workout) {
        data = next;
        render();
      }
    });

  const activeExercises = () => data.exercises.filter((e) => !e.archived);
  const dayGroupIds = () =>
    state.catalog.split_days.find((d) => d.id === data.workout.split_day_id)?.muscle_group_ids ?? [];

  function computeStats() {
    let sets = 0;
    let volume = 0;
    const exercises = activeExercises();
    for (const e of exercises) {
      for (const s of e.sets) {
        if (s.archived || !s.reps) continue;
        if (s.drop_index === 0) sets += 1;
        volume += (s.weight || 0) * s.reps;
      }
    }
    return { exercises: exercises.length, sets, volume };
  }

  function updateSummary() {
    const s = computeStats();
    summary.replaceChildren(
      h('span', { class: 'chip' }, pluralize(s.exercises, 'exercise')),
      h('span', { class: 'chip' }, pluralize(s.sets, 'set')),
      h('span', { class: 'chip' }, `${fmtVolume(s.volume)} ${state.unit} lifted`)
    );
  }

  // ---------- Set rows ----------

  function numberInput(e, s, field, placeholder, label) {
    const input = h('input', {
      type: 'text',
      name: field,
      class: 'num',
      inputmode: field === 'weight' ? 'decimal' : 'numeric',
      enterkeyhint: 'next',
      autocomplete: 'off',
      placeholder,
      value: s[field] ?? '',
      'aria-label': label,
    });
    input.addEventListener('focus', () => input.select());
    input.addEventListener(
      'change',
      safe(async () => {
        const raw = input.value.trim().replace(',', '.');
        const value = raw === '' ? null : Number(raw);
        const invalid =
          value !== null && (!Number.isFinite(value) || value < 0 || (field === 'reps' && !Number.isInteger(value)));
        if (invalid) {
          input.value = s[field] ?? '';
          toast(field === 'reps' ? 'Reps must be a whole number' : 'Enter a valid weight', { error: true });
          return;
        }
        if (value === (s[field] ?? null)) return;
        try {
          const res = await api.patch(`/api/sets/${s.id}`, { [field]: value });
          s[field] = res.set[field];
          updateSummary();
        } catch (err) {
          input.value = s[field] ?? '';
          throw err;
        }
      })
    );
    return input;
  }

  const addSet = act(async (e) => {
    const mains = e.sets.filter((s) => !s.archived && s.drop_index === 0);
    const last = mains[mains.length - 1];
    const next = await api.post(
      `/api/workout-exercises/${e.id}/sets`,
      last ? { weight: last.weight, reps: last.reps } : {}
    );
    focus = { exId: e.id, field: last ? 'reps' : 'weight' };
    return next;
  });

  const addDrop = act(async (e, s) => {
    const next = await api.post(`/api/workout-exercises/${e.id}/sets`, { drop_of: s.set_number });
    focus = { exId: e.id, field: 'weight' };
    return next;
  });

  const copyPrevious = act(async (e) => api.post(`/api/workout-exercises/${e.id}/copy-previous`));

  const setArchived = act(async (s, archived) => api.patch(`/api/sets/${s.id}`, { archived }));

  const removeSet = async (s, label) => {
    await setArchived(s, true);
    toast(`${label} removed`, { actionLabel: 'Undo', onAction: () => setArchived(s, false) });
  };

  function setRow(e, s, n, prevByKey, above) {
    const isDrop = s.drop_index > 0;
    const prev = prevByKey.get(`${n}.${s.drop_index}`);
    const label = isDrop ? `Set ${n} drop ${s.drop_index}` : `Set ${n}`;

    let weightHint = prev ? fmtNum(prev.weight) : '';
    if (!prev && isDrop && above?.weight) weightHint = fmtNum(Math.round(above.weight * 0.8 * 2) / 2);

    return h(
      'div',
      { class: `set-row${isDrop ? ' drop' : ''}`, 'data-set-id': s.id },
      isDrop
        ? h('span', { class: 'disc drop', title: 'Drop set' }, icon('down', 14))
        : h('span', { class: 'disc' }, n),
      h('span', { class: 'prev' }, prev ? `${fmtNum(prev.weight)}×${prev.reps}` : '–'),
      numberInput(e, s, 'weight', weightHint, `${label} weight`),
      numberInput(e, s, 'reps', prev ? String(prev.reps) : '', `${label} reps`),
      h(
        'button',
        {
          class: 'set-btn drop-btn',
          title: 'Add a drop set',
          'aria-label': `Add a drop after ${label.toLowerCase()}`,
          onClick: () => addDrop(e, s),
        },
        icon('down', 18)
      ),
      h(
        'button',
        {
          class: 'set-btn remove',
          title: 'Remove (you can restore it)',
          'aria-label': `Remove ${label.toLowerCase()}`,
          onClick: () => removeSet(s, label),
        },
        icon('x', 18)
      )
    );
  }

  // ---------- Exercise cards ----------

  const editNote = act(async (e) => {
    const note = await promptSheet({
      title: `Note for ${e.exercise_name}`,
      label: 'Seat height, grip, cues, how it felt',
      value: e.notes || '',
      multiline: true,
    });
    if (note === null) return;
    return api.patch(`/api/workout-exercises/${e.id}`, { notes: note });
  });

  const archiveExercise = act(async (e, archived) => api.patch(`/api/workout-exercises/${e.id}`, { archived }));

  const removeExercise = async (e) => {
    await archiveExercise(e, true);
    toast(`${e.exercise_name} removed`, { actionLabel: 'Undo', onAction: () => archiveExercise(e, false) });
  };

  const linkExercises = act(async (a, b) => {
    const next = await api.post(`/api/workout-exercises/${a.id}/link`, { other_id: b.id });
    toast('Superset linked');
    return next;
  });

  const unlinkExercise = act(async (e) => api.post(`/api/workout-exercises/${e.id}/unlink`));

  function openSupersetPicker(e) {
    const others = activeExercises().filter(
      (x) => x.id !== e.id && !(e.superset_key != null && x.superset_key === e.superset_key)
    );
    if (!others.length) {
      toast('Add a second exercise to this workout first');
      return;
    }
    openSheet({
      title: `Superset ${e.exercise_name} with`,
      body: (close) =>
        h(
          'div',
          {},
          others.map((x) =>
            h(
              'button',
              {
                class: 'pick-row',
                style: { '--plate': plateColor(x.muscle_group_id) },
                onClick: () => {
                  close();
                  linkExercises(e, x);
                },
              },
              h('span', { class: 'dot' }),
              x.exercise_name
            )
          )
        ),
    });
  }

  function exerciseMenu(e) {
    menuSheet(e.exercise_name, [
      { label: 'Superset with…', hint: 'Alternate sets between two exercises', icon: 'link', onSelect: () => openSupersetPicker(e) },
      e.superset_key != null && { label: 'Take out of superset', icon: 'x', onSelect: () => unlinkExercise(e) },
      { label: e.notes ? 'Edit note' : 'Add note', icon: 'edit', onSelect: () => editNote(e) },
      { label: 'See progress', icon: 'chart', onSelect: () => (location.hash = `#/progress/exercise/${e.exercise_id}`) },
      { label: 'Remove from workout', hint: 'Hidden, not deleted. You can restore it.', danger: true, icon: 'x', onSelect: () => removeExercise(e) },
    ]);
  }

  function exerciseCard(e, { letter, showGroup } = {}) {
    const activeSets = e.sets.filter((s) => !s.archived);
    const prevByKey = new Map((e.previous?.sets || []).map((s) => [`${s.n}.${s.drop_index}`, s]));

    let n = 0;
    const rows = activeSets.map((s, i) => {
      if (s.drop_index === 0) n += 1;
      return setRow(e, s, n, prevByKey, activeSets[i - 1]);
    });

    const lastTime = e.previous
      ? h(
          'div',
          { class: 'last-time' },
          h('span', {}, `Last time, ${relDay(e.previous.date).toLowerCase()}`),
          e.previous.sets.map((s) => h('b', {}, `${s.drop_index > 0 ? '↓' : ''}${fmtNum(s.weight)}×${s.reps}`))
        )
      : h('div', { class: 'last-time' }, 'First time logging this exercise');

    return h(
      'section',
      { class: 'ex', style: { '--plate': plateColor(e.muscle_group_id) } },
      h(
        'div',
        { class: 'ex-head' },
        h(
          'div',
          { class: 'grow' },
          h(
            'h3',
            {},
            letter && h('span', { class: 'letter' }, letter),
            h('a', { href: `#/progress/exercise/${e.exercise_id}` }, e.exercise_name)
          ),
          showGroup && h('div', { style: { marginTop: '6px' } }, groupChip(e.muscle_group_id)),
          e.notes && h('p', { class: 'ex-note' }, e.notes)
        ),
        h(
          'button',
          { class: 'icon-btn', 'aria-label': `Options for ${e.exercise_name}`, onClick: () => exerciseMenu(e) },
          icon('dots', 22)
        )
      ),
      lastTime,
      rows.length
        ? h(
            'div',
            {},
            h(
              'div',
              { class: 'set-head' },
              h('span', {}),
              h('span', {}, 'Last'),
              h('span', {}, state.unit),
              h('span', {}, 'Reps'),
              h('span', {}),
              h('span', {})
            ),
            h('div', { class: 'set-rows' }, rows)
          )
        : null,
      h(
        'div',
        { class: 'row ex-actions' },
        h('button', { class: 'btn primary grow', onClick: () => addSet(e) }, icon('plus', 18), 'Add set'),
        !rows.length && e.previous?.sets.length
          ? h('button', { class: 'btn', onClick: () => copyPrevious(e) }, 'Copy last time')
          : null
      )
    );
  }

  // ---------- Layout: muscle group sections, supersets ----------

  function buildBlocks() {
    const active = activeExercises();
    const bySuperset = new Map();
    for (const e of active) {
      if (e.superset_key == null) continue;
      if (!bySuperset.has(e.superset_key)) bySuperset.set(e.superset_key, []);
      bySuperset.get(e.superset_key).push(e);
    }
    const blocks = [];
    const seen = new Set();
    for (const e of active) {
      const members = e.superset_key != null ? bySuperset.get(e.superset_key) : null;
      if (members && members.length > 1) {
        if (seen.has(e.superset_key)) continue;
        seen.add(e.superset_key);
        blocks.push({ members });
      } else {
        blocks.push({ members: [e] });
      }
    }
    return blocks;
  }

  function blockEl(block, sectionGroupId) {
    const { members } = block;
    if (members.length === 1) return exerciseCard(members[0], { showGroup: members[0].muscle_group_id !== sectionGroupId });
    return h(
      'div',
      { class: 'superset' },
      h('div', { class: 'superset-label' }, icon('link', 16), members.length > 2 ? 'Giant set' : 'Superset'),
      members.map((e, i) => exerciseCard(e, { letter: LETTERS[i], showGroup: e.muscle_group_id !== sectionGroupId }))
    );
  }

  function sectionEl(groupId, blocks) {
    const group = groupById(groupId);
    return h(
      'section',
      { style: { '--plate': plateColor(groupId) } },
      h(
        'div',
        { class: 'group-head' },
        h('span', { class: 'dot' }),
        h('h2', { class: 'grow' }, group?.name ?? 'Other'),
        h('button', { class: 'btn small', onClick: () => openExercisePicker(groupId) }, icon('plus', 16), 'Exercise')
      ),
      blocks.length
        ? blocks.map((b) => blockEl(b, groupId))
        : h('p', { class: 'muted small' }, 'Nothing added for this muscle group yet.')
    );
  }

  // ---------- Adding exercises ----------

  function openExercisePicker(startGroupId) {
    const inDay = dayGroupIds();
    const groups = activeGroups();
    const ordered = [...groups.filter((g) => inDay.includes(g.id)), ...groups.filter((g) => !inDay.includes(g.id))];
    let groupId = startGroupId ?? ordered[0]?.id;
    const body = h('div', { class: 'stack' });

    const add = safe(async (exerciseId) => {
      data = await api.post(`/api/workouts/${id}/exercises`, { exercise_id: exerciseId });
      render();
      paint();
    });

    const create = safe(async (input) => {
      const name = input.value.trim();
      if (!name) return;
      const ex = await api.post('/api/exercises', { name, muscle_group_id: groupId });
      await loadCatalog();
      await add(ex.id);
    });

    function paint() {
      clear(body);
      if (!ordered.length) {
        body.append(
          h('p', { class: 'muted' }, 'You have no muscle groups yet. Add them in Split first.'),
          h('a', { class: 'btn primary', href: '#/split', onClick: () => sheet.close() }, 'Go to Split')
        );
        return;
      }
      const present = new Set(activeExercises().map((e) => e.exercise_id));
      const list = exercisesOfGroup(groupId);
      const input = h('input', { type: 'text', placeholder: 'New exercise name', maxlength: 80, 'aria-label': 'New exercise name' });
      input.addEventListener('keydown', (ev) => ev.key === 'Enter' && create(input));

      body.append(
        h(
          'div',
          { class: 'chips' },
          ordered.map((g) =>
            h(
              'button',
              {
                class: 'chip',
                'aria-pressed': String(g.id === groupId),
                style: { '--plate': plateColor(g.id) },
                onClick: () => {
                  groupId = g.id;
                  paint();
                },
              },
              h('span', { class: 'dot' }),
              g.name
            )
          )
        ),
        h(
          'div',
          {},
          list.length
            ? list.map((ex) =>
                h(
                  'button',
                  { class: 'pick-row', disabled: present.has(ex.id), onClick: () => add(ex.id) },
                  ex.name,
                  present.has(ex.id) ? h('span', { class: 'tick' }, icon('check')) : null
                )
              )
            : h('p', { class: 'muted' }, 'No exercises in this group yet. Add your first one below.')
        ),
        h('div', { class: 'add-inline' }, input, h('button', { class: 'btn primary', onClick: () => create(input) }, 'Add'))
      );
    }

    const sheet = openSheet({ title: 'Add exercise', body });
    paint();
  }

  // ---------- Workout-level actions ----------

  const patchWorkout = act(async (patch) => api.patch(`/api/workouts/${id}`, patch));

  const archiveWorkout = safe(async () => {
    await api.patch(`/api/workouts/${id}`, { archived: true });
    location.hash = '#/history';
    toast('Workout archived', {
      actionLabel: 'Undo',
      onAction: safe(async () => {
        await api.patch(`/api/workouts/${id}`, { archived: false });
        location.hash = `#/workout/${id}`;
      }),
    });
  });

  async function renameWorkout() {
    const title = await promptSheet({
      title: 'Workout name',
      label: 'Leave empty to use the split day name',
      value: data.workout.title || '',
      placeholder: data.workout.split_day_name || 'Workout',
    });
    if (title !== null) patchWorkout({ title });
  }

  function workoutMenu() {
    menuSheet('Workout', [
      { label: 'Rename', icon: 'edit', onSelect: renameWorkout },
      { label: 'Add exercise', icon: 'plus', onSelect: () => openExercisePicker() },
      { label: 'Archive workout', hint: 'Hidden from history, never deleted', danger: true, icon: 'x', onSelect: archiveWorkout },
    ]);
  }

  // ---------- Removed items ----------

  function removedPanel() {
    const removedExercises = data.exercises.filter((e) => e.archived);
    const removedSets = [];
    for (const e of activeExercises()) {
      const liveMains = new Set(e.sets.filter((s) => !s.archived && s.drop_index === 0).map((s) => s.set_number));
      for (const s of e.sets) {
        if (s.archived && (s.drop_index === 0 || liveMains.has(s.set_number))) removedSets.push({ e, s });
      }
    }
    const count = removedExercises.length + removedSets.length;
    if (!count) return null;

    const restoreRow = (text, onClick) =>
      h(
        'div',
        { class: 'card' },
        h('span', { class: 'grow' }, text),
        h('button', { class: 'btn small', onClick }, icon('restore', 16), 'Restore')
      );

    return h(
      'section',
      { class: 'removed-list', style: { marginTop: '28px' } },
      h(
        'button',
        {
          class: 'btn ghost block',
          onClick: () => {
            showRemoved = !showRemoved;
            render();
          },
        },
        `${showRemoved ? 'Hide' : 'Show'} removed items (${count})`
      ),
      showRemoved
        ? h(
            'div',
            { style: { marginTop: '10px' } },
            h('p', { class: 'muted small', style: { marginBottom: '8px' } }, 'Removed items are hidden, never deleted.'),
            removedExercises.map((e) => restoreRow(e.exercise_name, () => archiveExercise(e, false))),
            removedSets.map(({ e, s }) =>
              restoreRow(
                `${e.exercise_name}: ${s.reps != null ? `${fmtNum(s.weight ?? 0)}×${s.reps}` : 'empty set'}${s.drop_index ? ' (drop)' : ''}`,
                () => setArchived(s, false)
              )
            )
          )
        : null
    );
  }

  // ---------- Render ----------

  function render() {
    const scrollY = window.scrollY;
    const { workout } = data;

    const dateInput = h('input', {
      type: 'date',
      class: 'date-input',
      value: workout.date,
      'aria-label': 'Workout date',
    });
    dateInput.addEventListener('change', () => dateInput.value && patchWorkout({ date: dateInput.value }));

    const active = activeExercises();
    const blocks = buildBlocks();
    const order = [...dayGroupIds()];
    for (const b of blocks) {
      const g = b.members[0].muscle_group_id;
      if (!order.includes(g)) order.push(g);
    }

    const noteBox = h('textarea', {
      rows: 3,
      placeholder: 'How did it go? Sleep, energy, anything worth remembering',
      value: workout.notes || '',
      'aria-label': 'Workout notes',
    });
    noteBox.addEventListener(
      'change',
      safe(async () => {
        const res = await api.patch(`/api/workouts/${id}`, { notes: noteBox.value });
        data.workout = res.workout;
      })
    );

    const blockNodes = order.map((gid) => sectionEl(gid, blocks.filter((b) => b.members[0].muscle_group_id === gid)));
    appendAll(clear(root), [
        h(
          'div',
          { class: 'workout-head' },
          h('a', { class: 'icon-btn', href: '#/history', 'aria-label': 'Back to history' }, icon('back', 24)),
          h('span', { class: 'grow' }),
          dateInput,
          h('button', { class: 'icon-btn', 'aria-label': 'Workout options', onClick: workoutMenu }, icon('dots', 24))
        ),
        workout.archived
          ? h(
              'div',
              { class: 'card row', style: { marginBottom: '12px' } },
              h('span', { class: 'grow' }, 'This workout is archived.'),
              h('button', { class: 'btn small', onClick: () => patchWorkout({ archived: false }) }, 'Restore')
            )
          : null,
        h('div', { class: 'workout-title' }, h('h1', {}, workoutTitle(workout))),
        h('div', { style: { margin: '10px 0 0' } }, summary),
        blockNodes,
        h(
          'div',
          { style: { marginTop: '20px' } },
          h(
            'button',
            { class: `btn ${active.length ? '' : 'primary'} block`.trim(), onClick: () => openExercisePicker() },
            icon('plus', 18),
            'Add exercise'
          )
        ),
        h('h2', { class: 'section-title' }, 'Notes'),
        noteBox,
        removedPanel(),
    ]);
    updateSummary();
    window.scrollTo(0, scrollY);

    if (focus) {
      const ex = data.exercises.find((x) => x.id === focus.exId);
      const newest = ex?.sets.reduce((a, s) => (s.id > (a?.id ?? 0) ? s : a), null);
      if (newest) root.querySelector(`[data-set-id="${newest.id}"] input[name="${focus.field}"]`)?.focus({ preventScroll: false });
      focus = null;
    }
  }

  render();
}
