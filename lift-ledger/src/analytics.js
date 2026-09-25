import { all } from './db.js';

const DAY = 86400000;
const WEEK = 7 * DAY;

// ---------- Date helpers (weeks start on Monday) ----------

const toDate = (s) => new Date(`${s}T00:00:00Z`);
const toStr = (d) => d.toISOString().slice(0, 10);

export function weekStart(dateStr) {
  const d = toDate(dateStr);
  const sinceMonday = (d.getUTCDay() + 6) % 7;
  return toStr(new Date(d.getTime() - sinceMonday * DAY));
}
const addWeeks = (s, n) => toStr(new Date(toDate(s).getTime() + n * WEEK));
const weeksBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / WEEK);

function weekRange(from, to) {
  const out = [];
  for (let w = from; w <= to; w = addWeeks(w, 1)) out.push(w);
  return out;
}

const round = (n, digits = 1) => {
  if (n == null || Number.isNaN(n)) return null;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

// Epley formula. A single rep is the weight itself.
const estimate1RM = (weight, reps) => (weight > 0 ? (reps === 1 ? weight : weight * (1 + reps / 30)) : 0);

// ---------- Data ----------

/** Every logged set that counts: not removed, not in a removed exercise/workout, has reps. */
async function loadRows() {
  return all(
    `SELECT e.id AS exercise_id, e.name AS exercise_name,
            mg.id AS muscle_group_id, mg.name AS muscle_group_name,
            w.id AS workout_id, w.date,
            s.set_number, s.drop_index, COALESCE(s.weight, 0) AS weight, s.reps
       FROM sets s
       JOIN workout_exercises we ON we.id = s.workout_exercise_id
       JOIN workouts w ON w.id = we.workout_id
       JOIN exercises e ON e.id = we.exercise_id
       JOIN muscle_groups mg ON mg.id = e.muscle_group_id
      WHERE s.archived = 0 AND we.archived = 0 AND w.archived = 0
        AND s.reps IS NOT NULL AND s.reps > 0
      ORDER BY w.date, w.id, s.set_number, s.drop_index`
  );
}

function groupBy(rows, keyFn) {
  const map = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  }
  return map;
}

// ---------- Per exercise ----------

function weeklyStats(rows) {
  const weeks = new Map();
  for (const r of rows) {
    const wk = weekStart(r.date);
    let a = weeks.get(wk);
    if (!a) {
      a = {
        week: wk,
        workouts: new Set(),
        working_sets: 0,
        working_reps: 0,
        volume: 0,
        top_weight: 0,
        reps_at_top: 0,
        best_e1rm: 0,
        best_reps: 0,
      };
      weeks.set(wk, a);
    }
    a.workouts.add(r.workout_id);
    a.volume += r.weight * r.reps;
    if (r.drop_index === 0) {
      a.working_sets += 1;
      a.working_reps += r.reps;
    }
    a.best_reps = Math.max(a.best_reps, r.reps);
    a.best_e1rm = Math.max(a.best_e1rm, estimate1RM(r.weight, r.reps));
    if (r.weight > a.top_weight) {
      a.top_weight = r.weight;
      a.reps_at_top = r.reps;
    } else if (r.weight === a.top_weight && r.reps > a.reps_at_top) {
      a.reps_at_top = r.reps;
    }
  }
  for (const a of weeks.values()) {
    a.sessions = a.workouts.size;
    a.avg_reps = a.working_sets ? a.working_reps / a.working_sets : null;
    delete a.workouts;
  }
  return weeks;
}

/** Straight-line trend over the last six weeks that have data. */
function trend(weeklyList, key, currentWeek) {
  if (!weeklyList.length) return { status: 'none', slope_pct: null };
  const last = weeklyList[weeklyList.length - 1];
  if (weeksBetween(last.week, currentWeek) > 4) return { status: 'inactive', slope_pct: null };

  const pts = weeklyList.slice(-6);
  const span = weeksBetween(pts[0].week, pts[pts.length - 1].week);
  if (pts.length < 3 || span < 2) return { status: 'building', slope_pct: null };

  const xs = pts.map((p) => weeksBetween(pts[0].week, p.week));
  const ys = pts.map((p) => p[key]);
  const n = pts.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  const den = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  if (!den || !my) return { status: 'building', slope_pct: null };
  const slope = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / den;
  const pct = (slope / my) * 100;

  let status = 'plateau';
  if (pct >= 0.4) status = 'progressing';
  else if (pct <= -0.4) status = 'regressing';
  return { status, slope_pct: round(pct, 2) };
}

