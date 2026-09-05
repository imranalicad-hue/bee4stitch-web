// Tests /api/publish-machine.js's auth, validation, and its call into the
// cloud database (api/_lib/db.js) — using the stubbed 'pg' Client (see
// node_modules/pg/index.js). No real Postgres database needed.
const assert = require("assert");

let passed = 0;
async function asyncTest(name, fn) {
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

function mockRes() {
  const res = { statusCode: null, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  return res;
}

async function run(handler, req) {
  const res = mockRes();
  await handler(req, res);
  return res;
}

const withEnv = async (env, fn) => {
  const prev = { ...process.env };
  Object.assign(process.env, env);
  delete require.cache[require.resolve("../api/publish-machine")];
  delete require.cache[require.resolve("../api/_lib/db")];
  try {
    await fn(require("../api/publish-machine"));
  } finally {
    process.env = prev;
    delete require.cache[require.resolve("../api/publish-machine")];
    delete require.cache[require.resolve("../api/_lib/db")];
  }
};

(async () => {
  await asyncTest("rejects non-POST requests", async () => {
    await withEnv({ DATABASE_URL: "postgres://fake", PUBLISH_SECRET: "s" }, async (handler) => {
      const res = await run(handler, { method: "GET", headers: {} });
      assert.strictEqual(res.statusCode, 405);
    });
  });

  await asyncTest("500s with a clear message when PUBLISH_SECRET isn't configured yet", async () => {
    await withEnv({ DATABASE_URL: "postgres://fake", PUBLISH_SECRET: "" }, async (handler) => {
      const res = await run(handler, { method: "POST", headers: {}, body: {} });
      assert.strictEqual(res.statusCode, 500);
      assert.ok(/isn't configured yet/.test(res.body.error));
    });
  });

  await asyncTest("401s on a missing or wrong publish key", async () => {
    await withEnv({ DATABASE_URL: "postgres://fake", PUBLISH_SECRET: "correct-secret" }, async (handler) => {
      const res = await run(handler, { method: "POST", headers: { "x-publish-key": "wrong" }, body: {} });
      assert.strictEqual(res.statusCode, 401);
    });
  });

  await asyncTest("400s on an invalid machineId", async () => {
    await withEnv({ DATABASE_URL: "postgres://fake", PUBLISH_SECRET: "s" }, async (handler) => {
      const res = await run(handler, {
        method: "POST",
        headers: { "x-publish-key": "s" },
        body: { machineId: "Not Valid!", machineLabel: "X", rows: [{}] },
      });
      assert.strictEqual(res.statusCode, 400);
    });
  });

  await asyncTest("400s on empty rows", async () => {
    await withEnv({ DATABASE_URL: "postgres://fake", PUBLISH_SECRET: "s" }, async (handler) => {
      const res = await run(handler, {
        method: "POST",
        headers: { "x-publish-key": "s" },
        body: { machineId: "x-1", machineLabel: "X", rows: [] },
      });
      assert.strictEqual(res.statusCode, 400);
    });
  });

  await asyncTest("502s with the database's own error when no database is connected yet", async () => {
    await withEnv({ PUBLISH_SECRET: "s" }, async (handler) => {
      // No DATABASE_URL/POSTGRES_URL set at all.
      const res = await run(handler, {
        method: "POST",
        headers: { "x-publish-key": "s" },
        body: { machineId: "x-1", machineLabel: "X", rows: [{ markerName: "MK-1" }] },
      });
      assert.strictEqual(res.statusCode, 502);
      assert.ok(/No database connected yet/.test(res.body.error));
    });
  });

  await asyncTest("valid request saves to the database via replaceMachineLogs and returns 200", async () => {
    global.__PG_MOCK__ = { calls: [] };
    try {
      await withEnv({ DATABASE_URL: "postgres://fake", PUBLISH_SECRET: "s" }, async (handler) => {
        const rows = [
          { markerName: "MK-1", usedMin: 12.5, machine: "J-Tex – Cutter #1", start: "2026-06-01T08:00:00", end: "2026-06-01T08:30:00" },
        ];
        const res = await run(handler, {
          method: "POST",
          headers: { "x-publish-key": "s" },
          body: { machineId: "j-tex-1", machineLabel: "J-Tex – Cutter #1", rows },
        });
        assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
        assert.strictEqual(res.body.ok, true);
        assert.strictEqual(res.body.rowCount, 1);
      });

      const texts = global.__PG_MOCK__.calls.map((c) => c.text);
      assert.ok(texts.some((t) => /INSERT INTO machines/.test(t)), "should upsert the machine");
      const machineUpsert = global.__PG_MOCK__.calls.find((c) => /INSERT INTO machines/.test(c.text));
      assert.deepStrictEqual(machineUpsert.params.slice(0, 2), ["j-tex-1", "J-Tex – Cutter #1"]);
      assert.ok(texts.some((t) => /INSERT INTO production_logs/.test(t)), "should insert the row");
      assert.ok(texts.some((t) => t === "COMMIT"), "should commit");
    } finally {
      delete global.__PG_MOCK__;
    }
  });

  console.log(`\n${passed} test(s) passed.`);
})();
