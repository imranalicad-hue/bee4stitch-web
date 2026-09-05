// Reads a next2.db file the user picks with the "Browse for next2.db" file
// input, entirely in the browser — no upload to any server just to preview
// it. This is the browser-side twin of extract-next2.py: same SQL query,
// same column mapping, same rounding, so a machine published this way
// produces byte-for-byte the same row shape as the desktop/CLI extractor.
//
// Uses sql.js (SQLite compiled to WebAssembly, https://sql.js.org, MIT
// licensed) loaded lazily from cdnjs on first use — this needs the browser
// to have internet access to fetch the ~1MB WASM binary once (it's cached
// by the browser after that). This is the one piece of the app that isn't
// fully self-contained, because reading a real SQLite file without it means
// hand-rolling a binary SQLite-file-format parser, which is a much larger
// correctness risk than depending on the reference implementation.

const Next2BrowserReader = (function () {
  const SQLJS_VERSION = "1.10.3";
  const SQLJS_BASE = `https://cdnjs.cloudflare.com/ajax/libs/sql.js/${SQLJS_VERSION}/`;

  // Exact same query as extract-next2.py — keep these in sync.
  const QUERY_BASE = `
    SELECT StartTimeStamp, EndTimeStamp, MarkerName, TotalPerimeter,
           NominalWidth, TotalDuration, NetTime, IdleTime, ShapesCount,
           NumberOfPlies, OrderName, ProductionOrder, FabricType
    FROM ProductionLogs
    WHERE MarkerName IS NOT NULL AND MarkerName <> ''
      AND NetTime > 0
      AND TotalPerimeter > 0
  `;

  let sqlJsPromise = null;

  function loadSqlJs() {
    if (sqlJsPromise) return sqlJsPromise;
    sqlJsPromise = loadScriptTag(SQLJS_BASE + "sql-wasm.js")
      .then(() => {
        if (typeof window.initSqlJs !== "function") {
          throw new Error("sql.js loaded but window.initSqlJs is missing — the CDN build may have changed.");
        }
        return window.initSqlJs({ locateFile: (file) => SQLJS_BASE + file });
      })
      .catch((err) => {
        sqlJsPromise = null; // allow retry on next call instead of caching a permanent failure
        throw new Error(
          `Couldn't load the SQLite reader (sql.js) from cdnjs.cloudflare.com — this needs internet access ` +
            `the first time it's used. Original error: ${err.message}`
        );
      });
    return sqlJsPromise;
  }

  function loadScriptTag(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.head.appendChild(s);
    });
  }

  // Parses a "YYYY-MM-DD HH:MM:SS" or "YYYY-MM-DDTHH:MM:SS" timestamp as a
  // NAIVE local wall-clock value (no timezone conversion) — this mirrors
  // Python's datetime.fromisoformat() exactly, which is what
  // extract-next2.py uses. Using `new Date(theString)` directly here would
  // risk browser-dependent timezone parsing quirks; building the Date from
  // the individual numbers sidesteps that entirely.
  // Next2.db's StartTimeStamp/EndTimeStamp carry microsecond precision
  // (e.g. "2026-05-31T23:49:15.249590"). JS Date only stores millisecond
  // precision, so the trailing 3 microsecond digits are necessarily lost —
  // that's a JS platform limit, not a bug, and it's immaterial here: every
  // downstream calculation (usedMin, KPI aggregation, the table's
  // to-the-second display) only needs whole-second precision anyway.
  function parseNaiveTimestamp(s) {
    if (!s) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?/.exec(String(s));
    if (!m) return null;
    const [y, mo, d, h, mi, se] = m.slice(1, 7).map(Number);
    const ms = m[7] ? Number(m[7].slice(0, 3).padEnd(3, "0")) : 0;
    const dt = new Date(y, mo - 1, d, h, mi, se, ms);
    return isNaN(dt.getTime()) ? null : dt;
  }

  function round(n, digits) {
    const f = Math.pow(10, digits);
    return Math.round(n * f) / f;
  }

  function isoLocal(dt) {
    // Matches Python's naive datetime.isoformat(): "YYYY-MM-DDTHH:MM:SS"
    // (plus ".mmm" when there are milliseconds), no timezone suffix, using
    // the same local numbers we parsed in with.
    const p = (n, len = 2) => String(n).padStart(len, "0");
    const base =
      `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}T` +
      `${p(dt.getHours())}:${p(dt.getMinutes())}:${p(dt.getSeconds())}`;
    return dt.getMilliseconds() ? `${base}.${p(dt.getMilliseconds(), 3)}` : base;
  }

  function mapRow(r, machineLabel) {
    const start = parseNaiveTimestamp(r.StartTimeStamp);
    const end = parseNaiveTimestamp(r.EndTimeStamp);
    if (!start || !end) return null; // bad timestamp — skipped, same as extract-next2.py

    const usedMin = Math.max(0, (end.getTime() - start.getTime()) / 60000);
    const netMin = Math.max(0, (r.NetTime || 0) / 60);
    const delayMin = Math.max(0, (r.IdleTime || 0) / 60);
    const perimeterM = (r.TotalPerimeter || 0) / 10000;
    const markerLengthM = r.NominalWidth ? r.NominalWidth / 10000 : null;
    const order = String(r.ProductionOrder || r.OrderName || "—").trim() || "—";

    return {
      machine: machineLabel,
      operator: "—",
      markerName: r.MarkerName,
      order,
      style: "—",
      start: isoLocal(start),
      end: isoLocal(end),
      date: isoLocal(start).slice(0, 10),
      usedMin: round(usedMin, 3),
      delayMin: round(delayMin, 3),
      netMin: round(netMin, 3),
      perimeterM: round(perimeterM, 4),
      markerLengthM: markerLengthM !== null ? round(markerLengthM, 4) : null,
      rowTargetSpeed: null,
      plies: r.NumberOfPlies || r.ShapesCount || null,
    };
  }

  // file: a File object (from an <input type="file"> picked by the user).
  // opts.machineLabel: display label to stamp onto every row.
  // opts.since: optional "YYYY-MM-DD" string — only rows on/after this date.
  // Returns { rows, skipped } — never touches/writes the source file.
  async function extractFromFile(file, { machineLabel, since } = {}) {
    if (!file) throw new Error("No file selected.");
    const SQL = await loadSqlJs();

    let buffer;
    try {
      buffer = await file.arrayBuffer();
    } catch (err) {
      throw new Error(`Couldn't read the selected file: ${err.message}`);
    }

    let db;
    try {
      db = new SQL.Database(new Uint8Array(buffer));
    } catch (err) {
      throw new Error(
        `Couldn't open "${file.name}" as a SQLite database — is this the right next2.db file? (${err.message})`
      );
    }

    try {
      let query = QUERY_BASE;
      const params = [];
      if (since) {
        query += " AND EndTimeStamp >= ?";
        params.push(since);
      }
      query += " ORDER BY EndTimeStamp ASC";

      let stmt;
      try {
        stmt = db.prepare(query);
      } catch (err) {
        throw new Error(
          `"${file.name}" doesn't look like a Morgan cutter next2.db — expected a ProductionLogs table with the ` +
            `usual columns. (${err.message})`
        );
      }
      stmt.bind(params);

      const rows = [];
      let skipped = 0;
      while (stmt.step()) {
        const raw = stmt.getAsObject();
        const mapped = mapRow(raw, machineLabel);
        if (mapped) rows.push(mapped);
        else skipped++;
      }
      stmt.free();

      return { rows, skipped };
    } finally {
      db.close();
    }
  }

  return { extractFromFile, parseNaiveTimestamp, mapRow, isoLocal, round };
})();

if (typeof window !== "undefined") window.Next2BrowserReader = Next2BrowserReader;
if (typeof module !== "undefined" && module.exports) module.exports = Next2BrowserReader;
