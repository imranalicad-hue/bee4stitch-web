// POST /api/publish-machine — receives rows already extracted client-side
// from a next2.db (see public/next2-browser-reader.js) and saves them to
// this project's cloud database (Postgres), so anyone who opens the live
// site immediately sees them — no GitHub commit, no redeploy wait, and no
// re-upload needed by anyone else who just wants to view the data.
//
// One-time setup required (see README "Setting up the cloud database"):
//   A Postgres database connected to this Vercel project (Storage tab ->
//   Create Database -> Postgres) — that sets DATABASE_URL/POSTGRES_URL
//   automatically, no manual connection string needed.
//   PUBLISH_SECRET  - a passphrase the browser must send back (X-Publish-Key
//                     header) — a soft gate against random internet traffic
//                     hitting this endpoint, same posture as the site's
//                     login screen, NOT hardened security.

const { replaceMachineLogs } = require("./_lib/db");

const MAX_ROWS = 200000; // generous — a few years of one machine's history is a few thousand rows

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST." });
    return;
  }

  const { PUBLISH_SECRET } = process.env;
  if (!PUBLISH_SECRET) {
    res.status(500).json({
      error:
        "This endpoint isn't configured yet — PUBLISH_SECRET needs to be set as a Vercel environment variable. " +
        'See the README\'s "Setting up the cloud database" section.',
    });
    return;
  }

  const providedKey = req.headers["x-publish-key"];
  if (!providedKey || providedKey !== PUBLISH_SECRET) {
    res.status(401).json({ error: "Missing or incorrect publish key." });
    return;
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch (e) {
      res.status(400).json({ error: "Request body isn't valid JSON." });
      return;
    }
  }
  if (!body || typeof body !== "object") {
    res.status(400).json({ error: "Missing request body." });
    return;
  }

  const { machineId, machineLabel, rows } = body;
  if (typeof machineId !== "string" || !/^[a-z0-9-]+$/.test(machineId)) {
    res.status(400).json({ error: "machineId must be lowercase letters, numbers and hyphens only." });
    return;
  }
  if (typeof machineLabel !== "string" || !machineLabel.trim()) {
    res.status(400).json({ error: "machineLabel is required." });
    return;
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    res.status(400).json({ error: "rows must be a non-empty array." });
    return;
  }
  if (rows.length > MAX_ROWS) {
    res.status(400).json({ error: `Too many rows (${rows.length}) — narrow the "Since" date and try again.` });
    return;
  }

  try {
    await replaceMachineLogs(machineId, machineLabel.trim(), rows);
    res.status(200).json({ ok: true, machineId, rowCount: rows.length });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: `Database publish failed: ${err.message}` });
  }
};
