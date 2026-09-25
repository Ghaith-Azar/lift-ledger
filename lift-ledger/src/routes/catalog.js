import { Router } from 'express';
import { all, get, run, batch, updateRow } from '../db.js';
import {
  HttpError,
  bad,
  notFound,
  reqInt,
  reqName,
  optName,
  optBool,
  optInt,
} from '../validate.js';

export const catalogRouter = Router();

async function loadCatalog() {
  const [muscleGroups, exercises, splitDays, links] = await Promise.all([
    all('SELECT id, name, archived FROM muscle_groups ORDER BY id'),
    all('SELECT id, name, muscle_group_id, archived FROM exercises ORDER BY name'),
    all('SELECT id, name, position, archived FROM split_days ORDER BY position, id'),
    all(
      'SELECT split_day_id, muscle_group_id FROM split_day_muscle_groups WHERE active = 1 ORDER BY id'
    ),
  ]);
  for (const day of splitDays) {
    day.muscle_group_ids = links
      .filter((l) => l.split_day_id === day.id)
      .map((l) => l.muscle_group_id);
  }
  return { muscle_groups: muscleGroups, exercises, split_days: splitDays };
}

async function dayWithGroups(id) {
  const day = await get('SELECT id, name, position, archived FROM split_days WHERE id = ?', [id]);
  if (!day) throw notFound('Split day not found');
  const links = await all(
    'SELECT muscle_group_id FROM split_day_muscle_groups WHERE split_day_id = ? AND active = 1 ORDER BY id',
    [id]
  );
  day.muscle_group_ids = links.map((l) => l.muscle_group_id);
  return day;
}

async function assertGroupsExist(ids) {
  if (!ids.length) return;
  const found = await all(
    `SELECT id FROM muscle_groups WHERE id IN (${ids.map(() => '?').join(',')})`,
    ids
  );
  if (found.length !== new Set(ids).size) throw bad('One of the muscle groups does not exist');
}

async function setDayGroups(dayId, ids) {
  const unique = [...new Set(ids)];
  await assertGroupsExist(unique);
  const before = (
    await all(
      'SELECT muscle_group_id FROM split_day_muscle_groups WHERE split_day_id = ? AND active = 1',
      [dayId]
    )
  ).map((r) => r.muscle_group_id);

  const statements = [];
  if (unique.length) {
    statements.push({
      sql: `UPDATE split_day_muscle_groups SET active = 0
            WHERE split_day_id = ? AND muscle_group_id NOT IN (${unique.map(() => '?').join(',')})`,
      args: [dayId, ...unique],
    });
  } else {
    statements.push({
      sql: 'UPDATE split_day_muscle_groups SET active = 0 WHERE split_day_id = ?',
      args: [dayId],
    });
  }
  for (const id of unique) {
    statements.push({
      sql: `INSERT INTO split_day_muscle_groups (split_day_id, muscle_group_id, active) VALUES (?, ?, 1)
            ON CONFLICT (split_day_id, muscle_group_id) DO UPDATE SET active = 1`,
      args: [dayId, id],
    });
  }
  if (before.slice().sort().join() !== unique.slice().sort().join()) {
    statements.push({
      sql: 'INSERT INTO edit_log (table_name, row_id, old_values, new_values) VALUES (?, ?, ?, ?)',
      args: [
        'split_day_muscle_groups',
        dayId,
        JSON.stringify({ muscle_group_ids: before }),
        JSON.stringify({ muscle_group_ids: unique }),
      ],
    });
  }
  await batch(statements);
}

catalogRouter.get('/catalog', async (req, res) => {
  res.json(await loadCatalog());
});

// ---------- Muscle groups ----------

catalogRouter.post('/muscle-groups', async (req, res) => {
  const name = reqName(req.body?.name, 'Muscle group name');
  const existing = await get('SELECT * FROM muscle_groups WHERE name = ?', [name]);
  if (existing) {
    if (!existing.archived) throw new HttpError(409, `"${existing.name}" already exists`);
    return res.json(await updateRow('muscle_groups', existing.id, { archived: 0 }));
  }
  const { id } = await run('INSERT INTO muscle_groups (name) VALUES (?)', [name]);
  res.status(201).json(await get('SELECT id, name, archived FROM muscle_groups WHERE id = ?', [id]));
});

catalogRouter.patch('/muscle-groups/:id', async (req, res) => {
  const id = reqInt(req.params.id);
  const row = await updateRow('muscle_groups', id, {
    name: optName(req.body?.name, 'Muscle group name'),
    archived: optBool(req.body?.archived),
  });
  if (!row) throw notFound('Muscle group not found');
  res.json(row);
});

// ---------- Exercises ----------

catalogRouter.post('/exercises', async (req, res) => {
  const name = reqName(req.body?.name, 'Exercise name');
  const groupId = reqInt(req.body?.muscle_group_id, 'muscle_group_id');
  const group = await get('SELECT id FROM muscle_groups WHERE id = ?', [groupId]);
  if (!group) throw bad('That muscle group does not exist');

  const existing = await get('SELECT * FROM exercises WHERE muscle_group_id = ? AND name = ?', [
    groupId,
    name,
  ]);
  if (existing) {
    if (!existing.archived) throw new HttpError(409, `"${existing.name}" already exists here`);
    return res.json(await updateRow('exercises', existing.id, { archived: 0 }));
  }
  const { id } = await run('INSERT INTO exercises (muscle_group_id, name) VALUES (?, ?)', [
    groupId,
    name,
  ]);
  res
    .status(201)
    .json(await get('SELECT id, name, muscle_group_id, archived FROM exercises WHERE id = ?', [id]));
});

catalogRouter.patch('/exercises/:id', async (req, res) => {
  const id = reqInt(req.params.id);
  const patch = {
    name: optName(req.body?.name, 'Exercise name'),
    archived: optBool(req.body?.archived),
  };
  if (req.body?.muscle_group_id !== undefined) {
    patch.muscle_group_id = reqInt(req.body.muscle_group_id, 'muscle_group_id');
    const group = await get('SELECT id FROM muscle_groups WHERE id = ?', [patch.muscle_group_id]);
    if (!group) throw bad('That muscle group does not exist');
  }
  const row = await updateRow('exercises', id, patch);
  if (!row) throw notFound('Exercise not found');
  res.json(row);
});

// ---------- Split days ----------

catalogRouter.post('/split-days', async (req, res) => {
  const name = reqName(req.body?.name, 'Day name');
  const ids = Array.isArray(req.body?.muscle_group_ids)
    ? req.body.muscle_group_ids.map((v) => reqInt(v, 'muscle group id'))
    : [];
  await assertGroupsExist(ids);
  const last = await get('SELECT COALESCE(MAX(position), 0) AS p FROM split_days');
  const { id } = await run('INSERT INTO split_days (name, position) VALUES (?, ?)', [
    name,
    last.p + 1,
  ]);
  await setDayGroups(id, ids);
  res.status(201).json(await dayWithGroups(id));
});

catalogRouter.patch('/split-days/:id', async (req, res) => {
  const id = reqInt(req.params.id);
  const patch = {
    name: optName(req.body?.name, 'Day name'),
    position: optInt(req.body?.position, 'position', { min: 0, max: 10000 }),
    archived: optBool(req.body?.archived),
  };
  const row = await updateRow('split_days', id, patch);
  if (!row) throw notFound('Split day not found');
  if (Array.isArray(req.body?.muscle_group_ids)) {
    await setDayGroups(
      id,
      req.body.muscle_group_ids.map((v) => reqInt(v, 'muscle group id'))
    );
  }
  res.json(await dayWithGroups(id));
});
