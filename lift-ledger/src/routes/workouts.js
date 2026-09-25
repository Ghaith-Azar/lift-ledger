import { Router } from 'express';
import { all, get, run, batch, updateRow } from '../db.js';
import {
  bad,
  notFound,
  reqInt,
  reqDate,
  optBool,
  optInt,
  optNumber,
  optText,
} from '../validate.js';

export const workoutsRouter = Router();

// ---------- Loading ----------

async function previousSession(exerciseId, workout) {
  const prev = await get(
    `SELECT we.id AS we_id, w.id AS workout_id, w.date
       FROM workout_exercises we
       JOIN workouts w ON w.id = we.workout_id
      WHERE we.exercise_id = ? AND we.archived = 0 AND w.archived = 0 AND w.id != ?
        AND (w.date < ? OR (w.date = ? AND w.id < ?))
        AND EXISTS (SELECT 1 FROM sets s
                     WHERE s.workout_exercise_id = we.id AND s.archived = 0 AND s.reps IS NOT NULL)
      ORDER BY w.date DESC, w.id DESC
      LIMIT 1`,
    [exerciseId, workout.id, workout.date, workout.date, workout.id]
  );
  if (!prev) return null;

  const rows = await all(
    `SELECT set_number, drop_index, weight, reps FROM sets
      WHERE workout_exercise_id = ? AND archived = 0
      ORDER BY set_number, drop_index, id`,
    [prev.we_id]
  );
  // Number sets 1, 2, 3... so they line up with the rows on screen.
  const ordinal = new Map();
  for (const r of rows) {
    if (!ordinal.has(r.set_number)) ordinal.set(r.set_number, ordinal.size + 1);
    r.n = ordinal.get(r.set_number);
  }
  return {
    workout_id: prev.workout_id,
    date: prev.date,
    sets: rows
      .filter((r) => r.reps != null)
      .map((r) => ({ n: r.n, drop_index: r.drop_index, weight: r.weight, reps: r.reps })),
  };
}

async function loadWorkout(id) {
  const workout = await get(
    `SELECT w.id, w.split_day_id, w.title, w.date, w.notes, w.archived, sd.name AS split_day_name
       FROM workouts w LEFT JOIN split_days sd ON sd.id = w.split_day_id
      WHERE w.id = ?`,
    [id]
  );
  if (!workout) throw notFound('Workout not found');

  const exercises = await all(
    `SELECT we.id, we.exercise_id, we.position, we.superset_key, we.notes, we.archived,
            e.name AS exercise_name, e.muscle_group_id, mg.name AS muscle_group_name
       FROM workout_exercises we
       JOIN exercises e ON e.id = we.exercise_id
       JOIN muscle_groups mg ON mg.id = e.muscle_group_id
      WHERE we.workout_id = ?
      ORDER BY we.position, we.id`,
    [id]
  );
  const sets = await all(
    `SELECT s.id, s.workout_exercise_id, s.set_number, s.drop_index, s.weight, s.reps, s.archived
       FROM sets s JOIN workout_exercises we ON we.id = s.workout_exercise_id
      WHERE we.workout_id = ?
      ORDER BY s.set_number, s.drop_index, s.id`,
    [id]
  );
  await Promise.all(
    exercises.map(async (ex) => {
      ex.sets = sets.filter((s) => s.workout_exercise_id === ex.id);
      ex.previous = ex.archived ? null : await previousSession(ex.exercise_id, workout);
    })
  );
  return { workout, exercises };
}

async function getWorkoutExercise(id) {
  const we = await get('SELECT * FROM workout_exercises WHERE id = ?', [id]);
  if (!we) throw notFound('Exercise entry not found');
  return we;
}

// ---------- Workouts ----------

