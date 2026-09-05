// One-off generator for sample dashboard data. Not part of the deployed app.
const fs = require("fs");

function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}
const rand = seeded(42);

const styles = ["ST-4021", "ST-4055", "ST-4102", "ST-4180", "ST-4233", "ST-4310"];
const fabrics = ["Cotton Poplin 58\"", "Denim 12oz 60\"", "Fleece 62\"", "Twill 56\"", "Jersey Knit 64\""];
const operators = ["A. Rafiq", "M. Bilal", "S. Kanwal", "U. Farooq", "H. Naveed"];
const buyers = ["Morgan EU", "Morgan US", "Morgan UK", "Nexus Retail"];

const rows = [];
const today = new Date("2026-09-04T00:00:00Z");

for (let i = 89; i >= 0; i--) {
  const d = new Date(today);
  d.setUTCDate(d.getUTCDate() - i);
  const markersToday = 1 + Math.floor(rand() * 3);
  for (let m = 0; m < markersToday; m++) {
    const plannedLen = 12 + rand() * 20;
    const baseEff = 78 + rand() * 16; // 78-94
    const efficiency = Math.round(baseEff * 10) / 10;
    const actualLen = Math.round((plannedLen * (100 / efficiency)) * 100) / 100;
    rows.push({
      date: d.toISOString().slice(0, 10),
      markerName: `MK-${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}-${m + 1}`,
      style: styles[Math.floor(rand() * styles.length)],
      order: `ORD-${20000 + Math.floor(rand() * 8000)}`,
      buyer: buyers[Math.floor(rand() * buyers.length)],
      fabric: fabrics[Math.floor(rand() * fabrics.length)],
      operator: operators[Math.floor(rand() * operators.length)],
      plannedLengthM: Math.round(plannedLen * 100) / 100,
      actualLengthM: actualLen,
      efficiencyPct: efficiency,
      plies: 40 + Math.floor(rand() * 120),
    });
  }
}

// Dashboard: last 14 days aggregated
const byDay = {};
for (const r of rows) {
  byDay[r.date] = byDay[r.date] || { date: r.date, effSum: 0, count: 0 };
  byDay[r.date].effSum += r.efficiencyPct;
  byDay[r.date].count += 1;
}
const dailyAvg = Object.values(byDay)
  .map((d) => ({ date: d.date, avgEfficiency: Math.round((d.effSum / d.count) * 10) / 10 }))
  .sort((a, b) => (a.date < b.date ? -1 : 1));

const last14 = dailyAvg.slice(-14);
const last30rows = rows.filter((r) => r.date >= dailyAvg.slice(-30)[0].date);

const overallAvgEff = Math.round((rows.reduce((s, r) => s + r.efficiencyPct, 0) / rows.length) * 10) / 10;
const last30AvgEff = Math.round((last30rows.reduce((s, r) => s + r.efficiencyPct, 0) / last30rows.length) * 10) / 10;
const prev30rows = rows.filter((r) => {
  const idx = dailyAvg.findIndex((d) => d.date === r.date);
  return idx >= dailyAvg.length - 60 && idx < dailyAvg.length - 30;
});
const prev30AvgEff = Math.round((prev30rows.reduce((s, r) => s + r.efficiencyPct, 0) / prev30rows.length) * 10) / 10;

const dashboard = {
  kpis: {
    avgEfficiency30d: last30AvgEff,
    avgEfficiencyDeltaPct: Math.round((last30AvgEff - prev30AvgEff) * 10) / 10,
    markersLast30d: last30rows.length,
    totalFabricLast30dM: Math.round(last30rows.reduce((s, r) => s + r.actualLengthM, 0)),
    activeOrders: new Set(last30rows.map((r) => r.order)).size,
  },
  trend14d: last14,
  recentMarkers: rows.slice(-10).reverse(),
};

const markerEfficiency = {
  kpis: {
    avgEfficiency: overallAvgEff,
    avgEfficiency30d: last30AvgEff,
    bestMarker: rows.reduce((best, r) => (r.efficiencyPct > best.efficiencyPct ? r : best), rows[0]),
    worstMarker: rows.reduce((worst, r) => (r.efficiencyPct < worst.efficiencyPct ? r : worst), rows[0]),
  },
  trend: dailyAvg,
  markers: rows.slice().reverse(),
};

// Written as .js (window.__BEE4STITCH_DATA__ assignments), not .json — loaded
// via a <script> tag rather than fetch() so the site works opened directly
// from disk (file://). See the comment atop public/app.js for why.
fs.writeFileSync(
  "./public/data/dashboard.js",
  `window.__BEE4STITCH_DATA__ = window.__BEE4STITCH_DATA__ || {};\nwindow.__BEE4STITCH_DATA__.dashboard = ${JSON.stringify(dashboard)};\n`
);
fs.writeFileSync(
  "./public/data/marker-efficiency.js",
  `window.__BEE4STITCH_DATA__ = window.__BEE4STITCH_DATA__ || {};\nwindow.__BEE4STITCH_DATA__.markerEfficiency = ${JSON.stringify(markerEfficiency)};\n`
);
console.log("Generated", rows.length, "sample marker rows.");
