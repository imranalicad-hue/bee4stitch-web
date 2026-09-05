// Bee4Stitch Web — preview shell.
// Data layer: static data files under /data, loaded as plain <script> tags
// (see loadDataScript below) rather than fetch()/XHR. That's deliberate: a
// page opened directly from disk (file://, i.e. double-clicking index.html)
// has fetch() of local files blocked by every major browser, but a <script
// src="..."> tag loads local files just fine under file:// — it's a normal
// resource load, not subject to the same restriction. Each data file just
// assigns into window.__BEE4STITCH_DATA__ instead of being JSON that has to
// be fetched. This is what lets the whole site work from a plain
// double-click, with no local server required.
//
// Swap this for real API calls (e.g. fetch("/api/marker-efficiency")) once
// there's a service in front of the Morgan MasterMind SQL Server — at that
// point the site will need to be served over HTTP anyway.

const __loadedDataScripts = new Set();

function loadDataScript(path) {
  if (__loadedDataScripts.has(path)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = path;
    s.onload = () => {
      __loadedDataScripts.add(path);
      resolve();
    };
    s.onerror = () => reject(new Error(`Failed to load ${path} — check the file exists next to index.html.`));
    document.head.appendChild(s);
  });
}

function fmtNum(n, digits = 0) {
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function effPillClass(eff) {
  if (eff >= 88) return "good";
  if (eff >= 80) return "warn";
  return "bad";
}

// ---------- Lightweight canvas line chart (no external chart library) ----------
function drawLineChart(canvas, labels, values, { min, max, suffix = "%" } = {}) {
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = canvas.parentElement.clientWidth;
  const cssHeight = Number(canvas.getAttribute("height")) || 90;
  canvas.width = cssWidth * dpr;
  canvas.height = cssHeight * dpr;
  canvas.style.width = cssWidth + "px";
  canvas.style.height = cssHeight + "px";
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  const padL = 34, padR = 10, padT = 10, padB = 20;
  const w = cssWidth - padL - padR;
  const h = cssHeight - padT - padB;

  const lo = min ?? Math.min(...values);
  const hi = max ?? Math.max(...values);
  const range = hi - lo || 1;

  // gridlines + y labels
  ctx.strokeStyle = "#e0e8e3";
  ctx.fillStyle = "#5c6b63";
  ctx.font = "10.5px Segoe UI, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  const steps = 4;
  for (let i = 0; i <= steps; i++) {
    const val = lo + (range * i) / steps;
    const y = padT + h - (h * i) / steps;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + w, y);
    ctx.stroke();
    ctx.fillText(Math.round(val) + suffix, padL - 6, y);
  }

  // line + fill
  const points = values.map((v, i) => ({
    x: padL + (values.length === 1 ? 0 : (w * i) / (values.length - 1)),
    y: padT + h - ((v - lo) / range) * h,
  }));

  ctx.beginPath();
  ctx.moveTo(points[0].x, padT + h);
  points.forEach((p) => ctx.lineTo(p.x, p.y));
  ctx.lineTo(points[points.length - 1].x, padT + h);
  ctx.closePath();
  ctx.fillStyle = "rgba(42,122,82,0.12)";
  ctx.fill();

  ctx.beginPath();
  points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.strokeStyle = "#2a7a52";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = "#2a7a52";
  points.forEach((p) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  });

  // x labels (sparse)
  ctx.fillStyle = "#5c6b63";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const labelEvery = Math.max(1, Math.ceil(labels.length / 8));
  labels.forEach((lab, i) => {
    if (i % labelEvery === 0 || i === labels.length - 1) {
      ctx.fillText(lab, points[i].x, padT + h + 6);
    }
  });
}

// ---------- Navigation ----------
const views = {
  dashboard: { title: "Dashboard", el: document.getElementById("view-dashboard") },
  "marker-efficiency": { title: "Marker Efficiency", el: document.getElementById("view-marker-efficiency") },
  "production-summary": { title: "Production Summary", el: document.getElementById("view-production-summary") },
  "cutter-performance": { title: "Cutter Performance", el: document.getElementById("view-cutter-performance") },
  "ofin-roll": { title: "OFIN Roll Analysis", el: document.getElementById("view-ofin-roll") },
  "lot-inventory": { title: "Lot Inventory", el: document.getElementById("view-lot-inventory") },
};

function showView(name) {
  Object.entries(views).forEach(([key, v]) => {
    v.el.classList.toggle("hidden", key !== name);
  });
  document.getElementById("view-title").textContent = views[name].title;
  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === name);
  });
  if (name === "dashboard" && !dashboardLoaded) loadDashboard();
  if (name === "marker-efficiency" && !markerEffLoaded) loadMarkerEfficiency();
  if (name === "cutter-performance" && typeof initCutterPerformance === "function") initCutterPerformance();
}

document.querySelectorAll(".nav-item").forEach((btn) => {
  btn.addEventListener("click", () => showView(btn.dataset.view));
});

// ---------- Dashboard ----------
let dashboardLoaded = false;

