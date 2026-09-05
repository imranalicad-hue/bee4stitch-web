// Verifies the browser-side (sql.js) row mapping in next2-browser-reader.js
// produces the exact same output shape/values as extract-next2.py, by
// reconstructing synthetic raw SQLite rows from real already-extracted data
// and round-tripping them through mapRow().
const assert = require("assert");
const Reader = require("../public/next2-browser-reader.js");

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

// ---------- parseNaiveTimestamp: no timezone drift ----------
test("parseNaiveTimestamp treats the string as naive local wall-clock (no tz math)", () => {
  const dt = Reader.parseNaiveTimestamp("2026-05-31T08:15:07");
  assert.strictEqual(dt.getFullYear(), 2026);
  assert.strictEqual(dt.getMonth(), 4); // 0-indexed => May
  assert.strictEqual(dt.getDate(), 31);
  assert.strictEqual(dt.getHours(), 8);
  assert.strictEqual(dt.getMinutes(), 15);
  assert.strictEqual(dt.getSeconds(), 7);
});

test("parseNaiveTimestamp also accepts the space-separated SQLite form", () => {
  const dt = Reader.parseNaiveTimestamp("2026-05-31 08:15:07");
  assert.strictEqual(dt.getDate(), 31);
  assert.strictEqual(dt.getHours(), 8);
});

test("parseNaiveTimestamp returns null for garbage input (mirrors Python's ValueError skip)", () => {
  assert.strictEqual(Reader.parseNaiveTimestamp("not-a-date"), null);
  assert.strictEqual(Reader.parseNaiveTimestamp(""), null);
  assert.strictEqual(Reader.parseNaiveTimestamp(null), null);
});

// ---------- mapRow: round-trip against real extracted data ----------
// Reconstruct a synthetic raw SQLite row that extract-next2.py would have
// read, from a row already extracted by extract-next2.py, then confirm
// mapRow() reproduces the same normalized row.
function rawFromExtracted(extracted) {
  return {
    StartTimeStamp: extracted.start,
    EndTimeStamp: extracted.end,
    MarkerName: extracted.markerName,
    TotalPerimeter: Math.round(extracted.perimeterM * 10000),
    NominalWidth: extracted.markerLengthM !== null ? Math.round(extracted.markerLengthM * 10000) : null,
    TotalDuration: null,
    NetTime: Math.round(extracted.netMin * 60),
    IdleTime: Math.round(extracted.delayMin * 60),
    ShapesCount: null,
    NumberOfPlies: extracted.plies,
    OrderName: null,
    ProductionOrder: extracted.order,
    FabricType: null,
  };
}

// Load a handful of real rows already produced by extract-next2.py.
global.window = global.window || {}; // next2-kay-emms-cutter1.js assigns to window
require("../public/data/next2-kay-emms-cutter1.js");
const realRows = global.window.__BEE4STITCH_DATA__.next2["kay-emms-1"];

test("real extracted dataset is non-empty (sanity check the fixture loaded)", () => {
  assert.ok(realRows.length > 1000, `expected >1000 real rows, got ${realRows.length}`);
});

test("mapRow reproduces extract-next2.py's output for real sample rows", () => {
  const sample = [realRows[0], realRows[500], realRows[realRows.length - 1]];
  for (const extracted of sample) {
    const raw = rawFromExtracted(extracted);
    const remapped = Reader.mapRow(raw, extracted.machine);
    assert.strictEqual(remapped.markerName, extracted.markerName, "markerName");
    assert.strictEqual(remapped.order, extracted.order, "order");
    // Compare to whole-second precision only: extract-next2.py preserves
    // Python's microsecond precision, but JS Date only stores milliseconds
    // — a platform limit, not a bug (see the comment on parseNaiveTimestamp).
    assert.strictEqual(
      remapped.start.slice(0, 19),
      extracted.start.slice(0, 19),
      "start timestamp matches to the second (sub-second precision is a JS Date platform limit)"
    );
    assert.strictEqual(
      remapped.end.slice(0, 19),
      extracted.end.slice(0, 19),
      "end timestamp matches to the second"
    );
    assert.strictEqual(remapped.date, extracted.date, "date bucket matches (no timezone drift)");
    assert.ok(Math.abs(remapped.usedMin - extracted.usedMin) < 0.01, "usedMin within rounding tolerance");
    assert.ok(Math.abs(remapped.netMin - extracted.netMin) < 0.01, "netMin within rounding tolerance");
    assert.ok(Math.abs(remapped.delayMin - extracted.delayMin) < 0.01, "delayMin within rounding tolerance");
    assert.ok(Math.abs(remapped.perimeterM - extracted.perimeterM) < 0.001, "perimeterM within rounding tolerance");
    assert.strictEqual(remapped.plies, extracted.plies, "plies");
  }
});

test("mapRow skips rows with unparsable timestamps, same as extract-next2.py's ValueError skip", () => {
  const raw = rawFromExtracted(realRows[0]);
  raw.StartTimeStamp = "garbage";
  assert.strictEqual(Reader.mapRow(raw, "X"), null);
});

test("mapRow falls back OrderName -> '—' when both order fields are empty, matching the Python extractor", () => {
  const raw = rawFromExtracted(realRows[0]);
  raw.ProductionOrder = "";
  raw.OrderName = "";
  const remapped = Reader.mapRow(raw, "X");
  assert.strictEqual(remapped.order, "—");
});

test("mapRow surfaces FabricType, falling back to '—' when absent", () => {
  const raw = rawFromExtracted(realRows[0]);
  raw.FabricType = null;
  assert.strictEqual(Reader.mapRow(raw, "X").fabricType, "—");
  raw.FabricType = "Denim";
  assert.strictEqual(Reader.mapRow(raw, "X").fabricType, "Denim");
});

console.log(`\n${passed} test(s) passed.`);
