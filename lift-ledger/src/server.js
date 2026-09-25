import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate, usingTurso } from './db.js';
import { authRouter, requireAuth, authEnabled } from './auth.js';
import { catalogRouter } from './routes/catalog.js';
import { workoutsRouter } from './routes/workouts.js';
import { progressRouter } from './routes/progress.js';
import { HttpError } from './validate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const isProd = process.env.NODE_ENV === 'production';

if (isProd && !authEnabled) {
  console.error('APP_PASSWORD is not set. Refusing to start: your workout data would be public.');
  process.exit(1);
}
if (isProd && !usingTurso) {
  console.warn('TURSO_DATABASE_URL is not set: using a local file, which Render wipes on every deploy.');
}

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});
app.use(express.json({ limit: '200kb' }));

app.get('/healthz', (req, res) => res.json({ ok: true }));

app.use('/api/auth', authRouter);
app.use('/api', requireAuth, catalogRouter, workoutsRouter, progressRouter);
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

app.use('/vendor/chart.js', express.static(path.join(root, 'node_modules/chart.js/dist')));
app.use(express.static(path.join(root, 'public')));

app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
  if (String(err.message).includes('UNIQUE constraint')) {
    return res.status(409).json({ error: 'That name is already in use' });
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server' });
});

const port = Number(process.env.PORT) || 3000;
await migrate();
app.listen(port, '0.0.0.0', () => {
  console.log(`Lift Ledger running on port ${port} (${usingTurso ? 'Turso' : 'local SQLite file'})`);
});
