# Bee4Stitch Web (preview)

A first working slice of a web version of the Bee4Stitch desktop app (Jezseem-Traders), built and
verified in this session. It's a static site — no build step, no framework, no npm dependency —
by design (see "Why static, not Next.js" below), plus one small serverless function
(`api/publish-machine.js`, also dependency-free) that lets Cutter Performance's Browse button
publish new customer data straight to your live Vercel deployment.

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
    saves it and pushes it live on your Vercel deployment, automatically. See "Adding a customer:
    Browse → Preview → Publish" below, and "Setting up automatic publish" for the one-time setup
    it needs.
  - Currently loaded: 3,777 real production-log rows from Kay & Emms, Cutter #1 (last ~3 months),
    originally extracted with `extract-next2.py`. The machine picker in the page's header lists
    every customer published so far.
  - Same 8 KPI tiles, same production-log columns, same speed-attainment formula and performance
    thresholds (Critical / Below target / On target / Review over-speed) as the desktop app's
    `frmCutterPerformanceDashboard.vb` / `CutterPerformanceTrendBuilder.vb` — verified against the
    actual VB source, not guessed. The one deliberate simplification: the desktop app derives
    idle/delay time from live machine telemetry; this extract uses `next2.db`'s own `IdleTime`
    column directly.
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
   up automatic publish" below) and click **Publish to Vercel**. This sends just the extracted
   rows (not the database file itself) to the site's own `/api/publish-machine` endpoint, which
   commits them to this project's GitHub repo — that commit is what Vercel picks up and
   auto-redeploys, the same as if you'd pushed with git yourself. Reload the page in about a
   minute and the new machine is in the picker for everyone.

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

## Setting up automatic publish (one-time)

The Publish button needs this project connected to GitHub with a couple of secrets configured in
Vercel — about 10 minutes, done once per Vercel project:

1. **Push this folder to GitHub**, if it isn't already (see "Deploying to your Vercel team" below
   for the Vercel side of this).
2. **Create a GitHub personal access token** with write access to just this repo:
   GitHub → Settings → Developer settings → **Fine-grained tokens** → Generate new token.
   - Repository access: **Only select repositories** → pick this repo.
   - Permissions: **Contents → Read and write**. Nothing else is needed.
   - Copy the token now — GitHub only shows it once.
3. **Add environment variables** in your Vercel project: Vercel dashboard → this project →
   Settings → Environment Variables. Add:
   | Name | Value |
   |---|---|
   | `GITHUB_TOKEN` | the token from step 2 |
   | `GITHUB_OWNER` | your GitHub username or org (e.g. `warmish`) |
   | `GITHUB_REPO` | the repo name (e.g. `bee4stitch-web`) |
   | `GITHUB_BRANCH` | optional — defaults to `main` if omitted |
   | `PUBLISH_SECRET` | a passphrase you make up — this is what you'll type into the Publish key field on the page |

   Redeploy once after adding these (Vercel → Deployments → ⋯ → Redeploy) so the function picks
   them up.
4. Share the `PUBLISH_SECRET` value with whoever should be able to publish new customers — it's
   the same soft-gate posture as the site's login screen (see "About the login" above), **not
   hardened security**. Anyone with it can write to `public/data/` in your repo through this
   endpoint; it's meant to keep the button from being usable by a random visitor, not to withstand
   a determined attacker. Rotate it in Vercel's environment variables if it ever leaks.

Until this is set up, Preview still works (it's entirely client-side), but clicking Publish
returns a clear "not configured yet" message instead of failing silently.

## Updating Cutter Performance data without the browser (scripted)

The Browse → Preview → Publish flow above is the normal path. This is the scripted equivalent —
useful for automating a refresh (e.g. a scheduled task on a machine that has direct access to
several customers' `next2.db` files) without a person clicking through the page each time.

**Manual (extract only), any OS:**
```bash
python3 extract-next2.py "<path-to-next2.db>" "<machine-id>" "<machine label>" public/data/next2-<name>.js --since 2026-06-01
```
`<machine-id>` is the key the web page looks up, separate from the display label — reuse an
existing id (see `public/data/machines.js`) to update that machine, or invent a new short
lowercase-hyphenated one to add a customer. This only *reads* `ProductionLogs` from `next2.db` —
it never modifies the source database. For a new machine, also add a matching entry to
`public/data/machines.js` by hand (or just use the in-browser Publish button instead, which does
this step for you). Either way, redeploy the site however you normally do (git push, or
`vercel --prod`). Note the output is a `.js` file, not `.json` — see "Running it locally" below for
why.

**One step (extract + publish), Windows / PowerShell:**
```powershell
.\refresh-and-publish.ps1 `
  -Next2DbPath "D:\Documents\Data Jezseem Traders\ERP Development\Morgan Cutter\Kay & Emms\Next 2 90 (Cutter # 1)\xt2cache\next2.db" `
  -MachineId "kay-emms-1" `
  -MachineLabel "Kay & Emms – Cutter #1" `
  -OutFile "public\data\next2-kay-emms-cutter1.js" `
  -Since 2026-06-01 `
  -Deploy
```
Needs Python 3 on PATH (only for `sqlite3`, which ships in Python's standard library — no `pip
install` required). With `-Deploy`, it pushes to git if this folder is a repo with a remote
(Vercel's GitHub integration redeploys automatically), otherwise runs `vercel --prod` if the
Vercel CLI is installed. Without `-Deploy`, it only refreshes the local data file.

Either way, the actual publish step still needs this project connected to GitHub+Vercel or the
Vercel CLI set up on a machine with normal internet access — see "Deploying to your Vercel team"
below if that isn't done yet.

## Running it locally

Just open `public/index.html` — double-clicking it works, no local server required.

That's deliberate: browsers block `fetch()`/AJAX of local files when a page is opened directly
from disk (`file://`), which is what made an earlier version of this app look broken when opened
that way — data would silently fail to load. To avoid that entirely, every data file under
`public/data/` is a small `.js` file that assigns into `window.__BEE4STITCH_DATA__` and is loaded
with a plain `<script src="...">` tag instead of `fetch()` — script tags aren't subject to that
`file://` restriction, so this works with no server at all. See the comment at the top of
`public/app.js` for the details. `extract-next2.py` and `refresh-and-publish.ps1` already produce
data in this `.js` format.

A local server still works fine too, if you prefer it (e.g. for testing something closer to how
Vercel will serve it):

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

This runs three suites: the Cutter Performance calculations (speed, attainment %, status
thresholds, KPI aggregation), the browser-side next2.db row mapping (checked against real data
already extracted by `extract-next2.py`, to confirm both paths produce the same output), and
`/api/publish-machine`'s request validation and GitHub API call construction (with `fetch` mocked
— no real GitHub repo or credentials needed to run these).

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
can't verify. I built this as dependency-free HTML/CSS/JS instead, which I *could* fully test
end-to-end (headless-browser rendering, console-error checking, screenshots) before handing it
over. It deploys to Vercel exactly as-is, no build step required.

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

1. Finish "Setting up automatic publish" above if you haven't yet — that's what makes the Browse →
   Preview → Publish button on Cutter Performance actually go live.
2. Add your other customers' machines through that button as you get to them.
3. Decide the SQL Server / live-data connectivity approach in "The real blocker" above (Cutter
   Performance can move from "extract-and-publish" to "always current" once this is picked).
4. Pick the next module to build for real (Production Summary is the next-most report-like
   screen).
5. Replace the login placeholder with real authentication, and consider hardening
   `/api/publish-machine`'s auth beyond the shared-secret header, once there's a proper backend.
