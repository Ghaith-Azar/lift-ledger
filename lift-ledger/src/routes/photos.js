import { Router } from 'express';
import { all, get, run, updateRow } from '../db.js';
import {
  bad,
  notFound,
  reqInt,
  reqDate,
  optText,
  optBool,
  reqCategory,
  reqImageData,
  PHOTO_CATEGORIES,
} from '../validate.js';
import { comparePhotos, aiConfigured } from '../photoAI.js';

export const photosRouter = Router();

// Metadata only — the image bytes are fetched separately via /photos/:id/image
// so list payloads stay small and the browser can cache each image on its own.
const META_COLUMNS = 'id, date, category, content_type, byte_size, notes, archived, created_at';

photosRouter.get('/photos', async (req, res) => {
  const archived = req.query.archived === '1' ? 1 : 0;
  const category = req.query.category;
  if (category !== undefined && !PHOTO_CATEGORIES.includes(category)) {
    throw bad('category must be "upper" or "lower"');
  }
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 60, 1), 200);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

  let where = 'archived = ?';
  const args = [archived];
  if (category) {
    where += ' AND category = ?';
    args.push(category);
  }
  const rows = await all(
    `SELECT ${META_COLUMNS} FROM progress_photos WHERE ${where} ORDER BY date DESC, id DESC LIMIT ? OFFSET ?`,
    [...args, limit + 1, offset]
  );
  res.json({ photos: rows.slice(0, limit), has_more: rows.length > limit });
});

photosRouter.get('/photos/:id/image', async (req, res) => {
  const id = reqInt(req.params.id);
  const row = await get('SELECT content_type, data FROM progress_photos WHERE id = ?', [id]);
  if (!row) throw notFound('Photo not found');
  res.setHeader('Content-Type', row.content_type);
  // A photo's bytes never change after upload (a "replacement" is a new row,
  // the old one archived) — safe for the browser to cache indefinitely.
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.send(Buffer.from(row.data));
});

photosRouter.post('/photos', async (req, res) => {
  const date = reqDate(req.body?.date);
  const category = reqCategory(req.body?.category);
  const notes = optText(req.body?.notes, 300) ?? null;
  const { contentType, buffer } = reqImageData(req.body);

  const { id } = await run(
    'INSERT INTO progress_photos (date, category, content_type, data, byte_size, notes) VALUES (?, ?, ?, ?, ?, ?)',
    [date, category, contentType, buffer, buffer.length, notes]
  );
  res.status(201).json(await get(`SELECT ${META_COLUMNS} FROM progress_photos WHERE id = ?`, [id]));
});

photosRouter.patch('/photos/:id', async (req, res) => {
  const id = reqInt(req.params.id);
  const row = await updateRow('progress_photos', id, {
    date: req.body?.date === undefined ? undefined : reqDate(req.body.date),
    notes: optText(req.body?.notes, 300),
    archived: optBool(req.body?.archived),
  });
  if (!row) throw notFound('Photo not found');
  res.json({
    id: row.id,
    date: row.date,
    category: row.category,
    content_type: row.content_type,
    byte_size: row.byte_size,
    notes: row.notes,
    archived: row.archived,
    created_at: row.created_at,
  });
});

// ---------- AI comparison (optional, needs GEMINI_API_KEY) ----------

photosRouter.get('/photos/ai-status', (req, res) => {
  res.json({ configured: aiConfigured });
});

async function loadPhotoForAI(id) {
  const row = await get(
    'SELECT id, date, category, content_type, data FROM progress_photos WHERE id = ?',
    [id]
  );
  if (!row) throw bad(`Photo ${id} not found`);
  return row;
}

photosRouter.post('/photos/analyze', async (req, res) => {
  if (!aiConfigured) {
    throw bad("AI analysis isn't set up on this server yet (needs a GEMINI_API_KEY) — see the README.");
  }
  const category = reqCategory(req.body?.category);
  const fromId = req.body?.from_id != null ? reqInt(req.body.from_id, 'from_id') : null;
  const toId = req.body?.to_id != null ? reqInt(req.body.to_id, 'to_id') : null;

  let fromRow, toRow;
  if (fromId != null && toId != null) {
    [fromRow, toRow] = await Promise.all([loadPhotoForAI(fromId), loadPhotoForAI(toId)]);
    if (fromRow.category !== category || toRow.category !== category) {
      throw bad('Both photos must be in the requested category');
    }
  } else {
    // No pair given: default to the earliest vs. the most recent photo on hand.
    const [earliest, latest] = await Promise.all([
      get('SELECT id FROM progress_photos WHERE category = ? AND archived = 0 ORDER BY date ASC, id ASC LIMIT 1', [category]),
      get('SELECT id FROM progress_photos WHERE category = ? AND archived = 0 ORDER BY date DESC, id DESC LIMIT 1', [category]),
    ]);
    if (!earliest || !latest || earliest.id === latest.id) {
      throw bad('Need at least two photos in this category to compare');
    }
    [fromRow, toRow] = await Promise.all([loadPhotoForAI(earliest.id), loadPhotoForAI(latest.id)]);
  }

  // Normalize to chronological order regardless of which order the IDs came in.
  if (fromRow.date > toRow.date || (fromRow.date === toRow.date && fromRow.id > toRow.id)) {
    [fromRow, toRow] = [toRow, fromRow];
  }
  if (fromRow.id === toRow.id) throw bad('Pick two different photos to compare');

  const cached = await get(
    'SELECT verdict, summary, created_at FROM photo_analyses WHERE from_photo_id = ? AND to_photo_id = ?',
    [fromRow.id, toRow.id]
  );
  if (cached) {
    return res.json({ ...cached, from_photo_id: fromRow.id, to_photo_id: toRow.id, cached: true });
  }

  // Not cached — this is the one place a request actually costs money, so it
  // only ever runs when the person explicitly asks to compare this pair.
  const result = await comparePhotos({
    category,
    from: { date: fromRow.date, content_type: fromRow.content_type, data: Buffer.from(fromRow.data) },
    to: { date: toRow.date, content_type: toRow.content_type, data: Buffer.from(toRow.data) },
  });

  await run(
    `INSERT INTO photo_analyses (category, from_photo_id, to_photo_id, verdict, summary) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (from_photo_id, to_photo_id) DO UPDATE SET
       verdict = excluded.verdict, summary = excluded.summary, created_at = datetime('now')`,
    [category, fromRow.id, toRow.id, result.verdict, result.summary]
  );
  res.json({ ...result, from_photo_id: fromRow.id, to_photo_id: toRow.id, cached: false });
});

photosRouter.get('/photos/analyses', async (req, res) => {
  const category = req.query.category;
  if (category !== undefined && !PHOTO_CATEGORIES.includes(category)) {
    throw bad('category must be "upper" or "lower"');
  }
  const where = category ? 'WHERE category = ?' : '';
  const args = category ? [category] : [];
  const rows = await all(
    `SELECT id, category, from_photo_id, to_photo_id, verdict, summary, created_at
       FROM photo_analyses ${where} ORDER BY created_at DESC LIMIT 50`,
    args
  );
  res.json({ analyses: rows });
});
