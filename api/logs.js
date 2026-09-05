// GET /api/logs?machineId=<id>[&since=YYYY-MM-DD][&until=YYYY-MM-DD] —
// production log rows for one machine, read live from the cloud database.
// Returns the same row shape next2-browser-reader.js/extract-next2.py have
// always produced (markerName, order, start, end, usedMin, perimeterM, …),
// so the page's existing rendering/KPI/period-filter code needs no changes
// beyond how it fetches this data.
const { getMachineLogs } = require("./_lib/db");

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Use GET." });
    return;
  }
  const { machineId, since, until } = req.query || {};
  if (typeof machineId !== "string" || !machineId) {
    res.status(400).json({ error: "machineId query parameter is required." });
    return;
  }
  try {
    const rows = await getMachineLogs(machineId, { since, until });
    res.status(200).json({ machineId, rows });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: err.message });
  }
};
