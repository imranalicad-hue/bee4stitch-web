#!/usr/bin/env python3
"""Extract real production rows from a Next2.db (Morgan cutter database) into
the data format the web Cutter Performance page expects.

This mirrors the raw-to-normalized mapping in the desktop app
(frmCutterPerformanceDashboard.vb / CutterPerformanceRepository.vb):
  - Perimeter (metres)     = TotalPerimeter / 10000
  - Marker length (metres) = NominalWidth / 10000
  - Marker width (inches)  = NominalHeight / 254
  - Machine-consumed (min) = TotalDuration / 60
  - Active cutting (min)   = NetTime / 60
  - Idle/delay (min)       = IdleTime / 60

Speed and target-speed attainment are deliberately NOT baked in here — the
web page computes those at runtime from the adjustable target-speed setting
(applyTargetSpeed() in cutter-performance-logic.js), the same way the
desktop app recomputes attainment from My.Settings.CutterPerformanceIdealSpeed.

The output is a .js file (not .json): it assigns the extracted rows into
window.__BEE4STITCH_DATA__.next2[<machine-id>] instead of being plain JSON
loaded with fetch(). That's deliberate — see the comment atop public/app.js.
It's what lets the site load from a plain double-click of index.html with
no local server, which is how the extracted rows actually reach the page.

Usage:
  python3 extract-next2.py <path-to-next2.db> <machine-id> <machine-label> <output.js> [--since YYYY-MM-DD]

  <machine-id>    must exactly match an id in the MACHINES list in
                   public/cutterPerformance.js (e.g. "kay-emms-1").
  <machine-label> the display name shown in the web app's machine picker
                   (e.g. "Kay & Emms - Cutter #1").
  <output.js>     where to write the data file — must match that same
                   MACHINES entry's `url` (e.g. public/data/next2-kay-emms-cutter1.js).
"""
import sqlite3
import json
import sys
from datetime import datetime, timedelta

def main():
    if len(sys.argv) < 5:
        print(__doc__)
        sys.exit(1)

    db_path = sys.argv[1]
    machine_id = sys.argv[2]
    machine_label = sys.argv[3]
    out_path = sys.argv[4]
    since = None
    if "--since" in sys.argv:
        since = sys.argv[sys.argv.index("--since") + 1]

    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    cur = con.cursor()

    query = """
        SELECT StartTimeStamp, EndTimeStamp, MarkerName, TotalPerimeter,
               NominalWidth, TotalDuration, NetTime, IdleTime, ShapesCount,
               NumberOfPlies, OrderName, ProductionOrder, FabricType
        FROM ProductionLogs
        WHERE MarkerName IS NOT NULL AND MarkerName <> ''
          AND NetTime > 0
          AND TotalPerimeter > 0
    """
    params = []
    if since:
        query += " AND EndTimeStamp >= ?"
        params.append(since)
    query += " ORDER BY EndTimeStamp ASC"

    cur.execute(query, params)

    rows = []
    skipped = 0
    for r in cur.fetchall():
        try:
            start = datetime.fromisoformat(r["StartTimeStamp"])
            end = datetime.fromisoformat(r["EndTimeStamp"])
        except ValueError:
            skipped += 1
            continue

        used_min = max(0.0, (end - start).total_seconds() / 60.0)
        net_min = max(0.0, r["NetTime"] / 60.0)
        delay_min = max(0.0, r["IdleTime"] / 60.0)
        perimeter_m = r["TotalPerimeter"] / 10000.0
        marker_length_m = r["NominalWidth"] / 10000.0 if r["NominalWidth"] else None

        rows.append({
            "machine": machine_label,
            "operator": "—",
            "markerName": r["MarkerName"],
            "order": (r["ProductionOrder"] or r["OrderName"] or "—").strip() or "—",
            "style": "—",
            "start": start.isoformat(),
            "end": end.isoformat(),
            "date": start.date().isoformat(),
            "usedMin": round(used_min, 3),
            "delayMin": round(delay_min, 3),
            "netMin": round(net_min, 3),
            "perimeterM": round(perimeter_m, 4),
            "markerLengthM": round(marker_length_m, 4) if marker_length_m else None,
            "rowTargetSpeed": None,
            "plies": r["NumberOfPlies"] if r["NumberOfPlies"] else (r["ShapesCount"] or None),
        })

    with open(out_path, "w", encoding="utf-8") as f:
        f.write("window.__BEE4STITCH_DATA__ = window.__BEE4STITCH_DATA__ || {};\n")
        f.write("window.__BEE4STITCH_DATA__.next2 = window.__BEE4STITCH_DATA__.next2 || {};\n")
        f.write(f"window.__BEE4STITCH_DATA__.next2[{json.dumps(machine_id)}] = ")
        json.dump(rows, f)
        f.write(";\n")

    print(f"Extracted {len(rows)} rows ({skipped} skipped: bad timestamps) -> {out_path}")
    if rows:
        print(f"Date range: {rows[0]['date']} .. {rows[-1]['date']}")

if __name__ == "__main__":
    main()