workoutsRouter.get('/workouts', async (req, res) => {
  const archived = req.query.archived === '1' ? 1 : 0;
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 100);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

  const rows = await all(
    `SELECT w.id, w.date, w.title, w.notes, w.archived, w.split_day_id,
            sd.name AS split_day_name,
            (SELECT COUNT(*) FROM workout_exercises we
              WHERE we.workout_id = w.id AND we.archived = 0) AS exercise_count,
            (SELECT COUNT(*) FROM sets s JOIN workout_exercises we ON we.id = s.workout_exercise_id
              WHERE we.workout_id = w.id AND we.archived = 0 AND s.archived = 0
                AND s.drop_index = 0 AND s.reps IS NOT NULL) AS set_count,
            (SELECT COALESCE(SUM(COALESCE(s.weight, 0) * s.reps), 0)
               FROM sets s JOIN workout_exercises we ON we.id = s.workout_exercise_id
              WHERE we.workout_id = w.id AND we.archived = 0 AND s.archived = 0
                AND s.reps IS NOT NULL) AS volume,
            (SELECT json_group_array(DISTINCT e.muscle_group_id)
               FROM workout_exercises we
               JOIN exercises e ON e.id = we.exercise_id
              WHERE we.workout_id = w.id AND we.archived = 0) AS muscle_group_ids
       FROM workouts w LEFT JOIN split_days sd ON sd.id = w.split_day_id
      WHERE w.archived = ?
      ORDER BY w.date DESC, w.id DESC
      LIMIT ? OFFSET ?`,
    [archived, limit + 1, offset]
  );
  for (const row of rows) row.muscle_group_ids = JSON.parse(row.muscle_group_ids || '[]');
  res.json({ workouts: rows.slice(0, limit), has_more: rows.length > limit });
});

workoutsRouter.get('/workouts/:id', async (req, res) => {
  res.json(await loadWorkout(reqInt(req.params.id)));
});

workoutsRouter.post('/workouts', async (req, res) => {
  const date = reqDate(req.body?.date);
  const title = optText(req.body?.title, 80) ?? null;
  let splitDayId = null;
  if (req.body?.split_day_id != null) {
    splitDayId = reqInt(req.body.split_day_id, 'split_day_id');
    const day = await get('SELECT id FROM split_days WHERE id = ?', [splitDayId]);
    if (!day) throw bad('That split day does not exist');
  }

  const { id } = await run('INSERT INTO workouts (split_day_id, title, date) VALUES (?, ?, ?)', [
    splitDayId,
    title,
    date,
  ]);

  if (req.body?.copy_last && splitDayId !== null) {
    const last = await get(
      `SELECT w.id FROM workouts w
        WHERE w.split_day_id = ? AND w.archived = 0 AND w.id != ?
          AND (w.date < ? OR (w.date = ? AND w.id < ?))
          AND EXISTS (SELECT 1 FROM workout_exercises x WHERE x.workout_id = w.id AND x.archived = 0)
        ORDER BY w.date DESC, w.id DESC LIMIT 1`,
      [splitDayId, id, date, date, id]
    );
    if (last) {
      await run(
        `INSERT INTO workout_exercises (workout_id, exercise_id, position, superset_key)
         SELECT ?, we.exercise_id, we.position, we.superset_key
           FROM workout_exercises we JOIN exercises e ON e.id = we.exercise_id
          WHERE we.workout_id = ? AND we.archived = 0 AND e.archived = 0`,
        [id, last.id]
      );
    }
  }
  res.status(201).json(await loadWorkout(id));
});

workoutsRouter.patch('/workouts/:id', async (req, res) => {
  const id = reqInt(req.params.id);
  const patch = {
    date: req.body?.date === undefined ? undefined : reqDate(req.body.date),
    title: optText(req.body?.title, 80),
    notes: optText(req.body?.notes, 4000),
    archived: optBool(req.body?.archived),
  };
  const row = await updateRow('workouts', id, patch);
  if (!row) throw notFound('Workout not found');
  res.json(await loadWorkout(id));
});

// ---------- Exercises inside a workout ----------

