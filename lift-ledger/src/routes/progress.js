import { Router } from 'express';
import { all } from '../db.js';
import { exerciseDetail, overview } from '../analytics.js';
import { reqInt, reqDate } from '../validate.js';

export const progressRouter = Router();

const todayFrom = (req) => (req.query.today ? reqDate(req.query.today) : new Date().toISOString().slice(0, 10));

progressRouter.get('/progress/overview', async (req, res) => {
  res.json(await overview(todayFrom(req)));
});

progressRouter.get('/progress/exercises/:id', async (req, res) => {
  res.json(await exerciseDetail(reqInt(req.params.id), todayFrom(req)));
});

// Full backup of every table, including the edit history.
progressRouter.get('/export', async (req, res) => {
  const tables = [
    'muscle_groups',
    'exercises',
    'split_days',
    'split_day_muscle_groups',
    'workouts',
    'workout_exercises',
    'sets',
    'edit_log',
  ];
  const data = { exported_at: new Date().toISOString() };
  for (const t of tables) data[t] = await all(`SELECT * FROM ${t} ORDER BY id`);
  res.setHeader('Content-Disposition', `attachment; filename="lift-ledger-${data.exported_at.slice(0, 10)}.json"`);
  res.json(data);
});
