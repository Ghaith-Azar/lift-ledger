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
- **Workout timer** — the clock starts the moment you start a workout and shows a live
  ticking time on the workout page; tap **End workout** to stop it. Progress shows your
  average session length week by week, plus your longest. Forgot to tap End? Fix it in
  the workout's ⋯ menu → **Edit times** — sessions over 4 hours are assumed to be a
  forgotten tap and left out of the average (but still shown, and correctable).
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
- **Previous session, right next to today's.** Every exercise card shows a "Last time"
  line and, in the set grid itself, a "Last" column beside each weight/reps box — what
  you did is always visible while you're deciding what to do now, no tab-switching.
- **Progressive overload assistant.** Each exercise can show a suggested next target
  (weight × reps × sets) worked out from your last session — climb reps to the top of
  your range, then add weight and reset (or a straight linear add, your choice). It
  flags a personal record, confirms once you've matched or beaten the suggested target,
  and if the last few sessions trended down it suggests holding steady instead of pushing
  further. Every suggestion is just that — **Use** it, edit the numbers after, or ignore it
  and log whatever you actually did; nothing is ever applied on its own. Tune the rules
  (strategy, rep range, weight increment, how many declining sessions count as a trend, or
  turn it off entirely) from the sliders icon on Progress or the workout's ⋯ menu.
- **Deeper insights on Progress** — total personal records at a glance, volume lifted per
  muscle group per week (not just set count), training frequency per muscle group (sessions
  in the last 4 weeks, average days between sessions), and on each exercise's own page: a
  "reps at your top weight" trend line, a best-single-set-volume record, and a consistency
  score comparing your last several sessions rather than judging off one best or worst day.
- **Progress photos.** Log upper- and lower-body photos over time from the Progress tab —
  a timeline you can scroll, and a compare view to put any two side by side. Photos are
  resized in your browser before upload (so a 12MP camera shot becomes ~150KB) and stored
  in the database, not the server's disk, so they survive every redeploy. Optionally, **Ask
  AI: am I improving?** sends two of your photos to the Anthropic API for a short, cautious
  written read on visible training progress — off by default, needs a one-time setup (see
  "Progress photos" below), and the gallery/compare view works fully without it.

## Project layout

```
src/
  server.js       Express app, static file serving, error handling
  db.js           Schema, migrations, the no-delete triggers, edit_log helper
  auth.js         Single-password auth (signed cookie)
  analytics.js    Weekly rollups, trend detection, estimated 1RM, workout duration,
                  PR counting, per-exercise consistency, per-muscle-group frequency
  progression.js  Progressive-overload suggestion engine + its settings
  photoAI.js      Optional Anthropic-vision photo comparison (needs ANTHROPIC_API_KEY)
  validate.js     Input validation helpers
  routes/         catalog.js (split/exercises), workouts.js (logging), progress.js,
                  photos.js (progress-photo upload/gallery/AI compare),
                  progression.js (suggestion settings)
public/
  index.html
  sw.js           Service worker: app-shell caching + push notification handling
  css/styles.css
  js/             main.js (router), views/, api.js, state.js, charts.js, util.js,
                  offlineSets.js (offline set-logging queue), push.js (subscribe/
                  unsubscribe), photoUtil.js (client-side photo resize), exerciseLibrary.js
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

## Progress photos

The photo gallery, timeline and side-by-side compare all work with no setup at all — photos
live in your database (Turso), resized to ~150KB by your browser before upload, same
"nothing is ever deleted" rule as the rest of your data (removing one archives it).

The **Ask AI: am I improving?** button is optional and needs one environment variable:

1. Get an API key from [console.anthropic.com](https://console.anthropic.com). This is
   billed per use on your Anthropic account — separate from, and unrelated to, any Claude
   subscription you might already have.
2. Add `ANTHROPIC_API_KEY` to Render's environment variables and redeploy. (Optionally set
   `ANTHROPIC_MODEL` to a cheaper/faster Haiku-class model id if you'd rather trade off some
   judgment quality for cost — it defaults to a Sonnet-class model.)
3. Open **Progress → Progress photos → Compare**, pick two photos, and tap **Ask AI**.

What it actually does: sends just the two photos you picked — nothing else from your data —
to the Anthropic API, asking for a rough, cautious read on visible training progress in that
body region (never a weight, body-fat, or BMI guess, and it's told to say "hard to tell"
rather than invent a confident answer when lighting/pose/angle make the comparison unclear).
Results are cached per photo pair, so re-opening the same comparison doesn't trigger another
paid call — only picking a pair you haven't compared before does. Without `ANTHROPIC_API_KEY`
set, the button still shows but explains it isn't configured rather than erroring.

## Progressive overload assistant

No setup needed — it's on by default with sensible rules, and every suggestion is purely
an offer (see "How it works" above).

**How a target is worked out**, from your most recent session of that exercise:

- **Double progression** (the default): if every set reached the top of your rep range
  (12 reps by default), it suggests adding weight (2.5 by default) and resetting reps to
  the bottom of the range (8 by default). Otherwise, it suggests repeating the weight and
  adding a rep to your hardest set.
- **Linear**: adds weight as soon as every set reaches the top of the rep range; otherwise
  repeats the weight and nudges reps up, same as double progression's "not there yet" case.
- A **bodyweight-only** exercise (no weight ever logged) only ever suggests one more rep
  than your toughest set last time.
- If your last few sessions (3 by default) trended down without a single improvement, it
  suggests holding at today's numbers rather than climbing further — technique, sleep and
  stress are usually the cause, and the assistant isn't trying to talk you out of a rest.
- The very first time you log an exercise, there's no suggestion yet — nothing to base one on.

**Settings** (sliders icon on Progress, or a workout's ⋯ menu → Progression settings):
turn suggestions on/off entirely, switch strategy, change the rep range, the weight
increment, and how many declining sessions count as a trend worth flagging.

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