workoutsRouter.post('/workouts/:id/exercises', async (req, res) => {
  const workoutId = reqInt(req.params.id);
  const exerciseId = reqInt(req.body?.exercise_id, 'exercise_id');

  const workout = await get('SELECT id FROM workouts WHERE id = ?', [workoutId]);
  if (!workout) throw notFound('Workout not found');
  const exercise = await get('SELECT id, archived FROM exercises WHERE id = ?', [exerciseId]);
  if (!exercise) throw bad('That exercise does not exist');
  if (exercise.archived) throw bad('Restore this exercise in Split before using it');

  const existing = await get(
    'SELECT id, archived FROM workout_exercises WHERE workout_id = ? AND exercise_id = ?',
    [workoutId, exerciseId]
  );
  if (existing) {
    if (existing.archived) await updateRow('workout_exercises', existing.id, { archived: 0 });
  } else {
    const last = await get(
      'SELECT COALESCE(MAX(position), 0) AS p FROM workout_exercises WHERE workout_id = ?',
      [workoutId]
    );
    await run(
      'INSERT INTO workout_exercises (workout_id, exercise_id, position) VALUES (?, ?, ?)',
      [workoutId, exerciseId, last.p + 1]
    );
  }
  res.status(201).json(await loadWorkout(workoutId));
});

workoutsRouter.patch('/workout-exercises/:id', async (req, res) => {
  const id = reqInt(req.params.id);
  const we = await getWorkoutExercise(id);
  await updateRow('workout_exercises', id, {
    archived: optBool(req.body?.archived),
    notes: optText(req.body?.notes, 1000),
    position: optInt(req.body?.position, 'position', { min: 0, max: 100000 }),
  });
  res.json(await loadWorkout(we.workout_id));
});

// Link two exercises into a superset (or a giant set when there are three or more).
workoutsRouter.post('/workout-exercises/:id/link', async (req, res) => {
  const a = await getWorkoutExercise(reqInt(req.params.id));
  const b = await getWorkoutExercise(reqInt(req.body?.other_id, 'other_id'));
  if (a.id === b.id) throw bad('Pick a different exercise');
  if (a.workout_id !== b.workout_id) throw bad('Both exercises must be in the same workout');
  if (a.archived || b.archived) throw bad('Restore the exercise first');

  let key = a.superset_key ?? b.superset_key;
  if (key == null) {
    const m = await get(
      'SELECT COALESCE(MAX(superset_key), 0) AS m FROM workout_exercises WHERE workout_id = ?',
      [a.workout_id]
    );
    key = m.m + 1;
  }
  // If both already belong to different groups, merge them into one.
  const toMove = new Set([a.id, b.id]);
  for (const oldKey of [a.superset_key, b.superset_key]) {
    if (oldKey != null && oldKey !== key) {
      const members = await all(
        'SELECT id FROM workout_exercises WHERE workout_id = ? AND superset_key = ?',
        [a.workout_id, oldKey]
      );
      members.forEach((m) => toMove.add(m.id));
    }
  }
  for (const id of toMove) await updateRow('workout_exercises', id, { superset_key: key });
  res.json(await loadWorkout(a.workout_id));
});

workoutsRouter.post('/workout-exercises/:id/unlink', async (req, res) => {
  const we = await getWorkoutExercise(reqInt(req.params.id));
  const oldKey = we.superset_key;
  await updateRow('workout_exercises', we.id, { superset_key: null });
  if (oldKey != null) {
    const rest = await all(
      'SELECT id FROM workout_exercises WHERE workout_id = ? AND superset_key = ? AND archived = 0',
      [we.workout_id, oldKey]
    );
    if (rest.length === 1) await updateRow('workout_exercises', rest[0].id, { superset_key: null });
  }
  res.json(await loadWorkout(we.workout_id));
});

// ---------- Sets ----------

