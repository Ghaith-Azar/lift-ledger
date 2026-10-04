// A small persisted queue so logging a set still works with no signal in
// the gym. Scoped deliberately narrow: only set creation, edits and
// archiving (the things you actually tap mid-workout) go through here.
// Everything else (adding exercises, editing the split, etc.) just asks you
// to reconnect, since faking those correctly offline is a lot riskier.
//
// Queued operations are replayed strictly in order, and a create's real
// server-assigned ID is patched into any later operations that were queued
// against its temporary ID before anything else runs. On any failure that
// looks like "still offline", replay stops and resumes later rather than
// skipping or reordering — nothing queued is ever dropped silently.

import { api } from './api.js';

const KEY = 'll_offline_queue_v1';
const listeners = new Set();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(queue));
  } catch {
    // Storage full or unavailable: the queue still works for this page session.
  }
}

let queue = load();
let syncing = false;

function notify() {
  listeners.forEach((fn) => fn());
}

/** Called whenever the queue changes (enqueue, sync progress, drained). */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function pendingCount() {
  return queue.length;
}

export function hasPendingFor(id) {
  return queue.some((op) => op.targetId === id);
}

export const isTempId = (id) => typeof id === 'string' && id.startsWith('local_');

let tempCounter = 0;
export function newTempId() {
  return `local_${Date.now()}_${tempCounter++}`;
}

function push(op) {
  queue.push(op);
  save();
  notify();
  trySync();
}

export function enqueueCreateSet({ targetId, workoutExerciseId, dropOf, setNumber, dropIndex, weight, reps }) {
  push({ type: 'create_set', targetId, workoutExerciseId, dropOf, setNumber, dropIndex, weight, reps });
}

export function enqueueUpdateSet(setId, patch) {
  push({ type: 'update_set', targetId: setId, patch });
}

export function enqueueArchiveSet(setId, archived) {
  push({ type: 'archive_set', targetId: setId, archived });
}

/**
 * If a set created offline is edited again before it ever syncs, fold the
 * edit into the still-pending create instead of queuing a second operation
 * against an ID that doesn't exist on the server yet.
 */
export function updatePendingCreate(tempId, patch) {
  const op = queue.find((o) => o.targetId === tempId && o.type === 'create_set');
  if (!op) return false;
  Object.assign(op, patch);
  save();
  return true;
}

function remap(fromId, toId) {
  let changed = false;
  for (const op of queue) {
    if (op.targetId === fromId) {
      op.targetId = toId;
      changed = true;
    }
  }
  if (changed) save();
}

async function runOne(op) {
  if (op.type === 'create_set') {
    const body = {};
    if (op.dropOf != null) body.drop_of = op.dropOf;
    if (op.weight != null) body.weight = op.weight;
    if (op.reps != null) body.reps = op.reps;
    const res = await api.post(`/api/workout-exercises/${op.workoutExerciseId}/sets`, body);
    const we = res.exercises?.find((x) => x.id === op.workoutExerciseId);
    const real = we?.sets.find((s) => s.set_number === op.setNumber && s.drop_index === op.dropIndex);
    if (!real) throw new Error('Could not match the synced set back to its place');
    remap(op.targetId, real.id);
  } else if (op.type === 'update_set') {
    await api.patch(`/api/sets/${op.targetId}`, op.patch);
  } else if (op.type === 'archive_set') {
    await api.patch(`/api/sets/${op.targetId}`, { archived: op.archived });
  }
}

/** Walk the queue in order. Stops at the first sign of "still offline" and
 *  leaves everything from there on queued for the next attempt. */
export async function trySync() {
  if (syncing || !queue.length) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  syncing = true;
  try {
    while (queue.length) {
      try {
        await runOne(queue[0]);
      } catch (err) {
        if (err?.status && err.status !== 0) {
          // The server actively rejected this one (not just unreachable).
          // Retrying forever would just wedge the queue, so drop it and say so.
          console.warn('Dropping a queued offline change the server rejected:', err.message);
          queue.shift();
          save();
          notify();
          continue;
        }
        break;
      }
      queue.shift();
      save();
      notify();
    }
  } finally {
    syncing = false;
  }
}

export function isSyncing() {
  return syncing;
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', trySync);
  // Belt and braces in case the 'online' event doesn't fire reliably.
  setInterval(trySync, 15000);
  trySync();
}