const pctChange = (from, to) => (from > 0 && to != null ? round(((to - from) / from) * 100, 1) : null);

function analyseExercise(rows, currentWeek) {
  const weeklyMap = weeklyStats(rows);
  const weeklyList = [...weeklyMap.values()].sort((a, b) => (a.week < b.week ? -1 : 1));
  const first = weeklyList[0];
  const latest = weeklyList[weeklyList.length - 1];
  const hasWeight = rows.some((r) => r.weight > 0);
  const primary = hasWeight ? 'best_e1rm' : 'best_reps';
  return { weeklyMap, weeklyList, first, latest, hasWeight, primary, trend: trend(weeklyList, primary, currentWeek) };
}

function contiguousWeeks(weeklyList, currentWeek) {
  const firstWeek = weeklyList[0].week;
  const lastWeek = weeklyList[weeklyList.length - 1].week;
  return weekRange(firstWeek, lastWeek > currentWeek ? lastWeek : currentWeek);
}

export async function exerciseDetail(exerciseId, today) {
  const rows = (await loadRows()).filter((r) => r.exercise_id === exerciseId);
  if (!rows.length) return { has_data: false };

  const currentWeek = weekStart(today);
  const a = analyseExercise(rows, currentWeek);
  const weeks = contiguousWeeks(a.weeklyList, currentWeek);
  const series = (key, digits = 1) =>
    weeks.map((w) => {
      const stat = a.weeklyMap.get(w);
      return stat && stat[key] != null ? round(stat[key], digits) : null;
    });

  // Records
  let heaviest = null;
  let bestE1rm = null;
  for (const r of rows) {
    if (!heaviest || r.weight > heaviest.weight || (r.weight === heaviest.weight && r.reps > heaviest.reps)) {
      heaviest = { weight: r.weight, reps: r.reps, date: r.date };
    }
    const est = estimate1RM(r.weight, r.reps);
    if (est > 0 && (!bestE1rm || est > bestE1rm.value)) {
      bestE1rm = { value: round(est), weight: r.weight, reps: r.reps, date: r.date };
    }
  }

  // Recent sessions, newest first
  const sessions = [...groupBy(rows, (r) => r.workout_id).values()]
    .map((list) => {
      const top = Math.max(...list.map((r) => r.weight));
      return {
        workout_id: list[0].workout_id,
        date: list[0].date,
        top_weight: top,
        volume: round(list.reduce((sum, r) => sum + r.weight * r.reps, 0), 0),
        sets: list.map((r) => ({
          set_number: r.set_number,
          drop_index: r.drop_index,
          weight: r.weight,
          reps: r.reps,
        })),
      };
    })
    .sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : y.workout_id - x.workout_id))
    .slice(0, 20);

  return {
    has_data: true,
    exercise: {
      id: exerciseId,
      name: rows[0].exercise_name,
      muscle_group_id: rows[0].muscle_group_id,
      muscle_group_name: rows[0].muscle_group_name,
    },
    primary_metric: a.hasWeight ? 'e1rm' : 'reps',
    weeks,
    series: {
      top_weight: series('top_weight'),
      reps_at_top: series('reps_at_top', 0),
      avg_reps: series('avg_reps'),
      best_reps: series('best_reps', 0),
      best_e1rm: series('best_e1rm'),
      volume: series('volume', 0),
      working_sets: series('working_sets', 0),
    },
    summary: {
      sessions: new Set(rows.map((r) => r.workout_id)).size,
      first_week: a.first.week,
      latest_week: a.latest.week,
      trend: a.trend,
      change: {
        top_weight: pctChange(a.first.top_weight, a.latest.top_weight),
        avg_reps: pctChange(a.first.avg_reps, a.latest.avg_reps),
        best_e1rm: pctChange(a.first.best_e1rm, a.latest.best_e1rm),
        volume: pctChange(a.first.volume, a.latest.volume),
        best_reps: pctChange(a.first.best_reps, a.latest.best_reps),
      },
      first: {
        top_weight: round(a.first.top_weight),
        avg_reps: round(a.first.avg_reps),
        best_e1rm: round(a.first.best_e1rm),
      },
      latest: {
        top_weight: round(a.latest.top_weight),
        avg_reps: round(a.latest.avg_reps),
        best_e1rm: round(a.latest.best_e1rm),
      },
    },
    records: { heaviest, best_e1rm: bestE1rm },
    sessions,
  };
}

