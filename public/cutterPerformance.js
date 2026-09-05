// Cutter Performance view — wires cutter-performance-logic.js (pure
// calculations) to the DOM. Data comes from real next2.db extracts, either
// pre-published under public/data/ (see extract-next2.py / README.md) or
// browsed live in the page (next2-browser-reader.js) and published from
// here — never a hand-filled spreadsheet, by design: the desktop app's own
// source of truth for this module is the cutter's database.

(function () {
  let cpLoaded = false;
  let cpRows = []; // active rows for the current machine / preview
  let targetSpeed = 12;
  let MACHINES = []; // loaded from data/machines.js
  let previewData = null; // { machineId, machineLabel, rows } — set by Preview, cleared once published or a saved machine is picked

  // Period viewer state (Day / Week / Month / Year / Custom range / All) —
  // mirrors the desktop dashboard's period filter bar, see
  // computeSelectedRange()/stepReferenceDate() in cutter-performance-logic.js.
  let period = "all";
  let referenceDate = new Date();
  let customFrom = null;
  let customTo = null;

  async function initCutterPerformance() {
    if (cpLoaded) return;
    cpLoaded = true;

    const machineSelect = document.getElementById("cp-machine");
    const targetSlider = document.getElementById("cp-target-speed");
    targetSlider.addEventListener("input", () => {
      targetSpeed = Number(targetSlider.value);
      document.getElementById("cp-target-speed-value").textContent = `${targetSpeed.toFixed(1)} m/min`;
      if (cpRows.length) {
        CutterPerf.applyTargetSpeed(cpRows, targetSpeed);
        renderAll();
      }
    });

    document.getElementById("cp-search").addEventListener("input", renderAll);
    initPeriodPanel();

    try {
      await loadDataScript("data/machines.js");
      MACHINES = (window.__BEE4STITCH_DATA__ && window.__BEE4STITCH_DATA__.machines) || [];
    } catch (err) {
      console.error(err);
      MACHINES = [];
    }

    machineSelect.innerHTML = MACHINES.map((m) => `<option value="${m.id}">${escapeHtml(m.label)}</option>`).join("");
    machineSelect.addEventListener("change", () => {
      previewData = null;
      setPublishStatus("");
      loadNext2Dataset(machineSelect.value);
    });

    initPublishPanel();

    if (MACHINES.length) {
      await loadNext2Dataset(MACHINES[0].id);
    } else {
      setStatus(
        "No customers published yet — use “Add or update a customer” below to browse a next2.db and publish the first one.",
        false
      );
      renderAll();
    }
  }

  // ---------- Period viewer: Day / Week / Month / Year / Custom range / All ----------
  function toDateInputValue(d) {
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  function toDateTimeInputValue(d) {
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function fromDateInputValue(v, fallback) {
    if (!v) return fallback;
    const [y, m, d] = v.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  function fromDateTimeInputValue(v, fallback) {
    if (!v) return fallback;
    const [datePart, timePart] = v.split("T");
    const [y, m, d] = datePart.split("-").map(Number);
    const [h, mi] = (timePart || "00:00").split(":").map(Number);
    return new Date(y, m - 1, d, h || 0, mi || 0);
  }

  // Anchors the period viewer to a newly-loaded dataset's own date range —
  // called whenever a machine (or a preview) is loaded, so Day/Week/Month/
  // Year land on real data by default instead of on today's empty date.
  function setReferenceDateFromRows(rows) {
    if (rows.length) {
      referenceDate = rows.reduce((max, r) => (r.end > max ? r.end : max), rows[0].end);
    } else {
      referenceDate = new Date();
    }
    customTo = new Date(referenceDate);
    customFrom = new Date(referenceDate.getTime() - 7 * 86400000);
  }

  // Re-syncs the period panel's controls to current state (period,
  // referenceDate, customFrom/customTo) — called on init, on every
  // interaction with the panel, AND after a machine/preview loads (since
  // setReferenceDateFromRows() re-anchors referenceDate/customFrom/customTo
  // to that dataset's own date range).
  function syncPeriodControls() {
    const periodSelect = document.getElementById("cp-period");
    const refDateInput = document.getElementById("cp-ref-date");
    const customFromInput = document.getElementById("cp-custom-from");
    const customToInput = document.getElementById("cp-custom-to");
    const customSep = document.getElementById("cp-custom-sep");
    const prevBtn = document.getElementById("cp-period-prev");
    const nextBtn = document.getElementById("cp-period-next");
    if (!periodSelect) return; // panel not in the DOM yet

    const isCustom = period === "custom";
    const isAll = period === "all";
    periodSelect.value = period;
    refDateInput.classList.toggle("hidden", isCustom || isAll);
    customFromInput.classList.toggle("hidden", !isCustom);
    customToInput.classList.toggle("hidden", !isCustom);
    customSep.classList.toggle("hidden", !isCustom);
    prevBtn.disabled = isAll;
    nextBtn.disabled = isAll;
    refDateInput.value = toDateInputValue(referenceDate);
    if (customFrom) customFromInput.value = toDateTimeInputValue(customFrom);
    if (customTo) customToInput.value = toDateTimeInputValue(customTo);

    const label = document.getElementById("cp-period-label");
    if (label) label.textContent = CutterPerf.formatPeriodLabel(period, currentRange());
  }

  function initPeriodPanel() {
    const periodSelect = document.getElementById("cp-period");
    const refDateInput = document.getElementById("cp-ref-date");
    const customFromInput = document.getElementById("cp-custom-from");
    const customToInput = document.getElementById("cp-custom-to");
    const prevBtn = document.getElementById("cp-period-prev");
    const nextBtn = document.getElementById("cp-period-next");

    syncPeriodControls();

    periodSelect.addEventListener("change", () => {
      period = periodSelect.value;
      syncPeriodControls();
      renderAll();
    });
    refDateInput.addEventListener("change", () => {
      referenceDate = fromDateInputValue(refDateInput.value, referenceDate);
      syncPeriodControls();
      renderAll();
    });
    customFromInput.addEventListener("change", () => {
      customFrom = fromDateTimeInputValue(customFromInput.value, customFrom);
      syncPeriodControls();
      renderAll();
    });
    customToInput.addEventListener("change", () => {
      customTo = fromDateTimeInputValue(customToInput.value, customTo);
      syncPeriodControls();
      renderAll();
    });
    prevBtn.addEventListener("click", () => {
      if (period === "custom") {
        const stepped = CutterPerf.stepCustomRange(customFrom, customTo, -1);
        customFrom = stepped.start;
        customTo = stepped.end;
      } else {
        referenceDate = CutterPerf.stepReferenceDate(period, referenceDate, -1);
      }
      syncPeriodControls();
      renderAll();
    });
    nextBtn.addEventListener("click", () => {
      if (period === "custom") {
        const stepped = CutterPerf.stepCustomRange(customFrom, customTo, 1);
        customFrom = stepped.start;
        customTo = stepped.end;
      } else {
        referenceDate = CutterPerf.stepReferenceDate(period, referenceDate, 1);
      }
      syncPeriodControls();
      renderAll();
    });
  }

  function currentRange() {
    return CutterPerf.computeSelectedRange(period, referenceDate, customFrom, customTo);
  }

  async function loadNext2Dataset(machineId) {
    const machine = MACHINES.find((m) => m.id === machineId) || MACHINES[0];
    if (!machine) return;
    setStatus(`Loading real production data from ${machine.label}'s next2.db extract…`);
    try {
      await loadDataScript(machine.url);
      const dataset = window.__BEE4STITCH_DATA__ && window.__BEE4STITCH_DATA__.next2 && window.__BEE4STITCH_DATA__.next2[machine.id];
      if (!dataset) {
        throw new Error(
          `${machine.url} loaded but didn't contain data for machine id "${machine.id}" — check the file was ` +
            `generated with that exact id (extract-next2.py's <machine-id> argument, or the Machine ID field above).`
        );
      }
      // Clone so re-selecting this machine later starts from clean strings,
      // not Date objects mutated by a previous load.
      const raw = dataset.map((r) => ({ ...r, start: new Date(r.start), end: new Date(r.end) }));
      CutterPerf.applyTargetSpeed(raw, targetSpeed);
      cpRows = raw;
      setReferenceDateFromRows(raw);
      syncPeriodControls();
      setStatus(`Loaded ${raw.length.toLocaleString()} real rows from ${machine.label}'s next2.db.`);
      renderAll();
    } catch (err) {
      setStatus(`Could not load ${machine.label}'s next2.db extract: ${err.message}`, true);
      console.error(err);
      cpRows = [];
      renderAll();
    }
  }

  function setStatus(text, isError) {
    const el = document.getElementById("cp-status-banner");
    el.textContent = text || "";
    el.classList.toggle("hidden", !text);
    el.classList.toggle("cp-status-error", !!isError);
  }

  // ---------- Add/update a customer: Browse -> Preview -> Publish ----------
  function initPublishPanel() {
    const idInput = document.getElementById("cp-new-id");
    const labelInput = document.getElementById("cp-new-label");
    const sinceInput = document.getElementById("cp-new-since");
    const fileInput = document.getElementById("cp-new-file");
    const previewBtn = document.getElementById("cp-preview-btn");
    const publishBtn = document.getElementById("cp-publish-btn");
    const keyInput = document.getElementById("cp-publish-key");

    // Remember the publish key for this browser session only, same as the
    // login gate — one less thing to retype, not meant as real security.
    try {
      const saved = sessionStorage.getItem("bee4stitch_publish_key");
      if (saved) keyInput.value = saved;
    } catch (e) {
      /* sessionStorage unavailable — fine, just re-enter each time */
    }
    keyInput.addEventListener("input", () => {
      try {
        sessionStorage.setItem("bee4stitch_publish_key", keyInput.value);
      } catch (e) {
        /* ignore */
      }
    });

    previewBtn.addEventListener("click", async () => {
      const machineId = idInput.value.trim();
      const machineLabel = labelInput.value.trim();
      const file = fileInput.files && fileInput.files[0];

      if (!machineId || !machineLabel) {
        setPublishStatus("Fill in both Machine ID and Display label first.", true);
        return;
      }
      if (!/^[a-z0-9-]+$/.test(machineId)) {
        setPublishStatus("Machine ID should be lowercase letters, numbers and hyphens only (e.g. j-tex-1).", true);
        return;
      }
      if (!file) {
        setPublishStatus("Choose a next2.db file first.", true);
        return;
      }

      previewBtn.disabled = true;
      publishBtn.disabled = true;
      setPublishStatus(`Reading ${file.name}…`);
      try {
        const { rows, skipped } = await Next2BrowserReader.extractFromFile(file, {
          machineLabel,
          since: sinceInput.value || null,
        });
        if (!rows.length) {
          throw new Error(
            "Read the file but found 0 matching rows — check it's the right next2.db and the “Since” " +
              "date (if set) isn't excluding everything."
          );
        }
        previewData = { machineId, machineLabel, rows };
        setStatus(`Previewing ${rows.length.toLocaleString()} unpublished rows from "${file.name}" — not yet saved online.`);
        const clonedForDisplay = rows.map((r) => ({ ...r, start: new Date(r.start), end: new Date(r.end) }));
        CutterPerf.applyTargetSpeed(clonedForDisplay, targetSpeed);
        cpRows = clonedForDisplay;
        setReferenceDateFromRows(clonedForDisplay);
        syncPeriodControls();
        renderAll();
        setPublishStatus(
          `Loaded ${rows.length.toLocaleString()} rows${skipped ? ` (${skipped} skipped: bad timestamps)` : ""} — ` +
            `showing the preview above. Enter your publish key and click Publish to make it live.`,
          false,
          true
        );
        publishBtn.disabled = false;
      } catch (err) {
        console.error(err);
        setPublishStatus(err.message, true);
        previewData = null;
      } finally {
        previewBtn.disabled = false;
      }
    });

    publishBtn.addEventListener("click", async () => {
      if (!previewData) {
        setPublishStatus("Preview a file first.", true);
        return;
      }
      const key = keyInput.value;
      if (!key) {
        setPublishStatus("Enter the publish key first — ask whoever set up this site's Vercel project for it.", true);
        return;
      }

      publishBtn.disabled = true;
      previewBtn.disabled = true;
      setPublishStatus(`Publishing ${previewData.rows.length.toLocaleString()} rows for "${previewData.machineLabel}"…`);
      try {
        const res = await fetch("/api/publish-machine", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Publish-Key": key },
          body: JSON.stringify(previewData),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(body.error || `Server responded with ${res.status}`);
        }
        setPublishStatus(
          `Published. Vercel is redeploying now — reload this page in about a minute and "${previewData.machineLabel}" ` +
            `will be in the machine picker above.`,
          false,
          true
        );
        previewData = null;
      } catch (err) {
        console.error(err);
        const msg = err.message.replace(/\.?\s*$/, "");
        setPublishStatus(
          `Publish failed: ${msg}. If this is the first time, check the README's "Setting up automatic publish" ` +
            `section — this needs a one-time GitHub + Vercel setup.`,
          true
        );
      } finally {
        publishBtn.disabled = !previewData ? true : false;
        previewBtn.disabled = false;
      }
    });
  }

  function setPublishStatus(text, isError, isOk) {
    const el = document.getElementById("cp-publish-status");
    el.textContent = text || "";
    el.classList.toggle("cp-status-error", !!isError);
    el.classList.toggle("cp-status-ok", !!isOk);
  }

  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  // ---------- Rendering ----------
  function filteredRows() {
    const q = document.getElementById("cp-search").value.trim().toLowerCase();

    let rows = cpRows;
    const range = currentRange();
    if (range) {
      // A row belongs to the period its job STARTED in — same field the
      // desktop app's own "date" bucketing uses.
      rows = rows.filter((r) => r.start >= range.start && r.start < range.end);
    }
    if (q) {
      rows = rows.filter((r) =>
        [r.markerName, r.machine, r.order, r.style, r.operator].some((f) => String(f).toLowerCase().includes(q))
      );
    }
    return rows;
  }

  function renderAll() {
    const rows = filteredRows();
    renderKpis(rows);
    renderChart(rows);
    renderTable(rows);
    syncPeriodControls();
  }

  function fmt(n, digits = 0) {
    return Number(n).toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
  }

  function fmtMinutes(min) {
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  function renderKpis(rows) {
    const k = CutterPerf.computeKpis(rows);
    const grid = document.getElementById("cp-kpis");
    grid.innerHTML = [
      tile("Available", fmtMinutes(k.availableMin)),
      tile("Machine Consumed", fmtMinutes(k.machineConsumedMin)),
      tile("Active Cutting", fmtMinutes(k.activeCuttingMin)),
      tile("Machine Idle/Delays", fmtMinutes(k.machineIdleDelayMin)),
      tile("Total Cut Perimeter", `${fmt(k.totalCutPerimeterM)} m`),
      tile("Average Cut", `${fmt(k.averageCutSpeed, 2)} m/min`),
      tile("Speed Attainment", k.speedTargetAttainmentPct === null ? "—" : `${fmt(k.speedTargetAttainmentPct, 1)}%`),
      tile("Completed Jobs", fmt(k.completedJobs)),
    ].join("");
  }

  function tile(label, value) {
    return `<div class="kpi-card">
      <div class="kpi-label">${label}</div>
      <div class="kpi-value">${value}</div>
    </div>`;
  }

  function renderChart(rows) {
    const trend = CutterPerf.computeTrend(rows);
    const canvas = document.getElementById("cp-chart");
    if (trend.length === 0) {
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    const values = trend.map((d) => d.avgAttainmentPct);
    const lo = Math.max(0, Math.floor(Math.min(...values, 100) / 10) * 10 - 10);
    const hi = Math.ceil(Math.max(...values, 100) / 10) * 10 + 10;
    drawLineChart(
      canvas,
      trend.map((d) => d.date.slice(5)),
      values,
      { min: lo, max: hi }
    );
  }

  const STATUS_CLASS = {
    Critical: "bad",
    "Below target": "warn",
    "On target": "good",
    "Review over-speed": "warn",
    "Benchmark unavailable": "warn",
  };

  function renderTable(rows) {
    const note = document.getElementById("cp-table-note");
    const cap = 200;
    const shown = rows.slice(0, cap).sort((a, b) => b.end - a.end);
    note.textContent =
      rows.length > cap
        ? `Showing the most recent ${cap} of ${rows.length.toLocaleString()} matching rows — narrow the date range or search to see others.`
        : `${rows.length.toLocaleString()} row(s).`;

    const table = document.getElementById("cp-table");
    table.innerHTML = `
      <thead><tr>
        <th>Marker Name</th><th>Machine</th><th>Order</th><th>Start</th><th>End</th>
        <th>Used</th><th>Delay</th><th>Delay State</th><th>Speed (m/min)</th>
        <th>Speed vs Target</th><th>Performance Status</th><th>Perimeter (m)</th><th>Plies</th>
      </tr></thead>
      <tbody>
        ${shown
          .map(
            (r) => `<tr>
          <td>${escapeHtml(r.markerName)}</td>
          <td>${escapeHtml(r.machine)}</td>
          <td>${escapeHtml(r.order)}</td>
          <td>${r.start.toLocaleString()}</td>
          <td>${r.end.toLocaleString()}</td>
          <td>${fmtMinutes(r.usedMin)}</td>
          <td>${fmtMinutes(r.delayMin)}</td>
          <td>${escapeHtml(r.delayState)}</td>
          <td>${fmt(r.speed, 2)}</td>
          <td>${r.speedAttainmentPct === null ? "—" : fmt(r.speedAttainmentPct, 1) + "%"}</td>
          <td><span class="pill ${STATUS_CLASS[r.performanceStatus] || "warn"}">${escapeHtml(r.performanceStatus)}</span></td>
          <td>${fmt(r.perimeterM, 1)}</td>
          <td>${r.plies === null ? "—" : fmt(r.plies)}</td>
        </tr>`
          )
          .join("")}
      </tbody>
    `;
  }

  window.initCutterPerformance = initCutterPerformance;
})();
