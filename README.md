# Bee4Stitch Web (preview)

A first working slice of a web version of the Bee4Stitch desktop app (Jezseem-Traders), built and
verified in this session. The site itself is static — no build step, no framework — by design (see
"Why static, not Next.js" below), plus three small serverless functions (`api/publish-machine.js`,
`api/machines.js`, `api/logs.js`) backed by a real cloud Postgres database. Cutter Performance's
Browse button reads a machine's `next2.db` in your browser and Publish saves it straight to that
database — anyone who opens the live site sees it immediately, with nothing to upload on their
end.

## What's actually working right now

- **Login gate** — username/password screen in front of everything. See "About the login" below —
  this is a soft gate, not real security.
- **Dashboard** — KPI cards, a 14-day efficiency trend chart, a recent-markers table. Sample data.
- **Marker Efficiency** — KPI cards, a filterable trend chart (14/30/90 days), a searchable marker
  detail table. Sample data.
- **Cutter Performance** — the first module wired to *real* production data, read only from a
  machine's actual `next2.db` — there is deliberately no spreadsheet upload here; the desktop
  app's own source of truth for this module is the cutter's database, so the web version uses the
  same source.
  - **Add a customer right from the page**: a "Browse for next2.db" button reads that machine's
    database in your browser and shows you the results immediately; a **Publish** button then
    saves it straight to the site's cloud database — live for every viewer immediately, no
    redeploy, no re-upload needed by anyone else. See "Adding a customer: Browse → Preview →
    Publish" below, and "Setting up the cloud database" for the one-time setup it needs.
  - Currently loaded: 3,777 real production-log rows from Kay & Emms, Cutter #1 (last ~3 months),
    originally extracted with `extract-next2.py`. The machine picker in the page's header lists
    every customer published so far.
  - Same 8 KPI tiles, same speed-attainment formula and performance thresholds (Critical / Below
    target / On target / Review over-speed) as the desktop app's
    `frmCutterPerformanceDashboard.vb` / `CutterPerformanceTrendBuilder.vb` — verified against the
    actual VB source, not guessed. The one deliberate simplification: the desktop app derives
    idle/delay time from live machine telemetry; this extract uses `next2.db`'s own `IdleTime`
    column directly. The production-log table shows marker, machine, order, operator, style,
    fabric type, timing, speed/attainment/status, perimeter and marker length, and plies —
    `operator`/`style` currently show "—" because those columns aren't present in `next2.db`'s
    `ProductionLogs` table (see "Where operator/style detail would come from" below).
  - **Live data needs the deployed site.** Browse/Preview still work by double-clicking
    `public/index.html` locally (reading the `.db` file is entirely client-side). But *viewing*
    already-published data, and Publish itself, now call the site's own `/api/machines` and
    `/api/logs` endpoints — those only exist on the real deployed URL, not on a local `file://`
    page. See "Running it locally" below.
  - Adjustable **target (ideal) speed** slider (0–15 m/min), mirroring
    `My.Settings.CutterPerformanceIdealSpeed` — moving it recomputes attainment and status live.
- Sidebar navigation matching the desktop app's real modules. Production Summary, OFIN Roll
  Analysis and Lot Inventory are present in the nav but intentionally show a "not built yet"
  placeholder — nothing here is faked as finished when it isn't.

Dashboard and Marker Efficiency still read static sample/generated data in `public/data/`. Every
load goes through `loadDataScript()` in `public/app.js` — that's the seam to swap for a real API
(e.g. `fetch("/api/...")`) once there's a service in front of your SQL Server; at that point the
site will need to be served over HTTP rather than opened directly, since a real API call is
exactly the kind of request `file://` blocks (see "Running it locally" below).

## About the login

There is no backend, so there's nowhere to safely check a password — anyone who views
`public/auth.js` can read the hardcoded credentials and bypass the screen. It's a soft gate to
keep casual visitors off an internal preview link, **not real security**. Default credentials:

```
username: admin
password: bee4stitch2026
```