// ---------- Overview ----------

export async function overview(today) {
  const rows = await loadRows();
  const currentWeek = weekStart(today);
  if (!rows.length) return { has_data: false, current_week: currentWeek };

  // Lifts
  const lifts = [];
  for (const list of groupBy(rows, (r) => r.exercise_id).values()) {
    const a = analyseExercise(list, currentWeek);
    const weeks = weekRange(addWeeks(currentWeek, -7), currentWeek);
    lifts.push({
      id: list[0].exercise_id,
      name: list[0].exercise_name,
      muscle_group_id: list[0].muscle_group_id,
      muscle_group_name: list[0].muscle_group_name,
      sessions: new Set(list.map((r) => r.workout_id)).size,
      last_date: list[list.length - 1].date,
      primary_metric: a.hasWeight ? 'e1rm' : 'reps',
      latest: round(a.latest[a.primary]),
      change_pct: a.first === a.latest ? null : pctChange(a.first[a.primary], a.latest[a.primary]),
      status: a.trend.status,
      slope_pct: a.trend.slope_pct,
      spark: weeks.map((w) => {
        const s = a.weeklyMap.get(w);
        return s ? round(s[a.primary]) : null;
      }),
    });
  }
  lifts.sort((x, y) => (x.last_date < y.last_date ? 1 : x.last_date > y.last_date ? -1 : 0));

  // Weekly workouts and muscle group load
  const firstWeek = weekStart(rows[0].date);
  const lastWeek = weekStart(rows[rows.length - 1].date);
  const weeks = weekRange(firstWeek, lastWeek > currentWeek ? lastWeek : currentWeek);
  const index = new Map(weeks.map((w, i) => [w, i]));

  const workoutsPerWeek = weeks.map(() => new Set());
  const groups = new Map();
  for (const r of rows) {
    const i = index.get(weekStart(r.date));
    workoutsPerWeek[i].add(r.workout_id);
    let g = groups.get(r.muscle_group_id);
    if (!g) {
      g = {
        id: r.muscle_group_id,
        name: r.muscle_group_name,
        sets: weeks.map(() => 0),
        volume: weeks.map(() => 0),
      };
      groups.set(r.muscle_group_id, g);
    }
    if (r.drop_index === 0) g.sets[i] += 1;
    g.volume[i] += r.weight * r.reps;
  }
  const groupList = [...groups.values()]
    .map((g) => ({ ...g, volume: g.volume.map((v) => Math.round(v)) }))
    .sort((x, y) => y.sets.reduce((a, b) => a + b, 0) - x.sets.reduce((a, b) => a + b, 0));

  const thisIdx = index.get(currentWeek);
  const lastIdx = thisIdx != null ? thisIdx - 1 : null;
  const totalFor = (i) => {
    if (i == null || i < 0) return { workouts: 0, sets: 0, volume: 0 };
    return {
      workouts: workoutsPerWeek[i].size,
      sets: groupList.reduce((a, g) => a + g.sets[i], 0),
      volume: groupList.reduce((a, g) => a + g.volume[i], 0),
    };
  };

  return {
    has_data: true,
    current_week: currentWeek,
    weeks,
    workouts_per_week: workoutsPerWeek.map((s) => s.size),
    muscle_groups: groupList,
    this_week: totalFor(thisIdx),
    last_week: totalFor(lastIdx),
    total_workouts: new Set(rows.map((r) => r.workout_id)).size,
    lifts,
  };
}
