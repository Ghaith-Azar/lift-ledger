// A starter list of common gym exercises, so setting up a split doesn't mean
// typing every exercise by hand. Keyed by canonical muscle group name; if the
// person's own muscle group is named or grouped differently (e.g. "Legs"
// instead of Quads/Hamstrings/Glutes/Calves), ALIASES below maps it to the
// closest matching list(s). Anything not covered here can still be typed in
// manually — this is a shortcut, not a restriction.

const LIBRARY = {
  chest: [
    'Barbell Bench Press',
    'Incline Barbell Bench Press',
    'Decline Barbell Bench Press',
    'Dumbbell Bench Press',
    'Incline Dumbbell Press',
    'Dumbbell Flyes',
    'Incline Dumbbell Flyes',
    'Cable Crossover',
    'Pec Deck Machine',
    'Machine Chest Press',
    'Push-Up',
    'Chest Dip',
  ],
  back: [
    'Deadlift',
    'Barbell Row',
    'Pendlay Row',
    'T-Bar Row',
    'Seated Cable Row',
    'Single-Arm Dumbbell Row',
    'Lat Pulldown',
    'Pull-Up',
    'Chin-Up',
    'Straight-Arm Pulldown',
    'Face Pull',
    'Machine Row',
    'Rack Pull',
  ],
  shoulders: [
    'Overhead Barbell Press',
    'Seated Dumbbell Shoulder Press',
    'Arnold Press',
    'Machine Shoulder Press',
    'Lateral Raise',
    'Cable Lateral Raise',
    'Front Raise',
    'Rear Delt Fly',
    'Reverse Pec Deck',
    'Upright Row',
  ],
  biceps: [
    'Barbell Curl',
    'EZ-Bar Curl',
    'Dumbbell Curl',
    'Hammer Curl',
    'Incline Dumbbell Curl',
    'Preacher Curl',
    'Concentration Curl',
    'Cable Curl',
    'Spider Curl',
  ],
  triceps: [
    'Close-Grip Bench Press',
    'Triceps Pushdown',
    'Rope Pushdown',
    'Overhead Triceps Extension',
    'Skull Crushers',
    'Dumbbell Kickback',
    'Triceps Dip',
    'Cable Overhead Extension',
  ],
  quads: [
    'Back Squat',
    'Front Squat',
    'Hack Squat',
    'Leg Press',
    'Goblet Squat',
    'Walking Lunge',
    'Bulgarian Split Squat',
    'Leg Extension',
    'Step-Up',
  ],
  hamstrings: [
    'Romanian Deadlift',
    'Stiff-Leg Deadlift',
    'Lying Leg Curl',
    'Seated Leg Curl',
    'Good Morning',
    'Nordic Curl',
    'Glute-Ham Raise',
  ],
  glutes: [
    'Hip Thrust',
    'Glute Bridge',
    'Sumo Deadlift',
    'Cable Kickback',
    'Bulgarian Split Squat',
    'Romanian Deadlift',
  ],
  calves: ['Standing Calf Raise', 'Seated Calf Raise', 'Leg Press Calf Raise', 'Donkey Calf Raise'],
  abs: [
    'Plank',
    'Hanging Leg Raise',
    'Cable Crunch',
    'Machine Crunch',
    'Sit-Up',
    'Russian Twist',
    'Ab Wheel Rollout',
    'Toes to Bar',
  ],
  forearms: ['Wrist Curl', 'Reverse Wrist Curl', 'Reverse Curl', "Farmer's Carry"],
  traps: ['Barbell Shrug', 'Dumbbell Shrug', 'Upright Row'],
  cardio: ['Treadmill Run', 'Rowing Machine', 'Assault Bike', 'Kettlebell Swing', 'Burpees'],
};

// Loose synonyms for muscle groups people commonly name differently.
const ALIASES = {
  legs: ['quads', 'hamstrings', 'glutes', 'calves'],
  arms: ['biceps', 'triceps'],
  core: ['abs'],
  stomach: ['abs'],
  delts: ['shoulders'],
  lats: ['back'],
  full_body: ['chest', 'back', 'shoulders', 'quads', 'hamstrings', 'glutes'],
};

const norm = (s) => s.trim().toLowerCase().replace(/\s+/g, '_');

/** Common exercises for a muscle group name, or [] if nothing matches. */
export function suggestionsFor(groupName) {
  const key = norm(groupName || '');
  if (LIBRARY[key]) return LIBRARY[key];
  const aliasTargets = ALIASES[key];
  if (!aliasTargets) return [];
  const seen = new Set();
  const merged = [];
  for (const target of aliasTargets) {
    for (const name of LIBRARY[target] || []) {
      if (!seen.has(name)) {
        seen.add(name);
        merged.push(name);
      }
    }
  }
  return merged;
}