Change them in `public/auth.js` (`AUTH_CONFIG`) before sharing the link. Real authentication needs
a backend — e.g. NextAuth on Vercel, or an identity provider — which is part of the same
"migrate off static HTML" step as wiring up a real API.

## Adding a customer: Browse → Preview → Publish

On the Cutter Performance page, under "Add or update a customer":

1. Fill in a **Machine ID** (short, lowercase, e.g. `j-tex-1` — used internally, not shown to
   viewers) and a **Display label** (e.g. `J-Tex – Cutter #1` — what shows in the machine picker).
   Optionally set "Only include rows since" a date, same as `extract-next2.py --since`.
2. Click **Browse** and pick that customer's `next2.db` (under their `xt2cache` folder). It's read
   right there in your browser — nothing leaves your machine at this point. You'll see the same
   KPI tiles, chart and table you'd see for any published machine, so you can check it looks right
   before anything is saved.
3. Enter the **publish key** (ask whoever set this site up — it's a one-time thing, see "Setting
   up the cloud database" below) and click **Publish to Vercel**. This sends just the extracted
   rows (not the database file itself) to the site's own `/api/publish-machine` endpoint, which
   saves them straight into the project's Postgres database. There's no redeploy step — reload the
   page and the new machine is already in the picker, for everyone, immediately.

Re-publishing the same Machine ID later (e.g. with a newer `next2.db` export) updates that
machine's data in place rather than creating a duplicate entry.

Two things worth knowing:
- Reading the `.db` file client-side uses [sql.js](https://sql.js.org) (SQLite compiled to
  WebAssembly), loaded from a CDN the first time you use Browse on a given browser — so that one
  step needs internet access. Nothing else on the site does.
- A single next2.db extract with a few years of history can be tens of thousands of rows; if
  Publish fails on a very large file, set a "Since" date to narrow it and try again (the endpoint
  caps a single publish at 200,000 rows, and Vercel's own request-size limit is the more likely
  wall you'd hit first on a multi-year, no-filter export).

## Setting up the cloud database (one-time)

The Publish button (and viewing already-published data) needs a Postgres database connected to
this Vercel project, plus one secret — about 5 minutes, done once per Vercel project, and no
GitHub token is needed for any of this:

1. **Create the database**: in Vercel, open this project → **Storage** tab → **Create Database**
   → choose **Postgres** (Vercel's own Postgres offering, powered by Neon) → follow the prompts to
   create it and **connect it to this project**. That's it — Vercel automatically sets the
   `DATABASE_URL` / `POSTGRES_URL` environment variable(s) the API functions read from
   (`api/_lib/db.js`); there's nothing to copy or type in.
2. **Add one more environment variable**: this project's Settings → Environment Variables → add
   `PUBLISH_SECRET` with a passphrase you make up — this is what you'll type into the Publish key
   field on the page.
3. **Redeploy once** (Vercel → Deployments → ⋯ → Redeploy) so the functions pick up the new
   environment variables.
4. Share the `PUBLISH_SECRET` value with whoever should be able to publish new customers — it's
   the same soft-gate posture as the site's login screen (see "About the login" above), **not
   hardened security**. Anyone with it can write to the database through this endpoint; it's meant
   to keep the button from being usable by a random visitor, not to withstand a determined
   attacker. Rotate it in Vercel's environment variables if it ever leaks.

The database schema (two tables: `machines` and `production_logs`) is created automatically the
first time any API endpoint runs (`CREATE TABLE IF NOT EXISTS` in `api/_lib/db.js`) — there's no
separate migration step to run by hand.

Until this is set up, Preview still works (reading the `.db` file is entirely client-side), but
clicking Publish, and opening Cutter Performance on the live site, return a clear "no database
connected yet" message instead of failing silently.

### Where operator/style detail would come from

The production log table has columns for Operator, Style and Fabric Type. Fabric Type is already
populated from `next2.db`'s real `FabricType` column. Operator and Style currently show "—"
because `ProductionLogs` doesn't appear to have columns for them — if your Morgan MasterMind setup
tracks operator/style elsewhere (a different table in `next2.db`, or in the SQL Server database
the desktop app reads), point me at it and I'll wire it through the same way Fabric Type was
added.

## Updating Cutter Performance data without the browser (scripted)

The Browse → Preview → Publish flow above is the normal path. This is the scripted equivalent —
useful for automating a refresh (e.g. a scheduled task on a machine that has direct access to
several customers' `next2.db` files) without a person clicking through the page each time. Both
options below publish straight to the live site's cloud database — same effect as clicking
Publish in the browser, no git push or redeploy involved.

**Extract + publish, any OS:**
```bash
python3 extract-next2.py "<path-to-next2.db>" "<machine-id>" "<machine label>" public/data/next2-<name>.js \
  --since 2026-06-01 \
  --publish-url "https://bee4stitch.vercel.app" --publish-key "your-publish-secret"
```
`<machine-id>` is the key the web page looks up, separate from the display label — reuse an
existing id (see the machine picker on the live site) to update that machine, or invent a new
short lowercase-hyphenated one to add a customer. This only *reads* `ProductionLogs` from
`next2.db` — it never modifies the source database. The `public/data/next2-<name>.js` output file
is just a local backup/audit copy in plain text (not something the live site reads); omit
`--publish-url`/`--publish-key` to only write that file without touching the live site.

**Same thing, Windows / PowerShell:**
```powershell
.\refresh-and-publish.ps1 `
  -Next2DbPath "D:\Documents\Data Jezseem Traders\ERP Development\Morgan Cutter\Kay & Emms\Next 2 90 (Cutter # 1)\xt2cache\next2.db" `
  -MachineId "kay-emms-1" `
  -MachineLabel "Kay & Emms – Cutter #1" `
  -OutFile "public\data\next2-kay-emms-cutter1.js" `
  -Since 2026-06-01 `
  -PublishUrl "https://bee4stitch.vercel.app" `
  -PublishKey "your-publish-secret"
```
Needs Python 3 on PATH (only for `sqlite3`, which ships in Python's standard library — no `pip
install` required). Omit `-PublishUrl`/`-PublishKey` to only refresh the local backup file.

Either way, the actual publish step needs "Setting up the cloud database" below done first — until
then this fails with the same "no database connected yet" message the in-browser Publish button
shows.

## Running it locally

Just open `public/index.html` — double-clicking it works, no local server required, for the
Dashboard and Marker Efficiency pages and for Browsing/Previewing a next2.db on Cutter Performance.

That's deliberate for those parts: browsers block `fetch()`/AJAX of local files when a page is
opened directly from disk (`file://`), which is what made an earlier version of this app look
broken when opened that way. Dashboard/Marker Efficiency's sample data files under `public/data/`
are small `.js` files that assign into `window.__BEE4STITCH_DATA__` and are loaded with a plain
`<script src="...">` tag instead of `fetch()` — script tags aren't subject to that `file://`
restriction. See the comment at the top of `public/app.js` for the details.

Cutter Performance's real production data is the one exception: it now reads from a live database
through `/api/machines` and `/api/logs`, which only exist on the deployed site — opening
`index.html` locally will show "No customers published yet" / a clear error there even after data
has been published, because there's no server behind a local file to answer those calls. Use the
real Vercel URL to see published Cutter Performance data.

A local server still works fine for testing the static pages closer to how Vercel will serve them
(the API endpoints still won't run without `vercel dev`, which needs the Vercel CLI and a
connected database):

```bash
cd public
python3 -m http.server 8080
# open http://localhost:8080/index.html
```

## Running the logic tests

Plain-Node unit tests, no framework dependency:

```bash
npm test
```

This runs five suites: the Cutter Performance calculations (speed, attainment %, status
thresholds, KPI aggregation, the Day/Week/Month/Year/Custom period viewer), the browser-side
next2.db row mapping (checked against real data already extracted by `extract-next2.py`, to
confirm both paths produce the same output), the database layer (`api/_lib/db.js`'s query
construction — schema creation, since/until filtering, the upsert-and-replace transaction), and
the two API endpoints (`/api/publish-machine`, `/api/machines`, `/api/logs`) — all against a small
local stand-in for the `pg` package (`node_modules/pg/`, gitignored) rather than a real Postgres
database, so no credentials are needed to run these. Vercel installs the real `pg` package from
`package.json` at deploy time; this stand-in only exists so the test suite can run in an
environment without npm registry access.

## Deploying to your Vercel team ("warmish")

This folder deploys as a static site with zero configuration — Vercel auto-detects a plain
`public/index.html` project (Framework Preset: "Other").

**Option A — GitHub (recommended):**
1. Push this folder to a new GitHub repo.
2. In Vercel, under the `warmish` team → **Add New… → Project** → import that repo.
3. Leave build settings default (no build command needed) and deploy.

**Option B — Vercel CLI, from your own machine (where `npm`/`vercel` aren't network-restricted):**
```bash
npm i -g vercel
cd bee4stitch-web
vercel --scope warmish
vercel --prod --scope warmish
```

## Why static, not Next.js

The cloud sandbox this was built in has no outbound access to the npm registry (an org-level
network policy blocks it) — so I couldn't `npm install` anything here, and I don't build things I
can't verify. The site itself (everything under `public/`) is dependency-free HTML/CSS/JS, which I
*could* fully test end-to-end (headless-browser rendering, console-error checking, screenshots)
before handing it over. The one dependency in the whole project is `pg` (in `package.json`), used
only by the `api/` serverless functions for the Postgres database — Vercel installs that for real
at deploy time, the same way it would for any project; this sandbox never needed to install it,
since the tests here run against a small local stand-in instead (see "Running the logic tests").
It deploys to Vercel exactly as-is, no build step required for the site itself.

This isn't a dead end — your own machine and Vercel's own build servers both have normal npm
access, so migrating this to Next.js/React later (for a real component model, routing, and a
proper API layer) is a reasonable next step once this pilot proves out the direction.

## The real blocker to wire the rest of this up for real: your SQL Server

Cutter Performance now proves the *shape* of a real-data module works end-to-end (extract → JSON
→ page), but it did that via a one-time file extract, not a live connection. Vercel runs in the
cloud; Morgan MasterMind's SQL Server is presumably only reachable on your factory's local
network. A cloud-hosted app can't reach it directly without one of:

- **A tunnel/VPN** from Vercel's serverless functions to your network (e.g. Cloudflare Tunnel,
  Tailscale, a site-to-site VPN) — most direct, needs IT/network setup.
- **A small relay API** you host on your own network (or a VPS) that Vercel calls instead of the
  database directly — keeps the DB itself never exposed to the internet.
- **A synced read replica** in the cloud (e.g. Azure SQL) that mirrors the on-prem data on a
  schedule — simplest for reporting-style pages where near-real-time is fine.
- **A scheduled version of the same extract-and-publish pattern used here** — e.g. a machine on
  your network runs `extract-next2.py` (or a SQL Server equivalent) on a timer and pushes the JSON
  up to the deployed site. Cheapest to build, but data is only as fresh as the last run.

None of this is code I can decide for you — it depends on your network setup and how "live" the
data needs to be.

## Next steps

1. Finish "Setting up the cloud database" above if you haven't yet — that's what makes the Browse
   → Preview → Publish button on Cutter Performance actually go live, and what the live site's
   machine picker reads from.
2. **Re-publish Kay & Emms, Cutter #1** once the database is set up: the 3,777 rows that used to
   ship as a static file aren't automatically in the new database — browse to that same `next2.db`
   again (or run `extract-next2.py`/`refresh-and-publish.ps1` with `--publish-url`/`--publish-key`)
   to seed it in. After that, it's there for good, same as any other published machine.
3. Add your other customers' machines through the Browse → Preview → Publish button as you get to
   them.
4. Decide the SQL Server / live-data connectivity approach in "The real blocker" above (Cutter
   Performance can move from "extract-and-publish" to "always current" once this is picked).
5. Pick the next module to build for real (Production Summary is the next-most report-like
   screen).
6. Replace the login placeholder with real authentication, and consider hardening
   `/api/publish-machine`'s auth beyond the shared-secret header, once there's a proper backend.
