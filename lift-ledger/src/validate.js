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

// An ISO-8601 timestamp (as produced by `datetime('now')` or `Date.toISOString()`),
// for manually correcting a workout's start/end time. null clears it.
export function optDateTime(value, name = 'time') {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw bad(`${name} must be a valid date/time`);
  }
  return value;
}

// ---------- Progress photos ----------

export const PHOTO_CATEGORIES = ['upper', 'lower'];

export function reqCategory(value) {
  if (!PHOTO_CATEGORIES.includes(value)) throw bad('category must be "upper" or "lower"');
  return value;
}

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
// The client resizes photos well under this before upload — this is just
// generous headroom against an unresized original or a slow resize.
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

/** Decodes { content_type, data } (base64, optionally a data: URL) into a Buffer. */
export function reqImageData(body) {
  const contentType = body?.content_type;
  if (!ALLOWED_IMAGE_TYPES.includes(contentType)) {
    throw bad('content_type must be image/jpeg, image/png or image/webp');
  }
  const raw = body?.data;
  if (typeof raw !== 'string' || !raw.length) throw bad('data (base64-encoded image) is required');
  const base64 = raw.startsWith('data:') && raw.includes(',') ? raw.slice(raw.indexOf(',') + 1) : raw;
  let buffer;
  try {
    buffer = Buffer.from(base64, 'base64');
  } catch {
    throw bad('data is not valid base64');
  }
  if (!buffer.length) throw bad('data is empty');
  if (buffer.length > MAX_IMAGE_BYTES) throw bad('Image is too large (6MB max)');
  return { contentType, buffer };
}
