// Tests /api/publish-machine.js's logic — auth, validation, and the shape
// of the GitHub Contents API calls it makes — by mocking global.fetch.
// Doesn't touch a real GitHub repo or need real credentials.
const assert = require("assert");
const { buildMachineDataFile, parseMachinesFile, buildMachinesFile, upsertMachine } = require("../api/_lib/publishFormat");

let passed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
    passed++;
  } catch (err) {
    console.error(`FAIL - ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

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

// ---------- publishFormat helpers ----------
test("buildMachineDataFile produces a script that assigns the exact rows given", () => {
  const rows = [{ markerName: "MK-1", usedMin: 12.5 }];
  const text = buildMachineDataFile("j-tex-1", rows);
  assert.ok(text.includes('window.__BEE4STITCH_DATA__.next2["j-tex-1"]'));
  const fakeWindow = {};
  new Function("window", text)(fakeWindow);
  assert.deepStrictEqual(fakeWindow.__BEE4STITCH_DATA__.next2["j-tex-1"], rows);
});

test("buildMachinesFile / parseMachinesFile round-trip", () => {
  const machines = [{ id: "a", label: "A", url: "data/next2-a.js" }];
  const text = buildMachinesFile(machines);
  assert.deepStrictEqual(parseMachinesFile(text), machines);
});

test("parseMachinesFile throws a clear error on an incompatible file", () => {
  assert.throws(() => parseMachinesFile("// not the expected format at all"), /doesn't match the expected format/);
});

test("upsertMachine replaces an existing id instead of duplicating it", () => {
  const machines = [
    { id: "a", label: "A old", url: "data/next2-a.js" },
    { id: "b", label: "B", url: "data/next2-b.js" },
  ];
  const next = upsertMachine(machines, { id: "a", label: "A new", url: "data/next2-a.js" });
  assert.strictEqual(next.length, 2);
  assert.strictEqual(next[0].label, "A new");
  assert.strictEqual(next[1].label, "B");
});

test("upsertMachine appends a genuinely new id", () => {
  const machines = [{ id: "a", label: "A", url: "data/next2-a.js" }];
  const next = upsertMachine(machines, { id: "c", label: "C", url: "data/next2-c.js" });
  assert.strictEqual(next.length, 2);
  assert.strictEqual(next[1].id, "c");
});

// ---------- handler: auth + validation (no network needed) ----------
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

(async () => {
  const withEnv = async (env, fn) => {
    const prev = { ...process.env };
    Object.assign(process.env, env);
    delete require.cache[require.resolve("../api/publish-machine")];
    try {
      await fn(require("../api/publish-machine"));
    } finally {
      process.env = prev;
      delete require.cache[require.resolve("../api/publish-machine")];
    }
  };

  await asyncTest("rejects non-POST requests", async () => {
    await withEnv(
      { GITHUB_TOKEN: "t", GITHUB_OWNER: "o", GITHUB_REPO: "r", PUBLISH_SECRET: "s" },
      async (handler) => {
        const res = await run(handler, { method: "GET", headers: {} });
        assert.strictEqual(res.statusCode, 405);
      }
    );
  });

  await asyncTest("500s with a clear message when env vars aren't configured yet", async () => {
    await withEnv({ GITHUB_TOKEN: "", GITHUB_OWNER: "", GITHUB_REPO: "", PUBLISH_SECRET: "" }, async (handler) => {
      const res = await run(handler, { method: "POST", headers: {}, body: {} });
      assert.strictEqual(res.statusCode, 500);
      assert.ok(/isn't configured yet/.test(res.body.error));
    });
  });

  await asyncTest("401s on a missing or wrong publish key", async () => {
    await withEnv(
      { GITHUB_TOKEN: "t", GITHUB_OWNER: "o", GITHUB_REPO: "r", PUBLISH_SECRET: "correct-secret" },
      async (handler) => {
        const res = await run(handler, { method: "POST", headers: { "x-publish-key": "wrong" }, body: {} });
        assert.strictEqual(res.statusCode, 401);
      }
    );
  });

  await asyncTest("400s on an invalid machineId", async () => {
    await withEnv(
      { GITHUB_TOKEN: "t", GITHUB_OWNER: "o", GITHUB_REPO: "r", PUBLISH_SECRET: "s" },
      async (handler) => {
        const res = await run(handler, {
          method: "POST",
          headers: { "x-publish-key": "s" },
          body: { machineId: "Not Valid!", machineLabel: "X", rows: [{}] },
        });
        assert.strictEqual(res.statusCode, 400);
      }
    );
  });

  await asyncTest("400s on empty rows", async () => {
    await withEnv(
      { GITHUB_TOKEN: "t", GITHUB_OWNER: "o", GITHUB_REPO: "r", PUBLISH_SECRET: "s" },
      async (handler) => {
        const res = await run(handler, {
          method: "POST",
          headers: { "x-publish-key": "s" },
          body: { machineId: "x-1", machineLabel: "X", rows: [] },
        });
        assert.strictEqual(res.statusCode, 400);
      }
    );
  });

  // ---------- happy path: mock global.fetch to simulate GitHub ----------
  await asyncTest("valid request writes both files via the GitHub Contents API and returns 200", async () => {
    const calls = [];
    const originalFetch = global.fetch;
    global.fetch = async (url, opts) => {
      calls.push({ url, opts });
      if (!opts || !opts.method || opts.method === "GET" || opts.method === undefined) {
        // getFile: simulate "doesn't exist yet" for both files on GET
        if (String(url).includes("next2-j-tex-1.js")) {
          return { status: 404, ok: false, json: async () => ({}) };
        }
        if (String(url).includes("machines.js")) {
          const existing = [{ id: "kay-emms-1", label: "Kay & Emms – Cutter #1", url: "data/next2-kay-emms-cutter1.js" }];
          const content = buildMachinesFile(existing);
          return { status: 200, ok: true, json: async () => ({ content: Buffer.from(content).toString("base64"), sha: "sha-machines-1" }) };
        }
      }
      if (opts && opts.method === "PUT") {
        return { ok: true, json: async () => ({ commit: { sha: "new-sha" } }) };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    };

    try {
      await withEnv(
        { GITHUB_TOKEN: "t", GITHUB_OWNER: "o", GITHUB_REPO: "r", PUBLISH_SECRET: "s" },
        async (handler) => {
          const rows = [{ markerName: "MK-1", usedMin: 12.5, machine: "J-Tex – Cutter #1" }];
          const res = await run(handler, {
            method: "POST",
            headers: { "x-publish-key": "s" },
            body: { machineId: "j-tex-1", machineLabel: "J-Tex – Cutter #1", rows },
          });
          assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
          assert.strictEqual(res.body.ok, true);
          assert.strictEqual(res.body.rowCount, 1);
        }
      );
    } finally {
      global.fetch = originalFetch;
    }

    // Two GETs (data file existence check, machines.js) + two PUTs (data file, machines.js)
    const puts = calls.filter((c) => c.opts && c.opts.method === "PUT");
    assert.strictEqual(puts.length, 2, "expected 2 PUT calls (data file + machines.js)");

    const dataPut = puts.find((c) => c.url.includes("next2-j-tex-1.js"));
    assert.ok(dataPut, "expected a PUT to the new machine's data file");
    const dataPutBody = JSON.parse(dataPut.opts.body);
    assert.ok(!dataPutBody.sha, "new file should not send a sha");
    const decodedData = Buffer.from(dataPutBody.content, "base64").toString("utf8");
    assert.ok(decodedData.includes('window.__BEE4STITCH_DATA__.next2["j-tex-1"]'));
    assert.ok(decodedData.includes("MK-1"));

    const machinesPut = puts.find((c) => c.url.includes("machines.js"));
    assert.ok(machinesPut, "expected a PUT to machines.js");
    const machinesPutBody = JSON.parse(machinesPut.opts.body);
    assert.strictEqual(machinesPutBody.sha, "sha-machines-1", "existing machines.js should be updated with its sha, not recreated");
    const decodedMachines = Buffer.from(machinesPutBody.content, "base64").toString("utf8");
    const parsed = parseMachinesFile(decodedMachines);
    assert.strictEqual(parsed.length, 2, "should now have both the original machine and the new one");
    assert.ok(parsed.some((m) => m.id === "j-tex-1"));
    assert.ok(parsed.some((m) => m.id === "kay-emms-1"), "existing machine should be preserved, not dropped");
  });

  console.log(`\n${passed} test(s) passed.`);
})();
