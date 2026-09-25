import crypto from 'node:crypto';
import { Router } from 'express';

const PASSWORD = process.env.APP_PASSWORD || '';
const SECRET =
  process.env.SESSION_SECRET ||
  crypto.createHash('sha256').update(`lift-ledger:${PASSWORD}`).digest('hex');

const COOKIE = 'll_session';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 90; // stay signed in for 90 days
const isProd = process.env.NODE_ENV === 'production';

export const authEnabled = PASSWORD !== '';

const sign = (value) => crypto.createHmac('sha256', SECRET).update(value).digest('base64url');

const digest = (value) => crypto.createHash('sha256').update(String(value)).digest();

function makeToken() {
  const expires = String(Date.now() + MAX_AGE_SECONDS * 1000);
  return `${expires}.${sign(expires)}`;
}

function validToken(token) {
  if (!token) return false;
  const [expires, signature] = token.split('.');
  if (!expires || !signature) return false;
  const expected = sign(expires);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  return Number(expires) > Date.now();
}

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export function isAuthenticated(req) {
  return !authEnabled || validToken(readCookie(req, COOKIE));
}

export function requireAuth(req, res, next) {
  if (isAuthenticated(req)) return next();
  res.status(401).json({ error: 'Sign in to continue' });
}

// Very small brute-force guard: 10 attempts per 15 minutes per IP.
const attempts = new Map();
function tooManyAttempts(ip) {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || entry.resetAt < now) {
    attempts.set(ip, { count: 1, resetAt: now + 15 * 60 * 1000 });
    return false;
  }
  entry.count += 1;
  return entry.count > 10;
}

export const authRouter = Router();

authRouter.get('/session', (req, res) => {
  res.json({ authRequired: authEnabled, authenticated: isAuthenticated(req) });
});

authRouter.post('/login', (req, res) => {
  if (!authEnabled) return res.json({ ok: true });
  if (tooManyAttempts(req.ip)) {
    return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
  }
  const supplied = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!crypto.timingSafeEqual(digest(supplied), digest(PASSWORD))) {
    return res.status(401).json({ error: 'Wrong password' });
  }
  res.cookie(COOKIE, makeToken(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    maxAge: MAX_AGE_SECONDS * 1000,
    path: '/',
  });
  res.json({ ok: true });
});

authRouter.post('/logout', (req, res) => {
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
});
