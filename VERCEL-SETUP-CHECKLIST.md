# Getting Publish working on Vercel — setup checklist

This is what's needed so the **Publish to Vercel** button on the Cutter Performance page actually
works. It only needs to be done once per Vercel project. Preview (Browse + see the data) already
works today without any of this — it's only the "save it live for everyone" step that needs a
database behind it.

Do these in order. Total time: about 5 minutes.

## Already done ✅

- **Repo pushed to GitHub**: `imranalicad-hue/bee4stitch-web`.
- **Connected to Vercel**: project `bee4stitch` under the `warmish` team, deployed and live at
  `bee4stitch.vercel.app`.

If either of those ever needs redoing (a fresh repo, a different Vercel project), see the README's
"Deploying to your Vercel team" section — the steps below assume they're already in place.

## Step 1 — Create the cloud database

1. In Vercel, open the `bee4stitch` project → **Storage** tab → **Create Database**.
2. Choose **Postgres** (Vercel's own Postgres offering, powered by Neon).
3. Follow the prompts to create it, and make sure it's **connected to this project** (Vercel asks
   this as part of the flow — say yes).
4. That's it — no connection string to copy anywhere. Vercel automatically sets the
   `DATABASE_URL`/`POSTGRES_URL` environment variable(s) the site's API functions read from.

## Step 2 — Add the publish key

1. Same project → **Settings → Environment Variables**.
2. Add `PUBLISH_SECRET` with a passphrase you make up — this is what gets typed into the "Publish
   key" field on the page. No GitHub token needed for any of this anymore.

## Step 3 — Redeploy

**Deployments** tab → ⋯ on the latest deployment → **Redeploy**, so the API functions pick up the
new database connection and `PUBLISH_SECRET`. Environment variables added after a deploy don't
apply retroactively.

## Step 4 — Re-publish the Kay & Emms data

The 3,777 rows that used to ship as a file in the repo aren't automatically in the new database —
it starts empty. Browse to that same `next2.db` again through the page (or run
`extract-next2.py`/`refresh-and-publish.ps1` with `--publish-url`/`--publish-key`, see the README)
to seed it back in. After that it's there for good, same as any other published machine.

## Step 5 — Try it on the live site

1. Open `https://bee4stitch.vercel.app` (not a local double-clicked file) and sign in.
2. Go to Cutter Performance → "Add or update a customer".
3. Browse to a `next2.db`, click Preview, check the numbers look right.
4. Type the `PUBLISH_SECRET` from Step 2 into the Publish key field, click **Publish to Vercel**.
5. It should show a success message immediately — no redeploy wait this time, since it's a
   database write, not a file commit. Reload the page and the new machine is in the picker.

## If Publish still fails on the live site

- **"No database connected yet"** → Step 1 wasn't finished, or the redeploy in Step 3 hasn't
  happened since.
- **"isn't configured yet" (about PUBLISH_SECRET)** → Step 2's environment variable is missing, or
  needs that redeploy too.
- **"unauthorized" / key rejected** → the Publish key typed on the page doesn't match
  `PUBLISH_SECRET` in Vercel.
- **Still stuck** → open the browser's dev tools (F12) → Console/Network tab while clicking
  Publish, and share what error shows up.

## Quick reference: local file vs. live site

| | Double-clicked `index.html` | Deployed on Vercel |
|---|---|---|
| Browse a `next2.db` | ✅ works (all in-browser) | ✅ works |
| Preview the data | ✅ works | ✅ works |
| View already-published machines | ❌ no server to fetch from | ✅ works |
| Publish (save it live for everyone) | ❌ no server to publish to | ✅ works, once Steps 1–3 above are done |

This matches the "Setting up the cloud database" section in `README.md` — this file is just that
same setup as a straight top-to-bottom checklist.
