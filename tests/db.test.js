// Tests api/_lib/db.js's query-building logic against a stubbed 'pg' Client
// (see node_modules/pg/index.js — a local test-only stub, not the real
// package; Vercel installs the real one from package.json at deploy time).
// No real Postgres database needed to run these.
const assert = require("assert");

let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
    passed++;
  } catch (err) {
    console.error(`FAIL - ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

function freshDb(env = { DATABASE_URL: "postgres://fake" }) {
  const prevEnv = { ...process.env };
  Object.keys(process.env).forEach((k) => {
    if (/^(DATABASE_URL|POSTGRES_URL|POSTGRES_PRISMA_URL)$/.test(k)) delete process.env[k];
  });
  Object.assign(process.env, env);
  delete require.cache[require.resolve("../api/_lib/db")];
  const db = require("../api/_lib/db");
  return {
    db,
    restore: () => {
      process.env = prevEnv;
      delete require.cache[require.resolve("../api/_lib/db")];
    },
  };
}

(async () => {
  await test("connectionString() falls back through DATABASE_URL / POSTGRES_URL / POSTGRES_PRISMA_URL", () => {
    const { db, restore } = freshDb({ POSTGRES_URL: "postgres://from-vercel-storage" });
    try {
      assert.strictEqual(db.connectionString(), "postgres://from-vercel-storage");
    } finally {
      restore();
    }
  });

  await test("listMachines/getMachineLogs/replaceMachineLogs throw a clear error with no database connected", async () => {
    const { db, restore } = freshDb({});
    try {
      await assert.rejects(() => db.listMachines(), /No database connected yet/);
      await assert.rejects(() => db.getMachineLogs("x"), /No database connected yet/);
      await assert.rejects(() => db.replaceMachineLogs("x", "X", []), /No database connected yet/);
    } finally {
      restore();
    }
  });

  await test("listMachines() runs a plain SELECT and returns the rows as-is", async () => {
    const { db, restore } = freshDb();
    global.__PG_MOCK__ = {
      calls: [],
      handler(text) {
        if (/SELECT id, label FROM machines/.test(text)) {
          return { rows: [{ id: "a", label: "A" }, { id: "b", label: "B" }] };
        }
      },
    };
    try {
      const machines = await db.listMachines();
      assert.deepStrictEqual(machines, [{ id: "a", label: "A" }, { id: "b", label: "B" }]);
      // Schema is ensured first (3 CREATE/INDEX statements), then the SELECT.
      const selectCall = global.__PG_MOCK__.calls.find((c) => /SELECT id, label/.test(c.text));
      assert.ok(selectCall, "expected the machines SELECT to run");
    } finally {
      restore();
      delete global.__PG_MOCK__;
    }
  });

  await test("getMachineLogs() adds since/until as parameterized clauses only when given", async () => {
    const { db, restore } = freshDb();
    global.__PG_MOCK__ = {
      calls: [],
      handler(text) {
        if (/SELECT row FROM production_logs/.test(text)) return { rows: [{ row: { markerName: "MK-1" } }] };
      },
    };
    try {
      await db.getMachineLogs("m-1");
      let call = global.__PG_MOCK__.calls.find((c) => /SELECT row FROM/.test(c.text));
      assert.strictEqual(call.params.length, 1, "no since/until -> only machineId param");
      assert.ok(!/start_ts (>=|<)/.test(call.text), "no range filter clauses when since/until aren't given");

      global.__PG_MOCK__.calls = [];
      const rows = await db.getMachineLogs("m-1", { since: "2026-06-01", until: "2026-07-01" });
      assert.deepStrictEqual(rows, [{ markerName: "MK-1" }]);
      call = global.__PG_MOCK__.calls.find((c) => /SELECT row FROM/.test(c.text));
      assert.strictEqual(call.params.length, 3, "machineId + since + until");
      assert.ok(/start_ts >= \$2/.test(call.text));
      assert.ok(/start_ts < \$3/.test(call.text));
    } finally {
      restore();
      delete global.__PG_MOCK__;
    }
  });

  await test("replaceMachineLogs() upserts the machine, deletes old rows, then inserts new ones inside a transaction", async () => {
    const { db, restore } = freshDb();
    global.__PG_MOCK__ = { calls: [] };
    try {
      const rows = [
        { markerName: "MK-1", start: "2026-06-01T08:00:00", end: "2026-06-01T08:30:00" },
        { markerName: "MK-2", start: "2026-06-02T08:00:00", end: "2026-06-02T08:30:00" },
      ];
      await db.replaceMachineLogs("m-1", "Machine One", rows);

      const texts = global.__PG_MOCK__.calls.map((c) => c.text);
      assert.ok(texts.some((t) => t === "BEGIN"), "should BEGIN a transaction");
      assert.ok(texts.some((t) => /INSERT INTO machines/.test(t)), "should upsert the machine row");
      assert.ok(texts.some((t) => /DELETE FROM production_logs WHERE machine_id = \$1/.test(t)), "should clear old rows first");
      const insertLogs = global.__PG_MOCK__.calls.find((c) => /INSERT INTO production_logs/.test(c.text));
      assert.ok(insertLogs, "should insert the new rows");
      assert.strictEqual(insertLogs.params.length, rows.length * 4, "4 params per row (machine_id, start, end, row json)");
      assert.strictEqual(insertLogs.params[0], "m-1");
      assert.ok(insertLogs.params[3].includes("MK-1"), "row json should be serialized");
      assert.ok(texts.some((t) => t === "COMMIT"), "should COMMIT on success");
    } finally {
      restore();
      delete global.__PG_MOCK__;
    }
  });

  await test("replaceMachineLogs() rolls back and rethrows if an insert fails", async () => {
    const { db, restore } = freshDb();
    global.__PG_MOCK__ = {
      calls: [],
      handler(text) {
        if (/INSERT INTO production_logs/.test(text)) throw new Error("simulated insert failure");
      },
    };
    try {
      await assert.rejects(
        () => db.replaceMachineLogs("m-1", "Machine One", [{ markerName: "MK-1", start: "2026-06-01T08:00:00", end: "2026-06-01T08:30:00" }]),
        /simulated insert failure/
      );
      const texts = global.__PG_MOCK__.calls.map((c) => c.text);
      assert.ok(texts.includes("ROLLBACK"), "should ROLLBACK after the failed insert");
      assert.ok(!texts.includes("COMMIT"), "should not COMMIT after a failure");
    } finally {
      restore();
      delete global.__PG_MOCK__;
    }
  });

  console.log(`\n${passed} test(s) passed.`);
})();
