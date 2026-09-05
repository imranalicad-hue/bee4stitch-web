// Cutter Performance — pure calculation logic (no DOM, no browser APIs).
//
// This mirrors the real Bee4Stitch desktop app's Cutter Performance engine
// (frmCutterPerformanceDashboard.vb / CutterPerformanceTrendBuilder.vb):
//   - Speed (m/min)          = Perimeter(m) * 60 / cutting-time(seconds)
//   - Speed Attainment (%)   = Speed / Target Speed * 100
//   - Performance Status     = classified from attainment:
//       < 70%        -> "Critical"
//       70% - 90%    -> "Below target"
//       90% - 105%   -> "On target"
//       > 105%       -> "Review over-speed"
//
// The desktop app derives cutting time, idle time, delay time etc. from raw
// machine telemetry (CutTime.log). A plain Excel/CSV import won't have that
// telemetry, so this module derives the same metrics from what a human can
// realistically put in a spreadsheet: start/end time, perimeter, target
// speed, and an optional delay figure. That is the one deliberate
// simplification — everything downstream (thresholds, formulas, KPI labels)
// matches the desktop app exactly.
//
// Loaded as a plain <script> in the browser (attaches to window.CutterPerf)
// and via require() in Node for unit tests.

(function (root) {
  "use strict";

  const CRITICAL_UPPER = 70.0;
  const BELOW_TARGET_UPPER = 90.0;
  const ON_TARGET_UPPER = 105.0;

  function classifyAttainment(pct) {
    if (pct === null || pct === undefined || !isFinite(pct) || pct < 0) {
      return "Benchmark unavailable";
    }
    if (pct < CRITICAL_UPPER) return "Critical";
    if (pct < BELOW_TARGET_UPPER) return "Below target";
    if (pct <= ON_TARGET_UPPER) return "On target";
    return "Review over-speed";
  }

  // Recognized input headers, case/space/underscore-insensitive.
  const HEADER_ALIASES = {
    machine: ["machine", "cutter", "cuttermachine", "machinecode", "machinename"],
    operator: ["operator", "operatorname"],
    markerName: ["markername", "marker", "markerid"],
    order: ["order", "orderno", "orderno.", "productionorder"],
    style: ["style", "stylenumber", "styleno"],
    start: ["starttime", "start", "starttimestamp"],
    end: ["endtime", "end", "endtimestamp"],
    perimeterM: ["perimeterm", "perimeter", "perimetermetres", "perimetermeters"],
    markerLengthM: ["markerlengthm", "markerlength", "length", "lengthmetres"],
    targetSpeed: [
      "targetspeed",
      "targetspeedmmin",
      "cuttingspeedsetpoint",
      "speedsetpoint",
      "speedtarget",
    ],
    delayMin: ["delaymin", "delayminutes", "delay"],
    plies: ["plies", "shapescount", "shapes"],
  };

  function normalizeHeader(h) {
    return String(h || "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  }

  function buildHeaderMap(headers) {
    const normalized = headers.map(normalizeHeader);
    const map = {};
    for (const field in HEADER_ALIASES) {
      const aliases = HEADER_ALIASES[field];
      let idx = -1;
      for (const alias of aliases) {
        idx = normalized.indexOf(alias);
        if (idx !== -1) break;
      }
      if (idx !== -1) map[field] = idx;
    }
    return map;
  }

  function parseNumber(v) {
    if (v === null || v === undefined || v === "") return NaN;
    if (typeof v === "number") return v;
    const n = parseFloat(String(v).replace(/,/g, ""));
    return n;
  }

  function parseDate(v) {
    if (v === null || v === undefined || v === "") return null;
    if (v instanceof Date) return v;
    // Excel serial date number. Excel's own floating-point serial can't
    // represent every time-of-day exactly (e.g. 08:30:00 round-trips as
    // 29.99998... minutes after 08:00 instead of exactly 30), so round to
    // the nearest second — real-world cutting durations don't need
    // sub-second precision, and this keeps minute/hour math exact.
    if (typeof v === "number") {
      const epoch = new Date(Date.UTC(1899, 11, 30));
      const ms = epoch.getTime() + v * 86400000;
      return new Date(Math.round(ms / 1000) * 1000);
    }
    const d = new Date(String(v).replace(" ", "T"));
    return isNaN(d.getTime()) ? null : d;
  }

  // Turns raw parsed rows (array of arrays, first row = headers) into
  // normalized, computed records. Returns { rows, errors, headerMap }.
  function processRows(rawRows) {
    const errors = [];
    if (!rawRows || rawRows.length < 2) {
      return { rows: [], errors: ["The file has no data rows below the header."], headerMap: {} };
    }
    const headers = rawRows[0];
    const headerMap = buildHeaderMap(headers);

    const required = ["markerName", "start", "end", "perimeterM"];
    const missing = required.filter((f) => !(f in headerMap));
    if (missing.length > 0) {
      return {
        rows: [],
        errors: [
          `Missing required column(s): ${missing.join(", ")}. ` +
            "Expected headers include Marker Name, Start Time, End Time, Perimeter (m).",
        ],
        headerMap,
      };
    }

    const rows = [];
    for (let i = 1; i < rawRows.length; i++) {
      const raw = rawRows[i];
      if (!raw || raw.every((c) => c === "" || c === null || c === undefined)) continue;

      const get = (field) => (field in headerMap ? raw[headerMap[field]] : undefined);

      const markerName = String(get("markerName") || "").trim();
      const start = parseDate(get("start"));
      const end = parseDate(get("end"));
      const perimeterM = parseNumber(get("perimeterM"));

      if (!markerName || !start || !end || !isFinite(perimeterM)) {
        errors.push(`Row ${i + 1}: skipped — missing or invalid marker name, start/end time, or perimeter.`);
        continue;
      }

      const usedMin = Math.max(0, (end.getTime() - start.getTime()) / 60000);
      const delayMinRaw = parseNumber(get("delayMin"));
      const delayMin = isFinite(delayMinRaw) ? Math.max(0, delayMinRaw) : 0;
      const netMin = Math.max(0, usedMin - delayMin);

      const targetSpeedRaw = parseNumber(get("targetSpeed"));
      const targetSpeed = isFinite(targetSpeedRaw) ? targetSpeedRaw : NaN;

      const markerLengthRaw = parseNumber(get("markerLengthM"));
      const pliesRaw = parseNumber(get("plies"));

      rows.push({
        machine: String(get("machine") || "").trim() || "Unassigned",
        operator: String(get("operator") || "").trim() || "—",
        markerName,
        order: String(get("order") || "").trim() || "—",
        style: String(get("style") || "").trim() || "—",
        start,
        end,
        date: start.toISOString().slice(0, 10),
        usedMin,
        delayMin,
        netMin,
        perimeterM,
        markerLengthM: isFinite(markerLengthRaw) ? markerLengthRaw : null,
        rowTargetSpeed: isFinite(targetSpeed) ? targetSpeed : null,
        plies: isFinite(pliesRaw) ? pliesRaw : null,
      });
    }

    // Fill in speed / attainment / status using each row's own target speed
    // if the sheet provided one, otherwise a caller-supplied default is
    // applied later via applyTargetSpeed().
    applyTargetSpeed(rows, null);

    return { rows, errors, headerMap };
  }

  // (Re)computes speed, speed-attainment%, performance status and delay
  // state for every row, in place, and returns the same array.
  //
  // Each row uses its own `rowTargetSpeed` when the source data supplied
  // one (e.g. a sheet column); otherwise it falls back to `defaultTargetSpeed`
  // — the adjustable "ideal speed" setting, mirroring
  // My.Settings.CutterPerformanceIdealSpeed (0–15 m/min) in the desktop app.
  // Calling this again with a new defaultTargetSpeed is how the UI's target
  // speed control recomputes attainment live, for both imported and
  // Next2.db-sourced rows.
  function applyTargetSpeed(rows, defaultTargetSpeed) {
    rows.forEach((r) => {
      const targetSpeed =
        r.rowTargetSpeed !== null && r.rowTargetSpeed !== undefined && r.rowTargetSpeed > 0
          ? r.rowTargetSpeed
          : defaultTargetSpeed;

      r.speed = r.netMin > 0 ? r.perimeterM / r.netMin : 0;
      r.targetSpeed = isFinite(targetSpeed) && targetSpeed > 0 ? targetSpeed : null;
      r.speedAttainmentPct = r.targetSpeed ? (r.speed / r.targetSpeed) * 100 : null;
      r.performanceStatus = classifyAttainment(r.speedAttainmentPct);
      r.delayState = r.delayMin > 0 ? `${Math.round(r.delayMin)} min delay` : "No delay";
    });
    return rows;
  }

  // Aggregate KPI tiles — same 8 tiles, same order, as the desktop
  // executive dashboard (CreateKpiCard calls in frmCutterPerformanceDashboard.vb).
  function computeKpis(rows) {
    if (rows.length === 0) {
      return {
        availableMin: 0,
        machineConsumedMin: 0,
        activeCuttingMin: 0,
        machineIdleDelayMin: 0,
        totalCutPerimeterM: 0,
        averageCutSpeed: 0,
        speedTargetAttainmentPct: null,
        completedJobs: 0,
      };
    }
    const machineConsumedMin = sum(rows, (r) => r.usedMin);
    const activeCuttingMin = sum(rows, (r) => r.netMin);
    const machineIdleDelayMin = sum(rows, (r) => r.delayMin);
    const totalCutPerimeterM = sum(rows, (r) => r.perimeterM);
    const averageCutSpeed = activeCuttingMin > 0 ? totalCutPerimeterM / activeCuttingMin : 0;

    const withAttainment = rows.filter((r) => r.speedAttainmentPct !== null);
    const speedTargetAttainmentPct =
      withAttainment.length > 0 ? sum(withAttainment, (r) => r.speedAttainmentPct) / withAttainment.length : null;

    return {
      // "Available" isn't derivable from a plain spreadsheet (the desktop app
      // gets it from shift settings) — approximated as machine-consumed time.
      availableMin: machineConsumedMin,
      machineConsumedMin,
      activeCuttingMin,
      machineIdleDelayMin,
      totalCutPerimeterM,
      averageCutSpeed,
      speedTargetAttainmentPct,
      completedJobs: rows.length,
    };
  }

  // Daily average speed-attainment trend, sorted by date.
  function computeTrend(rows) {
    const byDay = {};
    rows.forEach((r) => {
      if (r.speedAttainmentPct === null) return;
      if (!byDay[r.date]) byDay[r.date] = { date: r.date, sum: 0, count: 0 };
      byDay[r.date].sum += r.speedAttainmentPct;
      byDay[r.date].count += 1;
    });
    return Object.values(byDay)
      .map((d) => ({ date: d.date, avgAttainmentPct: Math.round((d.sum / d.count) * 10) / 10 }))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
  }

  function sum(arr, fn) {
    return arr.reduce((acc, x) => acc + fn(x), 0);
  }

  // ---------- Period viewer (Day / Week / Month / Year / Custom Range) ----------
  // Mirrors SelectedDateRange() / MoveReference() in the desktop app's
  // frmCutterPerformanceDashboard.vb exactly — same week start (Monday),
  // same month/year boundaries, same exclusive end, same stepping — rather
  // than inventing separate web-only semantics.

  function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  // period: "day" | "week" | "month" | "year" | "custom" | "all".
  // referenceDate: a Date — only its calendar date matters for day/week/month/year.
  // customFrom/customTo: Dates, used only when period === "custom".
  // Returns { start, end } (end exclusive) or null for "all" (no filtering).
  function computeSelectedRange(period, referenceDate, customFrom, customTo) {
    if (period === "all") return null;
    if (period === "custom") {
      if (!(customFrom instanceof Date) || !(customTo instanceof Date)) return null;
      return { start: customFrom, end: customTo };
    }
    const ref = startOfDay(referenceDate instanceof Date ? referenceDate : new Date(referenceDate));
    switch (period) {
      case "week": {
        // (day-of-week + 6) % 7 turns Sunday=0..Saturday=6 into
        // days-since-Monday=0..6, i.e. a Monday-start week.
        const daysSinceMonday = (ref.getDay() + 6) % 7;
        const start = new Date(ref);
        start.setDate(start.getDate() - daysSinceMonday);
        const end = new Date(start);
        end.setDate(end.getDate() + 7);
        return { start, end };
      }
      case "month": {
        const start = new Date(ref.getFullYear(), ref.getMonth(), 1);
        const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
        return { start, end };
      }
      case "year": {
        const start = new Date(ref.getFullYear(), 0, 1);
        const end = new Date(start.getFullYear() + 1, 0, 1);
        return { start, end };
      }
      case "day":
      default:
        return { start: ref, end: new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() + 1) };
    }
  }

  // .NET's DateTime.AddMonths/AddYears clamp an out-of-range day to the last
  // valid day of the resulting month (31 Jan + 1 month -> 28/29 Feb) instead
  // of overflowing into the next month the way JS's raw Date.setMonth does
  // (31 Jan + 1 month -> 3 Mar). MoveReference() in the desktop app relies
  // on that clamping behavior, so these two helpers reproduce it exactly.
  function addMonthsClamped(d, months) {
    const targetIndex = d.getMonth() + months;
    const year = d.getFullYear() + Math.floor(targetIndex / 12);
    const month = ((targetIndex % 12) + 12) % 12;
    const daysInTargetMonth = new Date(year, month + 1, 0).getDate();
    const day = Math.min(d.getDate(), daysInTargetMonth);
    return new Date(year, month, day, d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());
  }

  function addYearsClamped(d, years) {
    const year = d.getFullYear() + years;
    const daysInTargetMonth = new Date(year, d.getMonth() + 1, 0).getDate();
    const day = Math.min(d.getDate(), daysInTargetMonth);
    return new Date(year, d.getMonth(), day, d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());
  }

  // Advances/retreats the reference date by one period, same as clicking
  // Previous/Next on the desktop dashboard (MoveReference()).
  function stepReferenceDate(period, referenceDate, direction) {
    const d = new Date(referenceDate);
    switch (period) {
      case "week":
        d.setDate(d.getDate() + 7 * direction);
        return d;
      case "month":
        return addMonthsClamped(d, direction);
      case "year":
        return addYearsClamped(d, direction);
      case "day":
      default:
        d.setDate(d.getDate() + direction);
        return d;
    }
  }

  // Shifts a confirmed custom range by its own duration, same as
  // MoveCustomDateRange() — "next/previous window of the same size".
  function stepCustomRange(start, end, direction) {
    const durationMs = end.getTime() - start.getTime();
    if (!(durationMs > 0)) return { start, end };
    const offset = direction < 0 ? -durationMs : durationMs;
    return { start: new Date(start.getTime() + offset), end: new Date(end.getTime() + offset) };
  }

  function formatPeriodLabel(period, range) {
    if (!range) return "All dates";
    const fmt = (d) => d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
    const inclusiveEnd = new Date(range.end.getTime() - 1);
    if (period === "day") return fmt(range.start);
    if (period === "custom") {
      const fmtDT = (d) => d.toLocaleString(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
      return `${fmtDT(range.start)} → ${fmtDT(range.end)}`;
    }
    return `${fmt(range.start)} – ${fmt(inclusiveEnd)}`;
  }

  // Minimal CSV parser — handles quoted fields and commas inside quotes.
  // No external dependency, always works even if the XLSX CDN library fails
  // to load.
  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          field += c;
        }
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(field);
        field = "";
      } else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else {
        field += c;
      }
    }
    if (field.length > 0 || row.length > 0) {
      row.push(field);
      rows.push(row);
    }
    return rows.filter((r) => !(r.length === 1 && r[0] === ""));
  }

  const CutterPerf = {
    classifyAttainment,
    processRows,
    applyTargetSpeed,
    computeKpis,
    computeTrend,
    parseCsv,
    buildHeaderMap,
    normalizeHeader,
    computeSelectedRange,
    stepReferenceDate,
    stepCustomRange,
    formatPeriodLabel,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = CutterPerf;
  } else {
    root.CutterPerf = CutterPerf;
  }
})(typeof window !== "undefined" ? window : globalThis);
