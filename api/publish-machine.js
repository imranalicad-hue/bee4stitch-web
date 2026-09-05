// POST /api/publish-machine — receives rows already extracted client-side
// from a next2.db (see public/next2-browser-reader.js) and commits them to
// this repo via the GitHub Contents API: public/data/next2-<id>.js (the new
// machine's data) and public/data/machines.js (the registry the Cutter
// Performance page's machine picker reads). If this repo is connected to
// Vercel via its GitHub integration, that commit triggers a normal
// automatic redeploy — same as pushing from git yourself.
//
// One-time setup required (see README "Setting up automatic publish"):
//   GITHUB_TOKEN    - a GitHub personal access token with contents:write on this repo
//   GITHUB_OWNER    - the repo owner, e.g. "your-github-username"
//   GITHUB_REPO     - the repo name, e.g. "bee4stitch-web"
//   GITHUB_BRANCH   - optional, defaults to "main"
//   PUBLISH_SECRET  - a passphrase the browser must send back (X-Publish-Key
//                     header) — a soft gate against random internet
//                     traffic hitting this endpoint, same posture as the
//                     site's login screen, NOT hardened security.
//
// No npm dependencies — uses the Node runtime's built-in fetch and Buffer.

const { getFile, putFile } = require("./_lib/github");
const { buildMachineDataFile, parseMachinesFile, buildMachinesFile, upsertMachine, dataFilePath } = require("./_lib/publishFormat");

const MACHINES_PATH = "public/data/machines.js";
const MAX_ROWS = 200000; // generous — a few years of one machine's history is a few thousand rows

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST." });
    return;
  }

  const { GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH, PUBLISH_SECRET } = process.env;
  if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO || !PUBLISH_SECRET) {
    res.status(500).json({
      error:
        "This endpoint isn't configured yet — GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO and PUBLISH_SECRET need to " +
        "be set as Vercel environment variables first. See the README's \"Setting up automatic publish\" section.",
    });
    return;
  }
  const branch = GITHUB_BRANCH || "main";

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

  const gh = { token: GITHUB_TOKEN, owner: GITHUB_OWNER, repo: GITHUB_REPO, branch };
  const dataPath = dataFilePath(machineId);

  try {
    // 1. Write the machine's data file (create or update).
    const existingData = await getFile({ ...gh, path: dataPath });
    await putFile({
      ...gh,
      path: dataPath,
      content: buildMachineDataFile(machineId, rows),
      message: `Update ${machineLabel} cutter performance data (${rows.length.toLocaleString()} rows)`,
      sha: existingData ? existingData.sha : undefined,
    });

    // 2. Upsert the machines registry so the new/updated machine shows up
    //    in the page's picker.
    const existingMachinesFile = await getFile({ ...gh, path: MACHINES_PATH });
    const currentMachines = existingMachinesFile ? parseMachinesFile(existingMachinesFile.content) : [];
    const nextMachines = upsertMachine(currentMachines, {
      id: machineId,
      label: machineLabel,
      url: `data/next2-${machineId}.js`,
    });
    await putFile({
      ...gh,
      path: MACHINES_PATH,
      content: buildMachinesFile(nextMachines),
      message: `Register ${machineLabel} in the Cutter Performance machine picker`,
      sha: existingMachinesFile ? existingMachinesFile.sha : undefined,
    });

    res.status(200).json({ ok: true, machineId, rowCount: rows.length });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: `GitHub publish failed: ${err.message}` });
  }
};
