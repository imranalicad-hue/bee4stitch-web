// Plain-node unit tests, no test framework dependency (npm isn't reachable
// in this environment). Run with: node tests/cutter-performance-logic.test.js
const assert = require("assert");
const CutterPerf = require("../public/cutter-performance-logic.js");

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`ok - ${name}`);
  } catch (e) {
    console.error(`FAIL - ${name}\n  ${e.message}`);
    process.exitCode = 1;
  }
}

check("classifyAttainment thresholds match desktop app exactly", () => {
  assert.strictEqual(CutterPerf.classifyAttainment(69.9), "Critical");
  assert.strictEqual(CutterPerf.classifyAttainment(70), "Below target");
  assert.strictEqual(CutterPerf.classifyAttainment(89.9), "Below target");
  assert.strictEqual(CutterPerf.classifyAttainment(90), "On target");
  assert.strictEqual(CutterPerf.classifyAttainment(105), "On target");
  assert.strictEqual(CutterPerf.classifyAttainment(105.1), "Review over-speed");
  assert.strictEqual(CutterPerf.classifyAttainment(null), "Benchmark unavailable");
  assert.strictEqual(CutterPerf.classifyAttainment(NaN), "Benchmark unavailable");
});

check("parseCsv handles quoted fields with embedded commas", () => {
  const text = 'a,b,c\n1,"hello, world",3\n';
  const rows = CutterPerf.parseCsv(text);
  assert.deepStrictEqual(rows, [
    ["a", "b", "c"],
    ["1", "hello, world", "3"],
  ]);
});

check("processRows computes speed and attainment matching the desktop formula", () => {
  const headers = ["Marker Name", "Start Time", "End Time", "Perimeter (m)", "Target Speed", "Delay (min)"];
  // 30 minutes total, 5 min delay -> 25 min net cutting. 50m perimeter -> 2 m/min.
  // Target speed 2 m/min -> attainment exactly 100% -> "On target".
  const raw = [
    headers,
    ["MK-001", "2026-09-01 08:00:00", "2026-09-01 08:30:00", "50", "2", "5"],
  ];
  const { rows, errors } = CutterPerf.processRows(raw);
  assert.strictEqual(errors.length, 0);
  assert.strictEqual(rows.length, 1);
  const r = rows[0];
  assert.strictEqual(r.usedMin, 30);
  assert.strictEqual(r.netMin, 25);
  assert.strictEqual(r.speed, 2);
  assert.strictEqual(r.speedAttainmentPct, 100);
  assert.strictEqual(r.performanceStatus, "On target");
  assert.strictEqual(r.delayState, "5 min delay");
});

check("processRows flags missing required columns instead of crashing", () => {
  const { rows, errors } = CutterPerf.processRows([["Foo", "Bar"], ["1", "2"]]);
  assert.strictEqual(rows.length, 0);
  assert.ok(errors[0].includes("Missing required column"));
});

check("processRows skips invalid rows but keeps valid ones, with a per-row error", () => {
  const headers = ["Marker Name", "Start Time", "End Time", "Perimeter (m)"];
  const raw = [
    headers,
    ["", "2026-09-01 08:00:00", "2026-09-01 08:30:00", "50"], // missing marker name -> skipped
    ["MK-002", "2026-09-01 09:00:00", "2026-09-01 09:20:00", "40"],
  ];
  const { rows, errors } = CutterPerf.processRows(raw);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].markerName, "MK-002");
  assert.strictEqual(errors.length, 1);
});

check("computeKpis aggregates match sums of the row-level fields", () => {
  const headers = ["Marker Name", "Start Time", "End Time", "Perimeter (m)", "Target Speed", "Delay (min)"];
  const raw = [
    headers,
    ["MK-001", "2026-09-01 08:00:00", "2026-09-01 08:30:00", "50", "2", "5"], // net 25min, speed 2, attainment 100
    ["MK-002", "2026-09-01 09:00:00", "2026-09-01 09:20:00", "60", "3", "0"], // net 20min, speed 3, attainment 100
  ];
  const { rows } = CutterPerf.processRows(raw);
  const kpis = CutterPerf.computeKpis(rows);
  assert.strictEqual(kpis.completedJobs, 2);
  assert.strictEqual(kpis.machineConsumedMin, 50);
  assert.strictEqual(kpis.activeCuttingMin, 45);
  assert.strictEqual(kpis.machineIdleDelayMin, 5);
  assert.strictEqual(kpis.totalCutPerimeterM, 110);
  assert.strictEqual(Math.round(kpis.averageCutSpeed * 100) / 100, Math.round((110 / 45) * 100) / 100);
  assert.strictEqual(kpis.speedTargetAttainmentPct, 100);
});

check("computeKpis handles the empty-import state without dividing by zero", () => {
  const kpis = CutterPerf.computeKpis([]);
  assert.strictEqual(kpis.completedJobs, 0);
  assert.strictEqual(kpis.averageCutSpeed, 0);
  assert.strictEqual(kpis.speedTargetAttainmentPct, null);
});

