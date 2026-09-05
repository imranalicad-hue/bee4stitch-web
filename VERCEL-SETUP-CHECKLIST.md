# Getting Publish working on Vercel — setup checklist

This is what's needed so the **Publish to Vercel** button on the Cutter Performance page actually
works. It only needs to be done once per Vercel project. Preview (Browse + see the data) already
works today without any of this — it's only the "make it live for everyone" step that needs a
backend behind it.

Do these in order. Total time: about 10 minutes.

## Why Publish isn't working yet

Right now you're opening `index.html` by double-clicking it on your own PC. That's a local file —
there's no server behind it, so there's nothing for the Publish button to talk to. Preview still
works because reading the `.db` file happens entirely in your browser, no server involved. Publish
needs the site to actually be deployed to Vercel, with the two steps below wired up.

## Step 1 — Get this folder into a GitHub repo

If it's not already in one:

1. Create a new (private is fine) repo on GitHub, e.g. `bee4stitch-web`.
2. Push this whole folder to it (standard `git init` / `git add` / `git commit` / `git push`, or
   GitHub Desktop if you prefer a GUI).

## Step 2 — Deploy that repo to your Vercel team ("warmish")

1. In Vercel, under the `warmish` team: **Add New… → Project** → import the GitHub repo from
   Step 1.
2. Leave build settings on their defaults — no build command needed, Vercel auto-detects the
   `public/` folder. Click **Deploy**.
3. Once it finishes, you'll have a live URL (something like `bee4stitch-web.vercel.app`). That's
   the link to actually share/use going forward, instead of double-clicking the file.

## Step 3 — Create a GitHub token so the site can commit new data

The Publish button needs permission to write files into your repo (that's how "live" data updates
happen — a normal git commit that Vercel then redeploys).

1. On GitHub: **Settings → Developer settings → Personal access tokens → Fine-grained tokens →
   Generate new token**.
2. **Repository access:** "Only select repositories" → pick the repo from Step 1.
3. **Permissions:** Contents → **Read and write**. Nothing else.
4. Generate it and **copy the token immediately** — GitHub only shows it once.

## Step 4 — Add environment variables in Vercel

In Vercel: your project → **Settings → Environment Variables**. Add these five:

| Name | Value |
|---|---|
| `GITHUB_TOKEN` | the token from Step 3 |
| `GITHUB_OWNER` | your GitHub username or org (e.g. `warmish`) |
| `GITHUB_REPO` | the repo name from Step 1 (e.g. `bee4stitch-web`) |
| `GITHUB_BRANCH` | optional — leave blank, it defaults to `main` |
| `PUBLISH_SECRET` | make up a passphrase — this is what gets typed into the "Publish key" field on the page |

Then **redeploy once** (Deployments tab → ⋯ on the latest deployment → Redeploy), so the new
environment variables actually get picked up. Environment variables added after a deploy don't
apply retroactively.

## Step 5 — Try it on the live site

1. Open your live Vercel URL (not the local file) and sign in.
2. Go to Cutter Performance → "Add or update a customer".
3. Browse to a `next2.db`, click Preview, check the numbers look right.
4. Type the `PUBLISH_SECRET` from Step 4 into the Publish key field, click **Publish to Vercel**.
5. It should show a success message. Give it about a minute (Vercel needs to redeploy after the
   commit), then reload the page — the new machine should be in the picker.

## If Publish still fails on the live site

- **"not configured yet" message** → one of the five environment variables in Step 4 is missing
  or the redeploy hasn't happened yet.
- **"unauthorized" / key rejected** → the Publish key typed on the page doesn't match
  `PUBLISH_SECRET` in Vercel.
- **GitHub API error** → the token from Step 3 may have expired, been revoked, or not have write
  access to the right repo — re-check Step 3.
- **Still stuck** → open the browser's dev tools (F12) → Console/Network tab while clicking
  Publish, and share what error shows up.

## Quick reference: local file vs. live site

| | Double-clicked `index.html` | Deployed on Vercel |
|---|---|---|
| Browse a `next2.db` | ✅ works (all in-browser) | ✅ works |
| Preview the data | ✅ works | ✅ works |
| Publish (save it live for everyone) | ❌ no server to publish to | ✅ works, once Steps 1–4 above are done |

This matches the "Setting up automatic publish (one-time)" section in `README.md` — this file is
just that same setup as a straight top-to-bottom checklist.
