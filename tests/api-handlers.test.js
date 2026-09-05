// Tests /api/machines.js and /api/logs.js — thin HTTP wrappers around
// api/_lib/db.js — using the stubbed 'pg' Client (node_modules/pg/index.js).
// No real Postgres database needed.
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

const withEnv = async (env, modulePath, fn) => {
  const prev = { ...process.env };
  Object.assign(process.env, env);
  delete require.cache[require.resolve(modulePath)];
  delete require.cache[require.resolve("../api/_lib/db")];
  try {
    await fn(require(modulePath));
  } finally {
    process.env = prev;
    delete require.cache[require.resolve(modulePath)];
    delete require.cache[require.resolve("../api/_lib/db")];
  }
};

(async () => {
  await asyncTest("GET /api/machines rejects non-GET requests", async () => {
    await withEnv({ DATABASE_URL: "postgres://fake" }, "../api/machines", async (handler) => {
      const res = await run(handler, { method: "POST" });
      assert.strictEqual(res.statusCode, 405);
    });
  });

  await asyncTest("GET /api/machines returns the machine list from the database", async () => {
    global.__PG_MOCK__ = {
      calls: [],
      handler(text) {
        if (/SELECT id, label FROM machines/.test(text)) {
          return { rows: [{ id: "kay-emms-1", label: "Kay & Emms – Cutter #1" }] };
        }
      },
    };
    try {
      await withEnv({ DATABASE_URL: "postgres://fake" }, "../api/machines", async (handler) => {
        const res = await run(handler, { method: "GET" });
        assert.strictEqual(res.statusCode, 200);
        assert.deepStrictEqual(res.body.machines, [{ id: "kay-emms-1", label: "Kay & Emms – Cutter #1" }]);
      });
    } finally {
      delete global.__PG_MOCK__;
    }
  });

  await asyncTest("GET /api/machines 502s with a clear message when no database is connected", async () => {
    await withEnv({}, "../api/machines", async (handler) => {
      const res = await run(handler, { method: "GET" });
      assert.strictEqual(res.statusCode, 502);
      assert.ok(/No database connected yet/.test(res.body.error));
    });
  });

  await asyncTest("GET /api/logs requires a machineId query parameter", async () => {
    await withEnv({ DATABASE_URL: "postgres://fake" }, "../api/logs", async (handler) => {
      const res = await run(handler, { method: "GET", query: {} });
      assert.strictEqual(res.statusCode, 400);
    });
  });

  await asyncTest("GET /api/logs returns rows for the given machineId", async () => {
    global.__PG_MOCK__ = {
      calls: [],
      handler(text) {
        if (/SELECT row FROM production_logs/.test(text)) {
          return { rows: [{ row: { markerName: "MK-1" } }, { row: { markerName: "MK-2" } }] };
        }
      },
    };
    try {
      await withEnv({ DATABASE_URL: "postgres://fake" }, "../api/logs", async (handler) => {
        const res = await run(handler, { method: "GET", query: { machineId: "kay-emms-1" } });
        assert.strictEqual(res.statusCode, 200);
        assert.strictEqual(res.body.rows.length, 2);
        assert.strictEqual(res.body.rows[0].markerName, "MK-1");
      });
    } finally {
      delete global.__PG_MOCK__;
    }
  });

  console.log(`\n${passed} test(s) passed.`);
})();
