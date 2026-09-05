// Registry of next2.db extracts available to the Cutter Performance page.
//
// Format note: everything to the right of "= " up to the trailing ";" must
// stay valid JSON (double-quoted keys/strings, no trailing commas, no
// comments inside the array) — /api/publish-machine.js parses and rewrites
// just that JSON slice with JSON.parse/JSON.stringify when a new customer
// is published from the browser's Browse button, without needing a JS
// engine server-side. Hand-editing this file is fine (e.g. to fix a label)
// as long as that slice stays valid JSON.
window.__BEE4STITCH_DATA__ = window.__BEE4STITCH_DATA__ || {};
window.__BEE4STITCH_DATA__.machines = [
  {
    "id": "kay-emms-1",
    "label": "Kay & Emms – Cutter #1",
    "url": "data/next2-kay-emms-cutter1.js"
  }
];
