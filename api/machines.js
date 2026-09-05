// GET /api/machines — every machine published so far (id + display label),
// for the Cutter Performance page's machine picker. Reads from the cloud
// database — see api/_lib/db.js.
const { listMachines } = require("./_lib/db");

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Use GET." });
    return;
  }
  try {
    const machines = await listMachines();
    res.status(200).json({ machines });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: err.message });
  }
};
