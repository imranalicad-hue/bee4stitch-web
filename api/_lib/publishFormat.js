// Shared helpers for reading/writing the two file formats
// /api/publish-machine.js touches: a per-machine data file
// (public/data/next2-<id>.js) and the shared registry
// (public/data/machines.js). Both are plain .js files that assign into
// window.__BEE4STITCH_DATA__ — see the comment atop public/app.js for why
// (it's what lets the site load with a plain double-click, no server).
//
// No dependencies — this runs in a Vercel Node serverless function, which
// deliberately has zero npm packages to install (see README "Why static,
// not Next.js").

const MACHINES_ARRAY_RE = /window\.__BEE4STITCH_DATA__\.machines\s*=\s*(\[[\s\S]*?\]);/;

function buildMachineDataFile(machineId, rows) {
  return (
    "window.__BEE4STITCH_DATA__ = window.__BEE4STITCH_DATA__ || {};\n" +
    "window.__BEE4STITCH_DATA__.next2 = window.__BEE4STITCH_DATA__.next2 || {};\n" +
    `window.__BEE4STITCH_DATA__.next2[${JSON.stringify(machineId)}] = ${JSON.stringify(rows)};\n`
  );
}

function parseMachinesFile(text) {
  const m = MACHINES_ARRAY_RE.exec(text);
  if (!m) {
    throw new Error(
      "public/data/machines.js doesn't match the expected format (a window.__BEE4STITCH_DATA__.machines = [...] " +
        "assignment with valid JSON inside) — it may have been hand-edited into an incompatible shape."
    );
  }
  return JSON.parse(m[1]);
}

function buildMachinesFile(machines) {
  return (
    "// Registry of next2.db extracts available to the Cutter Performance page.\n" +
    "// Generated/updated by /api/publish-machine.js — see that file's format note\n" +
    "// before hand-editing this one.\n" +
    "window.__BEE4STITCH_DATA__ = window.__BEE4STITCH_DATA__ || {};\n" +
    `window.__BEE4STITCH_DATA__.machines = ${JSON.stringify(machines, null, 2)};\n`
  );
}

// Adds `entry` to `machines`, replacing any existing entry with the same id
// (so re-publishing the same machine updates its label/url in place instead
// of duplicating it). New entries are appended at the end.
function upsertMachine(machines, entry) {
  const idx = machines.findIndex((m) => m.id === entry.id);
  if (idx === -1) return [...machines, entry];
  const next = machines.slice();
  next[idx] = entry;
  return next;
}

function dataFilePath(machineId) {
  return `public/data/next2-${machineId}.js`;
}

module.exports = { buildMachineDataFile, parseMachinesFile, buildMachinesFile, upsertMachine, dataFilePath };
