# Lift Ledger

A gym workout logger. Log sets, weight and reps per exercise, organized by muscle
group and your training split. Add drop sets and supersets. Nothing you log is
ever deleted. Every week gets rolled up into graphs so you can see whether a
lift is actually going up.

Plain Node.js + Express backend, a libSQL/Turso database, and a dependency-free
vanilla JS frontend (no build step, no framework) that talks to it over a small
JSON API. Charts are drawn with Chart.js.

## How it works

- **Split** — set up your training days once (e.g. Push / Pull / Legs), and
  which muscle groups belong to each day. Add exercises under each muscle
  group as you go, no need to front-load a big exercise list.
- **Train** — tells you which day is next based on what you last trained, and
  starts a new workout pre-filled with the same exercises as last time.
- Logging a set is two number taps: weight and reps. Tap the down-arrow next
  to a set to add a **drop set** underneath it. Use the "⋯" menu on an
  exercise to **superset** it with another exercise in the same workout.
- **History** lets you look back at, and edit, any past workout.
- **Progress** shows weekly trends per exercise — top weight, estimated 1RM,
  average reps, volume — with a plain-language trend read-out (progressing /
  plateaued / regressing), plus muscle-group set volume across weeks.
- **Nothing is ever deleted.** Removing a set or exercise archives it (with an
  undo toast on the spot); the database itself has triggers that refuse `DELETE`
  statements outright. Every edit is written to an `edit_log` table with the
  before/after values. `GET /api/export` downloads a full JSON backup,
  including that edit history, any time you want one.

## Project layout

```
src/
  server.js       Express app, static file serving, error handling
  db.js           Schema, migrations, the no-delete triggers, edit_log helper
  auth.js         Single-password auth (signed cookie)
  analytics.js    Weekly rollups, trend detection, estimated 1RM
  validate.js     Input validation helpers
  routes/         catalog.js (split/exercises), workouts.js (logging), progress.js
public/
  index.html
  css/styles.css
  js/             main.js (router), views/, api.js, state.js, charts.js, util.js
```

## Running it locally

Requires Node 20+.

```bash
npm install
npm run dev        # auto-restarts on file changes; or `npm start`
```

With no `TURSO_DATABASE_URL` set, it uses a local SQLite file (`local.db`) in
the project folder — nothing to configure, just run it. With no
`APP_PASSWORD` set, the login screen is skipped, which is convenient for
local development only (see the Turso section below for how to configure a
password once you deploy).

Open `http://localhost:3000`.

## Deploying: Turso (database)

1. Install the CLI and sign in — see https://docs.turso.tech/cli/installation.
2. Create the database and grab its URL and a token:
   ```bash
   turso db create lift-ledger
   turso db show lift-ledger --url
   turso db tokens create lift-ledger
   ```
3. Keep the URL (starts with `libsql://`) and the token — you'll paste them
   into Render's environment variables below. The app creates all the tables
   itself on first boot, so there's nothing to run against the database
   manually.

Turso's free tier is generously sized for a single person's workout log.

## Deploying: Render (app)

**Option A — Blueprint (one click):** this repo includes a `render.yaml`.
In the Render dashboard choose **New → Blueprint**, point it at your repo,
and Render reads the file and sets up the service. You'll be prompted for
the environment variables below during setup.

**Option B — manual:**
1. **New → Web Service**, connect your repo.
2. Runtime: **Node**. Build command: `npm install`. Start command: `npm start`.
3. Under **Environment**, add:
   | Key | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `APP_PASSWORD` | a password you'll type on your phone — pick something you can type on a gym floor |
   | `TURSO_DATABASE_URL` | from `turso db show lift-ledger --url` |
   | `TURSO_AUTH_TOKEN` | from `turso db tokens create lift-ledger` |
   | `SESSION_SECRET` | any random string (Render can generate one) |
4. Deploy. Render gives you a URL — open it, enter `APP_PASSWORD`, and you're
   logged in for 90 days.

The server refuses to start in production without `APP_PASSWORD` set, so you
don't accidentally end up with your workout log open to the internet.

### Add it to your phone's home screen

The app is a small installable web app (manifest + icon included). On iOS
Safari: Share → **Add to Home Screen**. On Android Chrome: menu → **Install
app**. It then opens full-screen, without browser chrome, like a native app.

## Notes on a couple of design choices

- **Weeks start Monday** and are used everywhere trends are computed, so a
  Sunday-night session and a Monday-morning one don't get averaged together
  as "the same day."
- **Estimated 1RM** uses the Epley formula (`weight × (1 + reps/30)`), which
  is what the "Est. 1RM" trend line is based on for weighted exercises.
  Bodyweight-only exercises (no weight ever logged) fall back to tracking
  best reps and volume instead, since 1RM doesn't mean much there.
- Trend direction (progressing/plateau/regressing) needs at least 3 weeks of
  data with some spread before it commits to a direction — otherwise it says
  "still building trend" rather than overreacting to two data points.
- A **drop set** is stored as extra rows sharing the same set number as the
  set they dropped from (`drop_index` 1, 2, 3…), so archiving or restoring
  the main set carries its drops along with it automatically.
