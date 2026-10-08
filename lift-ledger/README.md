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
- **Quick weight buttons** — tap a weight box and −5 / −2.5 / +2.5 / +5 buttons appear
  under it. A burst of taps saves as a single edit.
- **PR celebration** — beating your best weight (or best estimated 1RM, or reps for
  bodyweight moves) on an exercise pops a gold toast and confetti. The first time you
  ever log an exercise never counts, since there is nothing to beat.
- **Bodyweight** — log weigh-ins from the Progress tab. Shows the latest weight, the
  change over the last 7 weigh-ins and since you started, and a chart with a 7-weigh-in
  average line (daily weight is noisy). Weight changes are shown in neutral colours,
  since up or down is not good or bad by itself.
- **Muscle balance** — compares each muscle group's sets over the last 4 weeks with your
  most-trained group and flags any that are 30%+ behind or missing. Uses sets rather than
  volume so heavy compound lifts don't skew it.
- **Personal records** — a 🏆 Records page (linked from Progress) listing your current best
  on every exercise at once — heaviest set, best estimated 1RM, or best reps for bodyweight
  moves — filterable by muscle group.
- **Deload nudge** — a banner on Progress when 3+ lifts (or half of everything with enough
  history) are plateaued or regressing, naming them and suggesting a lighter week.
- **Reorder exercises** — "Move up" / "Move down" in an exercise's ⋯ menu, scoped to its
  own muscle-group section. Supersets move as one block.
- **Weekly weigh-in reminders, two ways.** A banner on the Train tab shows up on its own —
  no setup — any time it's been a week (or you've never logged one). Tap the 🔔 on the
  Bodyweight card for an actual push notification once a week too, even with the app
  closed; it skips itself automatically if you've already logged that week. The push half
  needs a one-time setup (see "Weekly reminders" below) — the banner works regardless.
- **Works with no signal.** The app installs as an offline-capable PWA: the app shell and
  your last-loaded data are cached, and logging, editing or removing sets while offline
  queues those changes (shown with a small gold ring) and syncs automatically the moment
  you're back online — in the order you made them, never reordered or dropped. Everything
  else (adding exercises, editing the split) needs a connection, since faking those safely
  offline is a lot riskier than it looks.
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
  sw.js           Service worker: app-shell caching + push notification handling
  css/styles.css
  js/             main.js (router), views/, api.js, state.js, charts.js, util.js,
                  offlineSets.js (offline set-logging queue), push.js (subscribe/
                  unsubscribe), exerciseLibrary.js
scripts/
  generate-vapid-keys.js   One-time key pair for push notifications
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

## Weekly reminders

The in-app banner on the Train tab needs nothing — it just shows up when it's due. Real
push notifications (the 🔔 on the Bodyweight card) need a one-time setup:

1. **Generate a key pair.** From the project folder:
   ```bash
   npm run vapid:generate
   ```
   This prints `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and a `VAPID_SUBJECT` line (put
   your own email in that one). Add all three to Render's environment variables. These
   identify *your server* to the push services (Chrome's, Firefox's, etc.) — generate your
   own rather than reusing someone else's, and keep the private key secret.
2. **Redeploy**, then open the app, go to **Progress**, tap **🔔** on the Bodyweight card,
   and **Turn on for this device**. Your browser will ask for notification permission.
3. Use **Send a test notification** in that same sheet to confirm it actually arrives
   before waiting for the real schedule.

**Getting the weekly check to actually run.** The server checks "is it time, and have I
not already sent this week" every 30 minutes on its own — but Render's free tier puts your
instance to sleep after 15 minutes of no traffic, and a sleeping instance obviously can't
check anything. Two ways to handle this, from least to most effort:

- **Do nothing.** If you (or anything else) happen to open the app around your chosen
  day/time, that request wakes the instance and the in-process check runs. Fine if you're
  not fussed about precise timing.
- **Add `CRON_SECRET`** (any random string) to your environment, and point a free external
  scheduler — [cron-job.org](https://cron-job.org), a
  [GitHub Actions scheduled workflow](https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#schedule),
  UptimeRobot, etc. — at:
  ```
  POST https://your-app.onrender.com/api/push/trigger?secret=YOUR_CRON_SECRET
  ```
  once a week, a little after the day/time you picked in the app. This also happens to
  wake a sleeping instance right when it's needed. Without `CRON_SECRET` set, this endpoint
  doesn't exist at all (404), so there's no unauthenticated endpoint sitting around by
  accident.
- **Upgrade off the free tier** so the instance never sleeps, and skip the external
  scheduler entirely.

Notification timing is in UTC (there's no per-device timezone to go by on the server side)
— pick the day and hour from the sheet with that in mind.

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
- The weekly reminder **skips itself if you've already logged a weigh-in that
  week** (Monday-based, same as everything else) — it's there to close the
  gap, not to nag once you've already done the thing.