check("computeTrend groups by date and averages attainment", () => {
  const headers = ["Marker Name", "Start Time", "End Time", "Perimeter (m)", "Target Speed"];
  const raw = [
    headers,
    ["MK-001", "2026-09-01 08:00:00", "2026-09-01 08:30:00", "60", "2"], // 30min, speed 2, attain 100
    ["MK-002", "2026-09-01 09:00:00", "2026-09-01 09:30:00", "30", "2"], // 30min, speed 1, attain 50
  ];
  const { rows } = CutterPerf.processRows(raw);
  const trend = CutterPerf.computeTrend(rows);
  assert.strictEqual(trend.length, 1);
  assert.strictEqual(trend[0].date, "2026-09-01");
  assert.strictEqual(trend[0].avgAttainmentPct, 75);
});

// ---------- Period viewer: pinned against the desktop app's exact semantics ----------
// (SelectedDateRange() / MoveReference() in frmCutterPerformanceDashboard.vb)

check("computeSelectedRange 'day' is [ref 00:00, +1 day)", () => {
  const ref = new Date(2026, 5, 17, 14, 30); // Wed 17 Jun 2026, 14:30 — time-of-day must be ignored
  const r = CutterPerf.computeSelectedRange("day", ref);
  assert.deepStrictEqual(r.start, new Date(2026, 5, 17));
  assert.deepStrictEqual(r.end, new Date(2026, 5, 18));
});

check("computeSelectedRange 'week' starts on Monday, same as the desktop dashboard", () => {
  // Wed 17 Jun 2026 -> week is Mon 15 Jun through (exclusive) Mon 22 Jun.
  const wed = CutterPerf.computeSelectedRange("week", new Date(2026, 5, 17));
  assert.deepStrictEqual(wed.start, new Date(2026, 5, 15));
  assert.deepStrictEqual(wed.end, new Date(2026, 5, 22));
  // A Sunday must resolve to the week that ENDS that day, not the next one
  // (day-of-week 0 -> daysSinceMonday must be 6, not -1).
  const sun = CutterPerf.computeSelectedRange("week", new Date(2026, 5, 21));
  assert.deepStrictEqual(sun.start, new Date(2026, 5, 15));
  assert.deepStrictEqual(sun.end, new Date(2026, 5, 22));
  // A Monday itself is the start of its own week.
  const mon = CutterPerf.computeSelectedRange("week", new Date(2026, 5, 15));
  assert.deepStrictEqual(mon.start, new Date(2026, 5, 15));
});

check("computeSelectedRange 'month' is [1st 00:00, +1 month)", () => {
  const r = CutterPerf.computeSelectedRange("month", new Date(2026, 1, 14)); // 14 Feb 2026
  assert.deepStrictEqual(r.start, new Date(2026, 1, 1));
  assert.deepStrictEqual(r.end, new Date(2026, 2, 1)); // March 1st, handles Feb's shorter length
});

check("computeSelectedRange 'year' is [Jan 1 00:00, +1 year)", () => {
  const r = CutterPerf.computeSelectedRange("year", new Date(2026, 8, 4));
  assert.deepStrictEqual(r.start, new Date(2026, 0, 1));
  assert.deepStrictEqual(r.end, new Date(2027, 0, 1));
});

check("computeSelectedRange 'all' returns null (no filtering)", () => {
  assert.strictEqual(CutterPerf.computeSelectedRange("all", new Date()), null);
});

check("computeSelectedRange 'custom' uses the exact from/to instants given, time-of-day included", () => {
  const from = new Date(2026, 5, 1, 8, 15);
  const to = new Date(2026, 5, 3, 17, 45);
  const r = CutterPerf.computeSelectedRange("custom", new Date(), from, to);
  assert.strictEqual(r.start, from);
  assert.strictEqual(r.end, to);
});

check("stepReferenceDate matches MoveReference()'s per-period step sizes", () => {
  const ref = new Date(2026, 0, 31); // 31 Jan 2026
  assert.deepStrictEqual(CutterPerf.stepReferenceDate("day", ref, 1), new Date(2026, 1, 1));
  assert.deepStrictEqual(CutterPerf.stepReferenceDate("week", ref, 1), new Date(2026, 1, 7));
  assert.deepStrictEqual(CutterPerf.stepReferenceDate("month", ref, 1), new Date(2026, 1, 28)); // clamped to Feb's last day, matching .NET AddMonths (not JS's raw month-overflow)
  assert.deepStrictEqual(CutterPerf.stepReferenceDate("year", ref, -1), new Date(2025, 0, 31));
});

check("stepCustomRange shifts both endpoints by the range's own duration", () => {
  const start = new Date(2026, 5, 1, 0, 0);
  const end = new Date(2026, 5, 3, 0, 0); // 2-day window
  const next = CutterPerf.stepCustomRange(start, end, 1);
  assert.deepStrictEqual(next.start, new Date(2026, 5, 3, 0, 0));
  assert.deepStrictEqual(next.end, new Date(2026, 5, 5, 0, 0));
  const prev = CutterPerf.stepCustomRange(start, end, -1);
  assert.deepStrictEqual(prev.start, new Date(2026, 4, 30, 0, 0));
  assert.deepStrictEqual(prev.end, new Date(2026, 5, 1, 0, 0));
});

console.log(`\n${passed} test(s) passed.`);