async function loadDashboard() {
  dashboardLoaded = true;
  let data;
  try {
    await loadDataScript("data/dashboard.js");
    data = window.__BEE4STITCH_DATA__ && window.__BEE4STITCH_DATA__.dashboard;
    if (!data) throw new Error("data/dashboard.js loaded but didn't set the expected data.");
  } catch (err) {
    console.error(err);
    document.getElementById("dashboard-kpis").innerHTML = "";
    document.getElementById("dashboard-table").innerHTML = "";
    return;
  }

  const kpiGrid = document.getElementById("dashboard-kpis");
  const k = data.kpis;
  kpiGrid.innerHTML = `
    ${kpiCard("Avg Efficiency (30d)", `${fmtNum(k.avgEfficiency30d, 1)}%`, k.avgEfficiencyDeltaPct)}
    ${kpiCard("Markers Produced (30d)", fmtNum(k.markersLast30d))}
    ${kpiCard("Fabric Consumed (30d)", `${fmtNum(k.totalFabricLast30dM)} m`)}
    ${kpiCard("Active Orders", fmtNum(k.activeOrders))}
  `;

  drawLineChart(
    document.getElementById("dashboard-chart"),
    data.trend14d.map((d) => d.date.slice(5)),
    data.trend14d.map((d) => d.avgEfficiency),
    { min: 70, max: 100 }
  );

  const table = document.getElementById("dashboard-table");
  table.innerHTML = markerTable(data.recentMarkers);
}

function kpiCard(label, value, deltaPct) {
  let delta = "";
  if (typeof deltaPct === "number") {
    const cls = deltaPct >= 0 ? "up" : "down";
    const sign = deltaPct >= 0 ? "+" : "";
    delta = `<div class="kpi-delta ${cls}">${sign}${fmtNum(deltaPct, 1)} pts vs prior 30d</div>`;
  }
  return `<div class="kpi-card">
    <div class="kpi-label">${label}</div>
    <div class="kpi-value">${value}</div>
    ${delta}
  </div>`;
}

function markerTable(rows) {
  return `
    <thead><tr>
      <th>Date</th><th>Marker</th><th>Style</th><th>Order</th><th>Buyer</th>
      <th>Operator</th><th>Plies</th><th>Length (m)</th><th>Efficiency</th>
    </tr></thead>
    <tbody>
      ${rows
        .map(
          (r) => `<tr>
        <td>${r.date}</td>
        <td>${r.markerName}</td>
        <td>${r.style}</td>
        <td>${r.order}</td>
        <td>${r.buyer}</td>
        <td>${r.operator}</td>
        <td>${r.plies}</td>
        <td>${fmtNum(r.actualLengthM, 2)}</td>
        <td><span class="pill ${effPillClass(r.efficiencyPct)}">${fmtNum(r.efficiencyPct, 1)}%</span></td>
      </tr>`
        )
        .join("")}
    </tbody>
  `;
}

// ---------- Marker Efficiency ----------
let markerEffLoaded = false;
let meData = null;

async function loadMarkerEfficiency() {
  markerEffLoaded = true;
  try {
    await loadDataScript("data/marker-efficiency.js");
    meData = window.__BEE4STITCH_DATA__ && window.__BEE4STITCH_DATA__.markerEfficiency;
    if (!meData) throw new Error("data/marker-efficiency.js loaded but didn't set the expected data.");
  } catch (err) {
    console.error(err);
    return;
  }

  const k = meData.kpis;
  document.getElementById("me-kpis").innerHTML = `
    ${kpiCard("Avg Efficiency (all time)", `${fmtNum(k.avgEfficiency, 1)}%`)}
    ${kpiCard("Avg Efficiency (30d)", `${fmtNum(k.avgEfficiency30d, 1)}%`)}
    ${kpiCard("Best Marker", `${fmtNum(k.bestMarker.efficiencyPct, 1)}%`, undefined)}
    ${kpiCard("Lowest Marker", `${fmtNum(k.worstMarker.efficiencyPct, 1)}%`, undefined)}
  `;

  renderMeChart(30);
  renderMeTable(meData.markers);

  document.getElementById("me-range").addEventListener("change", (e) => {
    renderMeChart(Number(e.target.value));
  });
  document.getElementById("me-search").addEventListener("input", (e) => {
    const q = e.target.value.trim().toLowerCase();
    const filtered = !q
      ? meData.markers
      : meData.markers.filter((r) =>
          [r.markerName, r.style, r.order, r.buyer, r.operator].some((f) => f.toLowerCase().includes(q))
        );
    renderMeTable(filtered);
  });
}

function renderMeChart(days) {
  const slice = meData.trend.slice(-days);
  drawLineChart(
    document.getElementById("me-chart"),
    slice.map((d) => d.date.slice(5)),
    slice.map((d) => d.avgEfficiency),
    { min: 70, max: 100 }
  );
}

function renderMeTable(rows) {
  document.getElementById("me-table").innerHTML = markerTable(rows.slice(0, 60));
}

// ---------- Resize ----------
let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (!views.dashboard.el.classList.contains("hidden") && dashboardLoaded) loadDashboard();
    if (!views["marker-efficiency"].el.classList.contains("hidden") && markerEffLoaded) {
      renderMeChart(Number(document.getElementById("me-range").value));
    }
  }, 150);
});

// ---------- Init ----------
loadDashboard();
