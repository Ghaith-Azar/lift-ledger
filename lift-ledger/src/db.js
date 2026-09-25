import { createClient } from '@libsql/client';

// Turso in production (libsql://...), a local SQLite file in development.
const url = process.env.TURSO_DATABASE_URL || 'file:local.db';
const authToken = process.env.TURSO_AUTH_TOKEN || undefined;

export const db = createClient({ url, authToken });
export const usingTurso = !url.startsWith('file:');

export async function all(sql, args = []) {
  const res = await db.execute({ sql, args });
  return res.rows.map((r) => ({ ...r }));
}

export async function get(sql, args = []) {
  const rows = await all(sql, args);
  return rows[0] ?? null;
}

export async function run(sql, args = []) {
  const res = await db.execute({ sql, args });
  return {
    id: res.lastInsertRowid != null ? Number(res.lastInsertRowid) : null,
    changes: res.rowsAffected,
  };
}

export function batch(statements) {
  return db.batch(statements, 'write');
}

const SAFE_IDENT = /^[a-z_]+$/;

/**
 * Update a row and write the old/new values to edit_log in one transaction.
 * Nothing is overwritten without leaving a trace.
 */
export async function updateRow(table, id, patch) {
  if (!SAFE_IDENT.test(table)) throw new Error('bad table');
  const old = await get(`SELECT * FROM ${table} WHERE id = ?`, [id]);
  if (!old) return null;

  const changed = {};
  const previous = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!SAFE_IDENT.test(key)) throw new Error('bad column');
    if (value !== undefined && old[key] !== value) {
      changed[key] = value;
      previous[key] = old[key];
    }
  }
  const cols = Object.keys(changed);
  if (!cols.length) return old;

  const touch = 'updated_at' in old ? ", updated_at = datetime('now')" : '';
  await batch([
    {
      sql: `UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(', ')}${touch} WHERE id = ?`,
      args: [...cols.map((c) => changed[c]), id],
    },
    {
      sql: 'INSERT INTO edit_log (table_name, row_id, old_values, new_values) VALUES (?, ?, ?, ?)',
      args: [table, id, JSON.stringify(previous), JSON.stringify(changed)],
    },
  ]);
  return get(`SELECT * FROM ${table} WHERE id = ?`, [id]);
}

const TABLES = [
  `CREATE TABLE IF NOT EXISTS muscle_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS exercises (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    muscle_group_id INTEGER NOT NULL REFERENCES muscle_groups(id),
    name TEXT NOT NULL COLLATE NOCASE,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (muscle_group_id, name)
  )`,
  `CREATE TABLE IF NOT EXISTS split_days (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS split_day_muscle_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    split_day_id INTEGER NOT NULL REFERENCES split_days(id),
    muscle_group_id INTEGER NOT NULL REFERENCES muscle_groups(id),
    active INTEGER NOT NULL DEFAULT 1,
    UNIQUE (split_day_id, muscle_group_id)
  )`,
  `CREATE TABLE IF NOT EXISTS workouts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    split_day_id INTEGER REFERENCES split_days(id),
    title TEXT,
    date TEXT NOT NULL,
    notes TEXT,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS workout_exercises (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workout_id INTEGER NOT NULL REFERENCES workouts(id),
    exercise_id INTEGER NOT NULL REFERENCES exercises(id),
    position INTEGER NOT NULL DEFAULT 0,
    superset_key INTEGER,
    notes TEXT,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (workout_id, exercise_id)
  )`,
  // A "drop set" is several rows sharing one set_number, with drop_index 0, 1, 2...
  `CREATE TABLE IF NOT EXISTS sets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workout_exercise_id INTEGER NOT NULL REFERENCES workout_exercises(id),
    set_number INTEGER NOT NULL,
    drop_index INTEGER NOT NULL DEFAULT 0,
    weight REAL,
    reps INTEGER,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS edit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    table_name TEXT NOT NULL,
    row_id INTEGER NOT NULL,
    old_values TEXT NOT NULL,
    new_values TEXT NOT NULL,
    edited_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
];

const INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_workouts_date ON workouts (date)',
  'CREATE INDEX IF NOT EXISTS idx_we_workout ON workout_exercises (workout_id)',
  'CREATE INDEX IF NOT EXISTS idx_we_exercise ON workout_exercises (exercise_id)',
  'CREATE INDEX IF NOT EXISTS idx_sets_we ON sets (workout_exercise_id)',
  'CREATE INDEX IF NOT EXISTS idx_exercises_group ON exercises (muscle_group_id)',
];

const PROTECTED_TABLES = [
  'muscle_groups',
  'exercises',
  'split_days',
  'split_day_muscle_groups',
  'workouts',
  'workout_exercises',
  'sets',
  'edit_log',
];

export async function migrate() {
  await batch(TABLES);
  await batch(INDEXES);

  // Belt and braces: the database itself refuses DELETE on every table.
  for (const table of PROTECTED_TABLES) {
    try {
      await db.execute(
        `CREATE TRIGGER IF NOT EXISTS no_delete_${table} BEFORE DELETE ON ${table}
         BEGIN SELECT RAISE(ABORT, 'Deleting is disabled. Archive instead.'); END`
      );
    } catch (err) {
      console.warn(`Could not create no-delete trigger on ${table}:`, err.message);
    }
  }
}
