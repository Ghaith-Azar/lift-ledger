import { all, get, run } from './db.js';
import { estimate1RM } from './analytics.js';
import { bad } from './validate.js';

// ---------- Settings (same tiny key/value pattern as push.js) ----------

const DEFAULTS = {
  progression_enabled: '1',
  // 'double' = climb the rep range first, then add weight and reset reps.
  // 'linear' = add weight as soon as every set meets the rep target.
  progression_strategy: 'double',
  progression_rep_low: '8',
  progression_rep_high: '12',
  progression_weight_increment: '2.5',
  // How many consecutive recent sessions of decline before the assistant
  // stops suggesting more and just asks you to hold where you are.
  progression_plateau_sessions: '3',
};

async function getSetting(key) {
  const row = await get('SELECT value FROM app_settings WHERE key = ?', [key]);
  return row ? row.value : DEFAULTS[key];
}

async function setSetting(key, value) {
  await run(
    `INSERT INTO app_settings (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    [key, String(value)]
  );
}

export async function getProgressionSettings() {
  const [enabled, strategy, repLow, repHigh, increment, plateau] = await Promise.all([
    getSetting('progression_enabled'),
    getSetting('progression_strategy'),
    getSetting('progression_rep_low'),
    getSetting('progression_rep_high'),
    getSetting('progression_weight_increment'),
    getSetting('progression_plateau_sessions'),
  ]);
  return {
    enabled: enabled === '1',
    strategy: strategy === 'linear' ? 'linear' : 'double',
    rep_low: Number(repLow),
    rep_high: Number(repHigh),
    weight_increment: Number(increment),
    plateau_sessions: Number(plateau),
  };
}

function clampInt(n, min, max) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return null;
  return Math.min(max, Math.max(min, v));
}

export async function saveProgressionSettings(patch) {
  if (patch.enabled !== undefined) await setSetting('progression_enabled', patch.enabled ? '1' : '0');
  if (patch.strategy !== undefined) {
    if (!['double', 'linear'].includes(patch.strategy)) {
      throw bad('strategy must be "double" or "linear"');
    }
    await setSetting('progression_strategy', patch.strategy);
  }
  if (patch.rep_low !== undefined) {
    const v = clampInt(patch.rep_low, 1, 50);
    if (v === null) throw bad('rep_low must be a number');
    await setSetting('progression_rep_low', v);
  }
  if (patch.rep_high !== undefined) {
    const v = clampInt(patch.rep_high, 1, 50);
    if (v === null) throw bad('rep_high must be a number');
    await setSetting('progression_rep_high', v);
  }
  if (patch.weight_increment !== undefined) {
    const n = Number(patch.weight_increment);
    if (!Number.isFinite(n) || n <= 0 || n > 100) {
      throw bad('weight_increment must be between 0 and 100');
    }
    await setSetting('progression_weight_increment', n);
  }
  if (patch.plateau_sessions !== undefined) {
    const v = clampInt(patch.plateau_sessions, 2, 10);
    if (v === null) throw bad('plateau_sessions must be a number');
    await setSetting('progression_plateau_sessions', v);
  }

  const settings = await getProgressionSettings();
  if (settings.rep_low > settings.rep_high) {
    // Keep the two in a sane order rather than rejecting — simplest fix that
    // can't leave the settings in a broken state.
    await setSetting('progression_rep_low', settings.rep_high);
    await setSetting('progression_rep_high', settings.rep_low);
    return getProgressionSettings();
  }
  return settings;
}

// ---------- Recent session history for one exercise ----------

/**
 * The last `limit` sessions of this exercise, most recent first, excluding
 * the current workout — main sets only (drop sets are a bonus finisher, not
 * part of the prescribed target). Mirrors previousSession() in workouts.js
 * but pulls more than one session back, for decline detection.
 */
async function recentMainSessions(exerciseId, workout, limit) {
  const workouts = await all(
    `SELECT w.id, w.date
       FROM workout_exercises we
       JOIN workouts w ON w.id = we.workout_id
      WHERE we.exercise_id = ? AND we.archived = 0 AND w.archived = 0 AND w.id != ?
        AND (w.date < ? OR (w.date = ? AND w.id < ?))
        AND EXISTS (SELECT 1 FROM sets s
                     WHERE s.workout_exercise_id = we.id AND s.archived = 0
                       AND s.drop_index = 0 AND s.reps IS NOT NULL AND s.reps > 0)
      ORDER BY w.date DESC, w.id DESC
      LIMIT ?`,
    [exerciseId, workout.id, workout.date, workout.date, workout.id, limit]
  );
  if (!workouts.length) return [];

  const ids = workouts.map((w) => w.id);
  const rows = await all(
    `SELECT we.workout_id, s.weight, s.reps
       FROM sets s
       JOIN workout_exercises we ON we.id = s.workout_exercise_id
      WHERE we.exercise_id = ? AND we.archived = 0 AND s.archived = 0
        AND s.drop_index = 0 AND s.reps IS NOT NULL AND s.reps > 0
        AND we.workout_id IN (${ids.map(() => '?').join(',')})`,
    [exerciseId, ...ids]
  );
  const byWorkout = new Map(ids.map((id) => [id, []]));
  for (const r of rows) byWorkout.get(r.workout_id)?.push({ weight: r.weight ?? 0, reps: r.reps });
  return workouts.map((w) => ({ workout_id: w.id, date: w.date, sets: byWorkout.get(w.id) || [] }));
}

/** The weight most of the main sets share (ties broken toward the higher value). */
function modeWeight(sets) {
  const counts = new Map();
  for (const s of sets) counts.set(s.weight, (counts.get(s.weight) || 0) + 1);
  let best = sets[0].weight;
  let bestCount = 0;
  for (const [w, c] of counts) {
    if (c > bestCount || (c === bestCount && w > best)) {
      best = w;
      bestCount = c;
    }
  }
  return best;
}

const round2 = (n) => Math.round(n * 100) / 100;

/** Highest estimated-strength (or, for bodyweight moves, highest reps) in one session. */
function sessionMetric(session, hasWeight) {
  return hasWeight
    ? Math.max(...session.sets.map((s) => estimate1RM(s.weight, s.reps)))
    : Math.max(...session.sets.map((s) => s.reps));
}

/**
 * Suggests a next weight/rep/set target from recent history, per the
 * configured progression rules — never applied automatically, only ever
 * offered for the person to accept, edit, or ignore (see workout.js).
 * Returns null when there's no history yet (nothing to suggest) or the
 * assistant is turned off.
 */
export async function suggestForExercise(exerciseId, workout, settings) {
  if (!settings.enabled) return null;
  const sessions = await recentMainSessions(exerciseId, workout, Math.max(settings.plateau_sessions + 1, 4));
  if (!sessions.length || !sessions[0].sets.length) return null;

  const last = sessions[0];
  const hasWeight = last.sets.some((s) => s.weight > 0);
  const setCount = last.sets.length;
  const minReps = Math.min(...last.sets.map((s) => s.reps));
  const weight = hasWeight ? modeWeight(last.sets.filter((s) => s.weight > 0)) : 0;

  // Decline check: each of the last plateau_sessions sessions no better than
  // the one before it, and genuinely worse overall (not just flat).
  const window = sessions.slice(0, settings.plateau_sessions);
  let declining = false;
  if (window.length >= settings.plateau_sessions) {
    // `window` is newest-first. Declining means each session is no better
    // than the (older) one that follows it in this array, i.e. performance
    // never improved on the way to today, and today's end point is
    // genuinely worse than where the window started.
    const metrics = window.map((s) => sessionMetric(s, hasWeight));
    const neverImproved = metrics.every((m, i) => i === metrics.length - 1 || m <= metrics[i + 1] + 1e-9);
    declining = neverImproved && metrics[0] < metrics[metrics.length - 1] - 1e-9;
  }

  let nextWeight = hasWeight ? weight : null;
  let nextReps = minReps;
  let reason;

  if (declining) {
    nextReps = Math.max(minReps, hasWeight ? Math.min(minReps, settings.rep_low) : minReps);
    reason = `Your last ${settings.plateau_sessions} sessions trended down — repeat today's numbers rather than pushing further. Technique, sleep or stress are usually the cause, not a reason to stop.`;
  } else if (!hasWeight) {
    nextReps = minReps + 1;
    reason = `Bodyweight move — aim for ${nextReps} reps (one more than your toughest set last time).`;
  } else if (settings.strategy === 'linear') {
    if (minReps >= settings.rep_high) {
      nextWeight = round2(weight + settings.weight_increment);
      reason = `Every set hit ${settings.rep_high}+ reps last time — try adding ${settings.weight_increment}.`;
    } else {
      nextWeight = weight;
      nextReps = Math.min(settings.rep_high, minReps + 1);
      reason = `Repeat ${weight} and aim for ${nextReps} reps on your hardest set before adding weight.`;
    }
  } else {
    // Double progression (default): climb reps to the top of the range, then add weight and reset.
    if (minReps >= settings.rep_high) {
      nextWeight = round2(weight + settings.weight_increment);
      nextReps = settings.rep_low;
      reason = `Every set reached ${settings.rep_high}+ reps — step up to ${nextWeight} and reset to ${settings.rep_low} reps.`;
    } else {
      nextWeight = weight;
      nextReps = Math.min(settings.rep_high, minReps + 1);
      reason = `Stay at ${weight} and push for ${nextReps} reps on every set before adding weight.`;
    }
  }

  return {
    weight: nextWeight,
    reps: nextReps,
    sets: setCount,
    declining,
    strategy: settings.strategy,
    reason,
    based_on: { date: last.date, weight: hasWeight ? weight : null, reps: minReps, sets: setCount },
  };
}
