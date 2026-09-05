// Thin Postgres wrapper for the Cutter Performance cloud database.
//
// Works with any Postgres-compatible connection string Vercel exposes once
// you connect a database to this project (Project -> Storage -> Create
// Database -> Postgres): it sets one of DATABASE_URL / POSTGRES_URL /
// POSTGRES_PRISMA_URL automatically, no manual configuration needed beyond
// that click-through. See README "Setting up the cloud database".
//
// Schema is created lazily (CREATE TABLE IF NOT EXISTS) the first time any
// endpoint touches the database, so there's no separate migration step to
// run by hand.
//
// One row per production-log entry is stored as JSONB (the exact same shape
// next2-browser-reader.js/extract-next2.py have always produced), plus
// start_ts/end_ts as real columns so date-range queries can use an index
// instead of scanning and parsing JSON. This keeps every existing
// client-side rendering/KPI/period-filter function working unchanged — it's
// still handed the same row objects it always was, just fetched from an API
// instead of a script tag.
const { Client } = require("pg");

function connectionString() {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL || null;
}

async function withClient(fn) {
  const cs = connectionString();
  if (!cs) {
    throw new Error(
      "No database connected yet — go to this Vercel project's Storage tab, create a Postgres database, and " +
        "connect it to this project (that sets DATABASE_URL/POSTGRES_URL automatically). See the README's " +
        '"Setting up the cloud database" section.'
    );
  }
  const client = new Client({ connectionString: cs, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function ensureSchema(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS machines (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS production_logs (
      id BIGSERIAL PRIMARY KEY,
      machine_id TEXT NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
      start_ts TIMESTAMP NOT NULL,
      end_ts TIMESTAMP NOT NULL,
      row JSONB NOT NULL
    );
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_logs_machine_start ON production_logs (machine_id, start_ts);`);
}

async function listMachines() {
  return withClient(async (client) => {
    await ensureSchema(client);
    const { rows } = await client.query("SELECT id, label FROM machines ORDER BY label ASC");
    return rows;
  });
}

// Optional since/until: "YYYY-MM-DD" or ISO strings, filtered on start_ts.
async function getMachineLogs(machineId, { since, until } = {}) {
  return withClient(async (client) => {
    await ensureSchema(client);
    const clauses = ["machine_id = $1"];
    const params = [machineId];
    if (since) {
      params.push(since);
      clauses.push(`start_ts >= $${params.length}`);
    }
    if (until) {
      params.push(until);
      clauses.push(`start_ts < $${params.length}`);
    }
    const { rows } = await client.query(
      `SELECT row FROM production_logs WHERE ${clauses.join(" AND ")} ORDER BY start_ts ASC`,
      params
    );
    return rows.map((r) => r.row);
  });
}

// Replaces ALL of one machine's rows in a single transaction — matches the
// existing "re-publishing updates that machine's data in place" semantics
// (previously done by overwriting one GitHub file; same idea, same table).
async function replaceMachineLogs(machineId, machineLabel, rows) {
  return withClient(async (client) => {
    await ensureSchema(client);
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO machines (id, label, updated_at) VALUES ($1, $2, now())
         ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, updated_at = now()`,
        [machineId, machineLabel]
      );
      await client.query("DELETE FROM production_logs WHERE machine_id = $1", [machineId]);

      const CHUNK = 500; // keep each statement's parameter count well under Postgres's limit
      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK);
        const placeholders = [];
        const params = [];
        chunk.forEach((row, idx) => {
          const base = idx * 4;
          placeholders.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`);
          params.push(machineId, new Date(row.start), new Date(row.end), JSON.stringify(row));
        });
        await client.query(
          `INSERT INTO production_logs (machine_id, start_ts, end_ts, row) VALUES ${placeholders.join(", ")}`,
          params
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    }
  });
}

module.exports = { listMachines, getMachineLogs, replaceMachineLogs, connectionString };
