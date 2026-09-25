export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const bad = (message) => new HttpError(400, message);
export const notFound = (what = 'Not found') => new HttpError(404, what);

export function reqInt(value, name = 'id') {
  const n = Number(value);
  if (!Number.isInteger(n)) throw bad(`${name} must be a whole number`);
  return n;
}

export function optNumber(value, name, { min = 0, max = 100000 } = {}) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw bad(`${name} must be a number between ${min} and ${max}`);
  }
  return n;
}

export function optInt(value, name, opts) {
  const n = optNumber(value, name, opts);
  if (n !== undefined && n !== null && !Number.isInteger(n)) {
    throw bad(`${name} must be a whole number`);
  }
  return n;
}

export function reqName(value, label = 'Name') {
  if (typeof value !== 'string') throw bad(`${label} is required`);
  const s = value.trim().replace(/\s+/g, ' ');
  if (!s) throw bad(`${label} is required`);
  if (s.length > 80) throw bad(`${label} is too long (80 characters max)`);
  return s;
}

export function optName(value, label) {
  return value === undefined ? undefined : reqName(value, label);
}

export function optText(value, max = 2000) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') throw bad('Text expected');
  const s = value.trim().slice(0, max);
  return s === '' ? null : s;
}

export function reqDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw bad('Date must look like 2026-09-21');
  }
  return value;
}

export function optBool(value) {
  return value === undefined ? undefined : value ? 1 : 0;
}
