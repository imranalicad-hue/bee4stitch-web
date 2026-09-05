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
window.__BEE4STITCH_DATA__.next2[<machine-id>] — a plain-text local backup/
audit copy of exactly what gets published, in the same row format. The live
site's Cutter
Performance page reads from a cloud Postgres database via /api/machines and
/api/logs (see api/_lib/db.js and the README's "Setting up the cloud
database"); the normal way to publish is the in-page Browse -> Preview ->
Publish flow, which POSTs straight to /api/publish-machine.

This script can do that same POST for you (e.g. for a scheduled refresh with
no one at a browser) with --publish-url and --publish-key:

Usage:
  python3 extract-next2.py <path-to-next2.db> <machine-id> <machine-label> <output.js> [--since YYYY-MM-DD] [--publish-url https://your-site.vercel.app --publish-key YOUR_SECRET]

  <machine-id>    the key the web page looks up — reuse an existing id (see
                   the machine picker on the live site) to update that
                   machine, or invent a new short lowercase-hyphenated one
                   to add a customer.
  <machine-label> the display name shown in the web app's machine picker
                   (e.g. "Kay & Emms - Cutter #1").
  <output.js>     where to write the local backup/preview file.
  --publish-url   the live site's base URL — when given, also POSTs the
                   extracted rows to <publish-url>/api/publish-machine so
                   they're live on the site immediately, same as clicking
                   Publish in the browser.
  --publish-key   the site's PUBLISH_SECRET — required if --publish-url is
                   given.
"""
import sqlite3
import json
import sys
import urllib.request
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
    publish_url = None
    if "--publish-url" in sys.argv:
        publish_url = sys.argv[sys.argv.index("--publish-url") + 1].rstrip("/")
    publish_key = None
    if "--publish-key" in sys.argv:
        publish_key = sys.argv[sys.argv.index("--publish-key") + 1]
    if publish_url and not publish_key:
        print("--publish-url was given without --publish-key — both are required to publish.")
        sys.exit(1)

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
            "fabricType": r["FabricType"] or "—",
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

    if publish_url:
        if not rows:
            print("Nothing to publish (0 rows extracted).")
            return
        payload = json.dumps({"machineId": machine_id, "machineLabel": machine_label, "rows": rows}).encode("utf-8")
        req = urllib.request.Request(
            f"{publish_url}/api/publish-machine",
            data=payload,
            method="POST",
            headers={"Content-Type": "application/json", "X-Publish-Key": publish_key},
        )
        try:
            with urllib.request.urlopen(req) as resp:
                print(f"Published {len(rows)} rows to {publish_url} -> HTTP {resp.status}")
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")
            print(f"Publish failed: HTTP {e.code} — {body}")
            sys.exit(1)

if __name__ == "__main__":
    main()
