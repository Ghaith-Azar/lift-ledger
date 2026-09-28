import { Router } from 'express';
import { all, get, run, updateRow } from '../db.js';
import { bad, notFound, reqInt, reqDate, optNumber, optText, optBool } from '../validate.js';

export const bodyweightRouter = Router();

const COLUMNS = 'id, date, weight, notes, archived';
const WEIGHT_RANGE = { min: 0.1, max: 700 };

bodyweightRouter.get('/bodyweight', async (req, res) => {
  const archived = req.query.archived === '1' ? 1 : 0;
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 200);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const rows = await all(
    `SELECT ${COLUMNS} FROM bodyweight_logs
      WHERE archived = ? ORDER BY date DESC, id DESC LIMIT ? OFFSET ?`,
    [archived, limit + 1, offset]
  );
  res.json({ entries: rows.slice(0, limit), has_more: rows.length > limit });
});

bodyweightRouter.post('/bodyweight', async (req, res) => {
  const date = reqDate(req.body?.date);
  const weight = optNumber(req.body?.weight, 'weight', WEIGHT_RANGE);
  if (weight == null) throw bad('Weight is required');
  const notes = optText(req.body?.notes, 300) ?? null;
  const { id } = await run('INSERT INTO bodyweight_logs (date, weight, notes) VALUES (?, ?, ?)', [
    date,
    weight,
    notes,
  ]);
  res.status(201).json(await get(`SELECT ${COLUMNS} FROM bodyweight_logs WHERE id = ?`, [id]));
});

bodyweightRouter.patch('/bodyweight/:id', async (req, res) => {
  const id = reqInt(req.params.id);
  const weight = optNumber(req.body?.weight, 'weight', WEIGHT_RANGE);
  if (weight === null) throw bad('Weight cannot be empty');
  const row = await updateRow('bodyweight_logs', id, {
    date: req.body?.date === undefined ? undefined : reqDate(req.body.date),
    weight,
    notes: optText(req.body?.notes, 300),
    archived: optBool(req.body?.archived),
  });
  if (!row) throw notFound('Weigh-in not found');
  res.json({
    id: row.id,
    date: row.date,
    weight: row.weight,
    notes: row.notes,
    archived: row.archived,
  });
});
