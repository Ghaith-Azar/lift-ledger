import { api } from './api.js';

export const state = {
  catalog: { muscle_groups: [], exercises: [], split_days: [] },
  unit: localStorage.getItem('unit') || 'kg',
};

export async function loadCatalog() {
  state.catalog = await api.get('/api/catalog');
  return state.catalog;
}

export function setUnit(unit) {
  state.unit = unit;
  localStorage.setItem('unit', unit);
}

export const activeDays = () => state.catalog.split_days.filter((d) => !d.archived);
export const activeGroups = () => state.catalog.muscle_groups.filter((g) => !g.archived);
export const groupById = (id) => state.catalog.muscle_groups.find((g) => g.id === id);
export const exercisesOfGroup = (groupId, { archived = false } = {}) =>
  state.catalog.exercises.filter((e) => e.muscle_group_id === groupId && !!e.archived === archived);

// Each muscle group gets a plate colour (see --p0..--p7 in the stylesheet).
export const plateColor = (groupId) => `var(--p${Math.abs(groupId) % 8})`;