workoutsRouter.post('/workout-exercises/:id/sets', async (req, res) => {
  const we = await getWorkoutExercise(reqInt(req.params.id));
  if (we.archived) throw bad('Restore the exercise before adding sets');
  const weight = optNumber(req.body?.weight, 'weight', { min: 0, max: 5000 }) ?? null;
  const reps = optInt(req.body?.reps, 'reps', { min: 0, max: 1000 }) ?? null;

  if (req.body?.drop_of != null) {
    const setNumber = reqInt(req.body.drop_of, 'drop_of');
    const main = await get(
      `SELECT id FROM sets WHERE workout_exercise_id = ? AND set_number = ?
          AND drop_index = 0 AND archived = 0`,
      [we.id, setNumber]
    );
    if (!main) throw bad('That set does not exist');
    const m = await get(
      'SELECT COALESCE(MAX(drop_index), 0) AS m FROM sets WHERE workout_exercise_id = ? AND set_number = ?',
      [we.id, setNumber]
    );
    await run(
      'INSERT INTO sets (workout_exercise_id, set_number, drop_index, weight, reps) VALUES (?, ?, ?, ?, ?)',
      [we.id, setNumber, m.m + 1, weight, reps]
    );
  } else {
    const m = await get(
      'SELECT COALESCE(MAX(set_number), 0) AS m FROM sets WHERE workout_exercise_id = ?',
      [we.id]
    );
    await run(
      'INSERT INTO sets (workout_exercise_id, set_number, drop_index, weight, reps) VALUES (?, ?, 0, ?, ?)',
      [we.id, m.m + 1, weight, reps]
    );
  }
  res.status(201).json(await loadWorkout(we.workout_id));
});

// Fill an empty exercise with the same sets as last session (numbers stay editable).
workoutsRouter.post('/workout-exercises/:id/copy-previous', async (req, res) => {
  const we = await getWorkoutExercise(reqInt(req.params.id));
  if (we.archived) throw bad('Restore the exercise first');
  const existing = await get(
    'SELECT COUNT(*) AS n FROM sets WHERE workout_exercise_id = ? AND archived = 0',
    [we.id]
  );
  if (existing.n > 0) throw bad('This exercise already has sets');

  const workout = await get('SELECT id, date FROM workouts WHERE id = ?', [we.workout_id]);
  const prev = await previousSession(we.exercise_id, workout);
  if (!prev || !prev.sets.length) throw bad('There is no earlier session to copy');

  const base = (
    await get('SELECT COALESCE(MAX(set_number), 0) AS m FROM sets WHERE workout_exercise_id = ?', [we.id])
  ).m;
  await batch(
    prev.sets.map((s) => ({
      sql: 'INSERT INTO sets (workout_exercise_id, set_number, drop_index, weight, reps) VALUES (?, ?, ?, ?, ?)',
      args: [we.id, base + s.n, s.drop_index, s.weight, s.reps],
    }))
  );
  res.status(201).json(await loadWorkout(we.workout_id));
});

workoutsRouter.patch('/sets/:id', async (req, res) => {
  const id = reqInt(req.params.id);
  const old = await get(
    `SELECT s.*, we.workout_id FROM sets s
       JOIN workout_exercises we ON we.id = s.workout_exercise_id WHERE s.id = ?`,
    [id]
  );
  if (!old) throw notFound('Set not found');

  const patch = {
    weight: optNumber(req.body?.weight, 'weight', { min: 0, max: 5000 }),
    reps: optInt(req.body?.reps, 'reps', { min: 0, max: 1000 }),
    archived: optBool(req.body?.archived),
  };
  const updated = await updateRow('sets', id, patch);

  // Removing or restoring a main set carries its drops with it.
  if (patch.archived !== undefined && old.drop_index === 0) {
    const drops = await all(
      'SELECT id FROM sets WHERE workout_exercise_id = ? AND set_number = ? AND id != ?',
      [old.workout_exercise_id, old.set_number, id]
    );
    for (const d of drops) await updateRow('sets', d.id, { archived: patch.archived });
  }

  if (patch.archived !== undefined) return res.json(await loadWorkout(old.workout_id));
  res.json({ set: updated });
});
