import { api } from '../api.js';
import {
  h,
  clear,
  appendAll,
  icon,
  toast,
  celebratePR,
  safe,
  openSheet,
  promptSheet,
  menuSheet,
  relDay,
  fmtNum,
  fmtVolume,
  fmtClock,
  fmtDuration,
  pluralize,
} from '../util.js';
import { state, loadCatalog, activeGroups, exercisesOfGroup, plateColor, groupById } from '../state.js';
import { groupChip, workoutTitle, suggestionChips } from './shared.js';
import {
  newTempId,
  isTempId,
  hasPendingFor,
  pendingCount,
  enqueueCreateSet,
  enqueueUpdateSet,
  enqueueArchiveSet,
  updatePendingCreate,
  subscribe as subscribeQueue,
} from '../offlineSets.js';

const LETTERS = 'ABCDEFGH';

export async function workoutView(container, [idParam]) {
  const id = Number(idParam);
  let data = await api.get(`/api/workouts/${id}`);
  let showRemoved = false;
  let focus = null; // { exId, field }
  let timerInterval = null;

  const clearTimer = () => {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  };

  const root = h('div');
  const summary = h('div', { class: 'chips' });
  container.append(root);

  // If some of this workout's changes are still queued from an earlier
  // offline moment, re-render as they sync so the "pending" dots clear and,
  // once the queue is fully drained, pull a fresh copy to self-heal any
  // ordering edge case rather than trusting the optimistic local state forever.
  let hadPending = false;
  const unsubscribeQueue = subscribeQueue(async () => {
    const pending = pendingCount();
    if (pending === 0 && hadPending) {
      hadPending = false;
      try {
        data = await api.get(`/api/workouts/${id}`);
      } catch {
        // Offline again before the refetch landed — next sync will retry this.
      }
    } else if (pending > 0) {
      hadPending = true;
    }
    render();
  });

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

  function prMessage(e, pr) {
    const name = e.exercise_name;
    if (pr.type === 'weight') return `🏆 New PR! ${fmtNum(pr.value)} ${state.unit} on ${name}`;
    if (pr.type === 'reps') return `🏆 New PR! ${pr.value} reps on ${name}`;
    return `🏆 New PR! Strongest effort yet on ${name} (est. 1RM ${fmtNum(pr.value)} ${state.unit})`;
  }

  /**
   * Quick -5 / -2.5 / +2.5 / +5 buttons that appear under a weight field while it is focused.
   * Taps update the box instantly and save once, shortly after the last tap, so a burst of
   * taps is one edit (and at most one PR celebration).
   */
  function attachStepper(input, s, commit) {
    let bar = null;
    let timer = null;

    const flush = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
        commit();
      }
    };

    const adjust = (delta) => {
      const raw = input.value.trim().replace(',', '.');
      const typed = Number(raw);
      const base = raw !== '' && Number.isFinite(typed) ? typed : Number(s.weight) || 0;
      const next = Math.max(0, Math.round((base + delta) * 100) / 100);
      input.value = fmtNum(next);
      input.focus({ preventScroll: true });
      clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        commit();
      }, 500);
    };

    input.addEventListener('focus', () => {
      if (bar) return;
      bar = h(
        'div',
        { class: 'stepper-row' },
        [-5, -2.5, 2.5, 5].map((d) =>
          h(
            'button',
            {
              type: 'button',
              class: `stepper-btn ${d < 0 ? 'minus' : 'plus'}`,
              'aria-label': `${d > 0 ? 'Add' : 'Remove'} ${Math.abs(d)} ${state.unit}`,
              // Keep the field focused so the buttons don't vanish mid-tap.
              onMouseDown: (ev) => ev.preventDefault(),
              onClick: () => adjust(d),
            },
            `${d > 0 ? '+' : '−'}${Math.abs(d)}`
          )
        )
      );
      input.closest('.set-row')?.after(bar);
    });

    input.addEventListener('blur', () => {
      flush();
      setTimeout(() => {
        if (document.activeElement !== input) {
          bar?.remove();
          bar = null;
        }
      }, 200);
    });
  }

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

    const commit = safe(async () => {
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
        if (res.pr) celebratePR(prMessage(e, res.pr));
      } catch (err) {
        if (err.status !== 0) {
          input.value = s[field] ?? '';
          throw err;
        }
        // Offline: save on the device and queue it. PR checks need the
        // server's history, so that part just waits until it syncs.
        s[field] = value;
        updateSummary();
        if (isTempId(s.id)) updatePendingCreate(s.id, { [field]: value });
        else enqueueUpdateSet(s.id, { [field]: value });
        render();
      }
    });

    input.addEventListener('focus', () => input.select());
    input.addEventListener('change', commit);
    if (field === 'weight') attachStepper(input, s, commit);
    return input;
  }

  const nextSetNumber = (e) => e.sets.reduce((max, s) => Math.max(max, s.set_number), 0) + 1;
  const nextDropIndex = (e, setNumber) =>
    e.sets.filter((s) => s.set_number === setNumber).reduce((max, s) => Math.max(max, s.drop_index), 0) + 1;

  const addSet = act(async (e) => {
    const mains = e.sets.filter((s) => !s.archived && s.drop_index === 0);
    const last = mains[mains.length - 1];
    const body = last ? { weight: last.weight, reps: last.reps } : {};
    focus = { exId: e.id, field: last ? 'reps' : 'weight' };
    try {
      return await api.post(`/api/workout-exercises/${e.id}/sets`, body);
    } catch (err) {
      if (err.status !== 0) throw err;
      const setNumber = nextSetNumber(e);
      const targetId = newTempId();
      e.sets.push({
        id: targetId,
        workout_exercise_id: e.id,
        set_number: setNumber,
        drop_index: 0,
        weight: body.weight ?? null,
        reps: body.reps ?? null,
        archived: 0,
      });
      enqueueCreateSet({ targetId, workoutExerciseId: e.id, dropOf: null, setNumber, dropIndex: 0, ...body });
      toast("Offline — this set will sync once you're back online", { variant: 'offline' });
      return data;
    }
  });

  const addDrop = act(async (e, s) => {
    focus = { exId: e.id, field: 'weight' };
    try {
      return await api.post(`/api/workout-exercises/${e.id}/sets`, { drop_of: s.set_number });
    } catch (err) {
      if (err.status !== 0) throw err;
      const dropIndex = nextDropIndex(e, s.set_number);
      const targetId = newTempId();
      e.sets.push({
        id: targetId,
        workout_exercise_id: e.id,
        set_number: s.set_number,
        drop_index: dropIndex,
        weight: null,
        reps: null,
        archived: 0,
      });
      enqueueCreateSet({ targetId, workoutExerciseId: e.id, dropOf: s.set_number, setNumber: s.set_number, dropIndex });
      toast("Offline — this drop set will sync once you're back online", { variant: 'offline' });
      return data;
    }
  });

  const copyPrevious = act(async (e) => api.post(`/api/workout-exercises/${e.id}/copy-previous`));

  const setArchived = act(async (s, archived) => {
    try {
      return await api.patch(`/api/sets/${s.id}`, { archived });
    } catch (err) {
      if (err.status !== 0) throw err;
      // Mirror the backend: archiving/restoring a main set carries its drops with it.
      const we = data.exercises.find((ex) => ex.sets.includes(s));
      s.archived = archived ? 1 : 0;
      if (s.drop_index === 0 && we) {
        for (const d of we.sets) {
          if (d !== s && d.set_number === s.set_number) d.archived = archived ? 1 : 0;
        }
      }
      enqueueArchiveSet(s.id, !!archived);
      toast("Offline — will sync once you're back online", { variant: 'offline' });
      return data;
    }
  });

  const removeSet = async (s, label) => {
    await setArchived(s, true);
    toast(`${label} removed`, { actionLabel: 'Undo', onAction: () => setArchived(s, false) });
  };

  function setRow(e, s, n, prevByKey, above) {
    const isDrop = s.drop_index > 0;
    const prev = prevByKey.get(`${n}.${s.drop_index}`);
    const label = isDrop ? `Set ${n} drop ${s.drop_index}` : `Set ${n}`;
    const pending = isTempId(s.id) || hasPendingFor(s.id);

    let weightHint = prev ? fmtNum(prev.weight) : '';
    if (!prev && isDrop && above?.weight) weightHint = fmtNum(Math.round(above.weight * 0.8 * 2) / 2);

    return h(
      'div',
      { class: `set-row${isDrop ? ' drop' : ''}${pending ? ' pending' : ''}`, 'data-set-id': s.id },
      isDrop
        ? h('span', { class: `disc drop${pending ? ' pending' : ''}`, title: 'Drop set' }, icon('down', 14))
        : h('span', { class: `disc${pending ? ' pending' : ''}`, title: pending ? 'Waiting to sync' : undefined }, n),
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
    const blocks = sectionBlocksFor(e.muscle_group_id);
    const idx = blocks.findIndex((b) => b.members.some((m) => m.id === e.id));
    const canMoveUp = idx > 0;
    const canMoveDown = idx !== -1 && idx < blocks.length - 1;
    menuSheet(e.exercise_name, [
      canMoveUp && { label: 'Move up', icon: 'up', onSelect: () => moveBlock(e, -1) },
      canMoveDown && { label: 'Move down', icon: 'down', onSelect: () => moveBlock(e, 1) },
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

  /** All blocks (single exercises or supersets) in the same muscle-group section as `e`, in display order. */
  function sectionBlocksFor(groupId) {
    return buildBlocks().filter((b) => b.members[0].muscle_group_id === groupId);
  }

  /**
   * Move the whole block `e` belongs to up or down within its section, by
   * swapping positions with the adjacent block. Supersets move as one unit.
   * Reuses this section's own existing position numbers (just reassigned in
   * the new order), so other sections are never touched.
   */
  const moveBlock = act(async (e, direction) => {
    const blocks = sectionBlocksFor(e.muscle_group_id);
    const idx = blocks.findIndex((b) => b.members.some((m) => m.id === e.id));
    const target = idx + direction;
    if (idx === -1 || target < 0 || target >= blocks.length) return null;

    const reordered = [...blocks];
    const [moved] = reordered.splice(idx, 1);
    reordered.splice(target, 0, moved);

    const slots = blocks.flatMap((b) => b.members.map((m) => m.position)).sort((a, b) => a - b);
    const newFlat = reordered.flatMap((b) => b.members);
    const updates = newFlat
      .map((m, i) => ({ id: m.id, position: slots[i] }))
      .filter((u, i) => u.position !== newFlat[i].position);

    if (!updates.length) return null;
    await Promise.all(updates.map((u) => api.patch(`/api/workout-exercises/${u.id}`, { position: u.position })));
    return api.get(`/api/workouts/${id}`);
  });

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

    const create = safe(async (name) => {
      name = name.trim();
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
      const groupName = groups.find((g) => g.id === groupId)?.name || '';
      const input = h('input', { type: 'text', placeholder: 'New exercise name', maxlength: 80, 'aria-label': 'New exercise name' });
      input.addEventListener('keydown', (ev) => ev.key === 'Enter' && create(input.value));

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
        suggestionChips(groupName, list.map((ex) => ex.name), create),
        h('div', { class: 'add-inline' }, input, h('button', { class: 'btn primary', onClick: () => create(input.value) }, 'Add'))
      );
    }

    const sheet = openSheet({ title: 'Add exercise', body });
    paint();
  }

  // ---------- Workout-level actions ----------

  const patchWorkout = act(async (patch) => api.patch(`/api/workouts/${id}`, patch));

  const endWorkout = act(async () => api.post(`/api/workouts/${id}/end`));

  // Local <-> input[type=datetime-local] conversion. datetime-local has no
  // timezone of its own — it's read and written in the browser's local time,
  // which is exactly what someone correcting "I actually started at 6pm" wants.
  const toLocalInput = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const fromLocalInput = (value) => (value ? new Date(value).toISOString() : null);

  function editTimesSheet() {
    const { workout } = data;
    const startInput = h('input', {
      type: 'datetime-local',
      value: toLocalInput(workout.started_at),
      'aria-label': 'Workout start time',
    });
    const endInput = h('input', {
      type: 'datetime-local',
      value: toLocalInput(workout.ended_at),
      'aria-label': 'Workout end time',
    });
    // Not routed through patchWorkout()/act(): a validation error (e.g. end
    // before start) should re-prompt in this same sheet, not swallow the
    // error and close it like the generic action wrapper would.
    const save = async () => {
      try {
        data = await api.patch(`/api/workouts/${id}`, {
          started_at: fromLocalInput(startInput.value),
          ended_at: fromLocalInput(endInput.value),
        });
        sheet.close();
        render();
      } catch (err) {
        toast(err.message || 'Could not save those times', { error: true });
      }
    };
    const sheet = openSheet({
      title: 'Edit workout times',
      body: h(
        'div',
        { class: 'stack' },
        h('label', { class: 'field-label' }, 'Started'),
        startInput,
        h('label', { class: 'field-label' }, 'Ended'),
        endInput,
        h('p', { class: 'muted small' }, 'Leave "Ended" empty if the workout is still in progress.'),
        h('button', { class: 'btn primary block', onClick: save }, 'Save')
      ),
    });
  }

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
      { label: 'Edit times', hint: 'Fix a forgotten start or end', icon: 'timer', onSelect: editTimesSheet },
      { label: 'Archive workout', hint: 'Hidden from history, never deleted', danger: true, icon: 'x', onSelect: archiveWorkout },
    ]);
  }

  // ---------- Timer ----------

  function timerBar() {
    const { workout } = data;
    clearTimer(); // this render pass decides fresh whether a live tick is needed
    if (workout.archived) return null;

    if (!workout.started_at) {
      return h(
        'div',
        { class: 'card row timer-bar', style: { marginBottom: '12px' } },
        icon('timer', 18),
        h('span', { class: 'grow' }, 'No start time recorded for this workout.'),
        h('button', { class: 'btn small', onClick: editTimesSheet }, 'Set times')
      );
    }

    if (workout.ended_at) {
      const minutes = (Date.parse(workout.ended_at) - Date.parse(workout.started_at)) / 60000;
      return h(
        'div',
        { class: 'card row timer-bar', style: { marginBottom: '12px' } },
        icon('timer', 18),
        h('span', { class: 'grow' }, `Workout time: ${fmtDuration(minutes)}`),
        h('button', { class: 'btn small ghost', onClick: editTimesSheet }, 'Edit times')
      );
    }

    // Still in progress: a live ticking clock plus the button to stop it.
    const elapsed = () => (Date.now() - Date.parse(workout.started_at)) / 1000;
    const clockEl = h('span', { class: 'timer-clock' }, fmtClock(elapsed()));
    timerInterval = setInterval(() => {
      if (!document.body.contains(clockEl)) {
        clearTimer();
        return;
      }
      clockEl.textContent = fmtClock(elapsed());
    }, 1000);

    return h(
      'div',
      { class: 'card row timer-bar live', style: { marginBottom: '12px' } },
      icon('timer', 18),
      h('span', { class: 'grow' }, 'Workout in progress — ', clockEl),
      h('button', { class: 'btn small primary', onClick: endWorkout }, icon('stop', 16), 'End workout')
    );
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

  function offlineBanner() {
    const pending = pendingCount();
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    if (!offline && !pending) return null;
    return h(
      'div',
      { class: 'card row', style: { marginBottom: '12px', borderLeft: '4px solid var(--flat)' } },
      h(
        'span',
        { class: 'grow' },
        offline
          ? "You're offline — sets are saved on this device and will sync automatically once you're back."
          : `Syncing ${pluralize(pending, 'change')}…`
      )
    );
  }

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
        offlineBanner(),
        timerBar(),
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
  return () => {
    clearTimer();
    unsubscribeQueue();
  };
}
