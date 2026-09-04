/* Agent Latency Lab — DevTools panel logic. No build step, no dependencies. */
"use strict";

// ---------- State ----------
const MAX_REQUESTS = 2000;
const state = {
  requests: [],        // captured entries (see captureEntry)
  paused: false,
  filter: "",
  groupTraces: true,
  selectedId: null,
  alerts: [],
  settings: { threshold: 2000, target: 95, window: 100, trials: 5000, measure: "total" },
};
let seq = 0;

// ---------- Helpers ----------
const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const fmtMs = (ms) => (ms >= 1000 ? (ms / 1000).toFixed(2) + " s" : Math.round(ms) + " ms");
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function parseTraceparent(value) {
  const m = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i.exec((value || "").trim());
  if (!m) return null;
  if (m[2] === "0".repeat(32) || m[3] === "0".repeat(16)) return null; // invalid per spec
  return { version: m[1], traceId: m[2].toLowerCase(), spanId: m[3].toLowerCase(), flags: m[4], sampled: (parseInt(m[4], 16) & 1) === 1 };
}

function headerValue(headers, name) {
  const h = (headers || []).find((x) => x.name.toLowerCase() === name);
  return h ? h.value : null;
}

function quantile(sorted, q) {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function pathLabel(url) {
  try {
    const u = new URL(url);
    return u.host + (u.pathname.length > 1 ? u.pathname : "");
  } catch { return url; }
}

// ---------- Capture ----------
function captureEntry(har) {
  const t = har.timings || {};
  const setup = Math.max(0, t.blocked || 0) + Math.max(0, t.dns || 0) + Math.max(0, t.connect || 0) + Math.max(0, t.send || 0);
  const wait = Math.max(0, t.wait || 0);
  const recv = Math.max(0, t.receive || 0);
  const tp = parseTraceparent(headerValue(har.request.headers, "traceparent"));
  return {
    id: ++seq,
    url: har.request.url,
    method: har.request.method,
    status: har.response ? har.response.status : 0,
    start: new Date(har.startedDateTime).getTime(),
    total: Math.max(0, har.time || setup + wait + recv),
    setup, wait, recv,
    traceparent: tp,
    tracestate: headerValue(har.request.headers, "tracestate"),
    mime: har.response && har.response.content ? har.response.content.mimeType : "",
  };
}

chrome.devtools.network.onRequestFinished.addListener((har) => {
  if (state.paused) return;
  try {
    const entry = captureEntry(har);
    state.requests.push(entry);
    if (state.requests.length > MAX_REQUESTS) state.requests.shift();
    checkAlerts(entry);
    scheduleRender();
  } catch (e) { /* ignore malformed entries */ }
});

// ---------- Alerts ----------
function checkAlerts(entry) {
  const th = state.settings.threshold;
  if (entry.status >= 500) {
    state.alerts.unshift({ when: Date.now(), kind: "error", url: entry.url, value: "HTTP " + entry.status });
  } else if (entry.total > th) {
    state.alerts.unshift({ when: Date.now(), kind: "breach", url: entry.url, value: fmtMs(entry.total) });
  } else {
    return;
  }
  if (state.alerts.length > 500) state.alerts.pop();
  renderAlerts();
}

function renderAlerts() {
  const feed = $("#alert-feed");
  feed.textContent = "";
  const badge = $("#alert-badge");
  badge.hidden = state.alerts.length === 0;
  badge.textContent = String(state.alerts.length);
  if (!state.alerts.length) {
    feed.append(el("li", "empty dim", "No alerts yet — that's the goal."));
    return;
  }
  for (const a of state.alerts.slice(0, 200)) {
    const li = el("li");
    li.append(
      el("span", "dim", new Date(a.when).toLocaleTimeString()),
      el("span", "alert-kind " + a.kind, a.kind === "breach" ? "SLO breach" : "Server error"),
      el("span", "alert-url", pathLabel(a.url)),
      el("span", "alert-val", a.value)
    );
    feed.append(li);
  }
}

// ---------- Waterfall ----------
function visibleRequests() {
  const f = state.filter.toLowerCase();
  return f ? state.requests.filter((r) => r.url.toLowerCase().includes(f)) : state.requests.slice();
}

function renderWaterfall() {
  const root = $("#waterfall");
  const reqs = visibleRequests();
  const traces = new Set(reqs.filter((r) => r.traceparent).map((r) => r.traceparent.traceId));
  $("#capture-count").textContent = `${reqs.length} requests · ${traces.size} traces`;

  root.textContent = "";
  if (!reqs.length) {
    const empty = el("div", "empty");
    empty.append(el("p", null, state.requests.length ? "Nothing matches the current filter." : "No requests captured yet."));
    if (!state.requests.length) empty.append(el("p", "dim", "Keep this panel open and reload the page, or run your agent."));
    root.append(empty);
    return;
  }

  const legend = el("div", "wf-legend");
  legend.append(el("span", "l-setup", "Connection setup"), el("span", "l-wait", "Waiting (TTFB)"), el("span", "l-recv", "Receiving / streaming"));
  root.append(legend);

  let groups;
  if (state.groupTraces) {
    const byTrace = new Map();
    for (const r of reqs) {
      const key = r.traceparent ? r.traceparent.traceId : "__untraced__";
      if (!byTrace.has(key)) byTrace.set(key, []);
      byTrace.get(key).push(r);
    }
    groups = [...byTrace.entries()]
      .map(([key, list]) => ({ key, list }))
      .sort((a, b) => a.list[0].start - b.list[0].start);
    // keep untraced last
    groups.sort((a, b) => (a.key === "__untraced__") - (b.key === "__untraced__"));
  } else {
    groups = [{ key: null, list: reqs }];
  }

  for (const g of groups) {
    const wrap = el("div", "trace-group");
    if (g.key) {
      const head = el("div", "trace-head");
      const span = g.list.length === 1 ? "1 request" : g.list.length + " requests";
      const dur = Math.max(...g.list.map((r) => r.start + r.total)) - Math.min(...g.list.map((r) => r.start));
      head.append(
        el("span", "trace-id", g.key === "__untraced__" ? "Untraced requests" : "trace " + g.key.slice(0, 16) + "…"),
        el("span", "trace-meta", `${span} · ${fmtMs(dur)} end to end`)
      );
      wrap.append(head);
    }
    const t0 = Math.min(...g.list.map((r) => r.start));
    const t1 = Math.max(...g.list.map((r) => r.start + r.total));
    const span = Math.max(1, t1 - t0);
    for (const r of g.list) wrap.append(buildRow(r, t0, span));
    root.append(wrap);
  }
}

function buildRow(r, t0, span) {
  const row = el("div", "wf-row" + (state.selectedId === r.id ? " selected" : ""));
  row.dataset.id = r.id;

  const label = el("div", "wf-label" + (r.status >= 400 ? " err" : ""));
  const method = el("span", "method", r.method);
  label.append(method, document.createTextNode(pathLabel(r.url)));
  label.title = r.url;

  const track = el("div", "wf-track");
  const bar = el("div", "wf-bar" + (r.total > state.settings.threshold ? " breach" : ""));
  bar.style.left = ((r.start - t0) / span * 100).toFixed(3) + "%";
  bar.style.width = clamp(r.total / span * 100, 0.3, 100).toFixed(3) + "%";
  const phases = r.setup + r.wait + r.recv || 1;
  for (const [cls, v] of [["setup", r.setup], ["wait", r.wait], ["recv", r.recv]]) {
    if (v <= 0) continue;
    const seg = el("div", "wf-seg " + cls);
    seg.style.width = (v / phases * 100).toFixed(2) + "%";
    bar.append(seg);
  }
  track.append(bar);

  const ms = el("div", "wf-ms" + (r.total > state.settings.threshold ? " breach" : ""), fmtMs(r.total));
  row.append(label, track, ms);
  row.addEventListener("click", () => selectRequest(r.id));
  return row;
}

function selectRequest(id) {
  state.selectedId = state.selectedId === id ? null : id;
  renderWaterfall();
  const detail = $("#detail");
  const r = state.requests.find((x) => x.id === state.selectedId);
  if (!r) { detail.hidden = true; detail.textContent = ""; return; }
  detail.hidden = false;
  detail.textContent = "";
  const close = el("button", "btn close", "Close");
  close.addEventListener("click", () => selectRequest(id));
  detail.append(close, el("h3", null, r.url));
  const dl = el("dl");
  const add = (k, v) => { dl.append(el("dt", null, k), el("dd", null, v)); };
  add("Status", String(r.status || "—"));
  add("Total", fmtMs(r.total));
  add("Connection setup", fmtMs(r.setup));
  add("Waiting (TTFB)", fmtMs(r.wait));
  add("Receiving", fmtMs(r.recv));
  add("Started", new Date(r.start).toLocaleTimeString());
  if (r.mime) add("Content type", r.mime);
  detail.append(dl);
  if (r.traceparent) {
    const tp = r.traceparent;
    detail.append(el("h3", null, "W3C trace context"));
    const parts = el("p", "tp-parts");
    parts.innerHTML = "";
    parts.append(
      document.createTextNode(tp.version + "-"),
      Object.assign(el("b"), { textContent: tp.traceId }),
      document.createTextNode("-"),
      Object.assign(el("b"), { textContent: tp.spanId }),
      document.createTextNode("-" + tp.flags + (tp.sampled ? "  (sampled)" : "  (not sampled)"))
    );
    detail.append(parts);
    if (r.tracestate) detail.append(el("p", "code", "tracestate: " + r.tracestate));
  } else {
    detail.append(el("p", "dim", "No traceparent header on this request."));
  }
}

// ---------- Percentiles ----------
function renderPercentiles() {
  const reqs = visibleRequests();
  const totals = reqs.map((r) => r.total).sort((a, b) => a - b);
  const waits = reqs.map((r) => r.wait).sort((a, b) => a - b);
  const cards = $("#stat-cards");
  cards.textContent = "";

  const defs = [
    ["Requests", String(totals.length), ""],
    ["p50", totals.length ? fmtMs(quantile(totals, 0.5)) : "—", ""],
    ["p90", totals.length ? fmtMs(quantile(totals, 0.9)) : "—", quantile(totals, 0.9) > state.settings.threshold ? "warn" : ""],
    ["p95", totals.length ? fmtMs(quantile(totals, 0.95)) : "—", quantile(totals, 0.95) > state.settings.threshold ? "warn" : ""],
    ["p99", totals.length ? fmtMs(quantile(totals, 0.99)) : "—", quantile(totals, 0.99) > state.settings.threshold ? "bad" : ""],
    ["Max", totals.length ? fmtMs(totals[totals.length - 1]) : "—", ""],
  ];
  for (const [k, v, mood] of defs) {
    const c = el("div", "stat");
    c.append(el("div", "v " + mood, v), el("div", "k", k));
    cards.append(c);
  }

  // Histogram
  const hist = $("#histogram");
  const axis = $("#hist-axis");
  hist.textContent = ""; axis.textContent = "";
  if (totals.length >= 2) {
    const buckets = 36;
    const max = totals[totals.length - 1];
    const min = totals[0];
    const width = Math.max(1, (max - min) / buckets);
    const counts = new Array(buckets).fill(0);
    for (const v of totals) counts[clamp(Math.floor((v - min) / width), 0, buckets - 1)]++;
    const peak = Math.max(...counts);
    const th = state.settings.threshold;
    counts.forEach((c, i) => {
      const b = el("div", "hbar" + (min + (i + 0.5) * width > th ? " over" : ""));
      b.style.height = (c / peak * 100).toFixed(1) + "%";
      b.title = `${fmtMs(min + i * width)} – ${fmtMs(min + (i + 1) * width)}: ${c}`;
      hist.append(b);
    });
    if (th >= min && th <= max) {
      const line = el("div", "hthresh");
      line.dataset.label = "SLO " + fmtMs(th);
      line.style.left = ((th - min) / (max - min) * 100).toFixed(2) + "%";
      hist.append(line);
    }
    axis.append(el("span", null, fmtMs(min)), el("span", null, fmtMs((min + max) / 2)), el("span", null, fmtMs(max)));
    const under = totals.filter((v) => v <= th).length;
    $("#hist-note").textContent = `${(under / totals.length * 100).toFixed(1)}% of captured requests are under the ${fmtMs(th)} threshold.`;
  } else {
    hist.append(el("div", "dim", "Need at least two requests to draw a distribution."));
    $("#hist-note").textContent = "";
  }

  // TTFB table
  const tbl = $("#ttfb-table");
  tbl.textContent = "";
  const head = el("tr");
  head.append(el("th", null, ""), el("th", null, "p50"), el("th", null, "p90"), el("th", null, "p95"), el("th", null, "p99"));
  tbl.append(head);
  const mkRow = (name, arr) => {
    const tr = el("tr");
    tr.append(el("td", "dim", name));
    for (const q of [0.5, 0.9, 0.95, 0.99]) tr.append(el("td", null, arr.length ? fmtMs(quantile(arr, q)) : "—"));
    return tr;
  };
  tbl.append(mkRow("Total duration", totals), mkRow("Time to first byte", waits));
}

// ---------- Monte Carlo SLO ----------
function runSimulation() {
  const s = state.settings;
  const reqs = visibleRequests();
  const samples = reqs.map((r) => (s.measure === "wait" ? r.wait : r.total)).filter((v) => v >= 0);
  const out = $("#slo-results");
  out.textContent = "";

  if (samples.length < 10) {
    const e = el("div", "empty");
    e.append(el("p", "dim", `Only ${samples.length} matching requests captured — need at least 10 for a meaningful bootstrap. Generate more traffic first.`));
    out.append(e);
    return;
  }

  const trials = clamp(s.trials, 100, 200000);
  const win = clamp(s.window, 5, 100000);
  const targetFrac = s.target / 100;
  const compliances = new Float64Array(trials);
  let met = 0;
  for (let t = 0; t < trials; t++) {
    let under = 0;
    for (let i = 0; i < win; i++) {
      const v = samples[(Math.random() * samples.length) | 0];
      if (v <= s.threshold) under++;
    }
    const frac = under / win;
    compliances[t] = frac;
    if (frac >= targetFrac) met++;
  }
  const sorted = Float64Array.from(compliances).sort();
  const pMeet = met / trials;
  const mean = compliances.reduce((a, b) => a + b, 0) / trials;
  const p5 = sorted[Math.floor(trials * 0.05)];
  const p95c = sorted[Math.floor(trials * 0.95)];
  const empUnder = samples.filter((v) => v <= s.threshold).length / samples.length;
  const expectedBreaches = (1 - mean) * win;

  const verdict = el("div", "slo-verdict " + (pMeet >= 0.99 ? "" : pMeet >= 0.8 ? "warn" : "bad"));
  verdict.append(
    el("div", "big", (pMeet * 100).toFixed(1) + "%"),
    el("div", null, `chance a ${win}-request window meets “${s.target}% under ${fmtMs(s.threshold)}”`),
    el("div", "dim", `${trials.toLocaleString()} bootstrap trials over ${samples.length} captured samples (${s.measure === "wait" ? "time to first byte" : "total duration"})`)
  );
  out.append(verdict);

  const tbl = el("table", "slo-tbl");
  const row = (k, v) => { const tr = el("tr"); tr.append(el("td", null, k), el("td", null, v)); tbl.append(tr); };
  row("Observed compliance in captured data", (empUnder * 100).toFixed(2) + "%");
  row("Mean simulated window compliance", (mean * 100).toFixed(2) + "%");
  row("5th–95th percentile of window compliance", (p5 * 100).toFixed(1) + "% – " + (p95c * 100).toFixed(1) + "%");
  row("Expected breaches per window", expectedBreaches.toFixed(1) + " of " + win);
  out.append(tbl);

  // compliance distribution mini-histogram
  const buckets = 40;
  const counts = new Array(buckets).fill(0);
  for (const c of compliances) counts[clamp(Math.floor(c * buckets), 0, buckets - 1)]++;
  const peak = Math.max(...counts);
  const bars = el("div", "compliance-bars");
  counts.forEach((c, i) => {
    const b = el("div", "hbar" + ((i + 0.5) / buckets < targetFrac ? " over" : ""));
    b.style.height = (c / peak * 100).toFixed(1) + "%";
    b.title = `${(i / buckets * 100).toFixed(0)}–${((i + 1) / buckets * 100).toFixed(0)}% compliant: ${c} trials`;
    bars.append(b);
  });
  out.append(el("h2", null, "Window compliance distribution"), bars,
    el("p", "dim", "Red bars are simulated windows that missed the objective. A long red tail with a healthy mean is the classic sign of bursty latency — exactly what percentile-only dashboards hide."));
}

// ---------- OTLP import ----------
function flattenOtlp(json) {
  const spans = [];
  for (const rs of json.resourceSpans || []) {
    for (const ss of rs.scopeSpans || rs.instrumentationLibrarySpans || []) {
      for (const sp of ss.spans || []) {
        const start = Number(sp.startTimeUnixNano) / 1e6;
        const end = Number(sp.endTimeUnixNano) / 1e6;
        if (!isFinite(start) || !isFinite(end)) continue;
        spans.push({
          traceId: (sp.traceId || "").toLowerCase(),
          spanId: (sp.spanId || "").toLowerCase(),
          parentSpanId: (sp.parentSpanId || "").toLowerCase(),
          name: sp.name || "(unnamed span)",
          start, end, dur: Math.max(0, end - start),
          status: sp.status && sp.status.code === 2 ? "error" : "ok",
        });
      }
    }
  }
  return spans;
}

function renderOtlp(spans) {
  const root = $("#otlp-waterfall");
  root.textContent = "";
  const byTrace = new Map();
  for (const s of spans) {
    if (!byTrace.has(s.traceId)) byTrace.set(s.traceId, []);
    byTrace.get(s.traceId).push(s);
  }
  for (const [traceId, list] of byTrace) {
    const wrap = el("div", "trace-group");
    const head = el("div", "trace-head");
    const t0 = Math.min(...list.map((s) => s.start));
    const t1 = Math.max(...list.map((s) => s.end));
    head.append(
      el("span", "trace-id", "trace " + (traceId ? traceId.slice(0, 16) + "…" : "(no id)")),
      el("span", "trace-meta", `${list.length} spans · ${fmtMs(t1 - t0)} end to end`)
    );
    wrap.append(head);

    // order: parents before children, depth for indentation
    const byId = new Map(list.map((s) => [s.spanId, s]));
    const depth = (s) => {
      let d = 0, cur = s;
      const seen = new Set();
      while (cur && cur.parentSpanId && byId.has(cur.parentSpanId) && !seen.has(cur.spanId)) {
        seen.add(cur.spanId);
        cur = byId.get(cur.parentSpanId);
        d++;
        if (d > 32) break;
      }
      return d;
    };
    const ordered = list.slice().sort((a, b) => a.start - b.start);
    const span = Math.max(1, t1 - t0);
    for (const s of ordered) {
      const row = el("div", "wf-row");
      const label = el("div", "wf-label" + (s.status === "error" ? " err" : ""));
      label.style.paddingLeft = depth(s) * 14 + "px";
      label.textContent = s.name;
      label.title = s.name + " · span " + s.spanId;
      const track = el("div", "wf-track");
      const bar = el("div", "wf-bar");
      bar.style.left = ((s.start - t0) / span * 100).toFixed(3) + "%";
      bar.style.width = clamp(s.dur / span * 100, 0.3, 100).toFixed(3) + "%";
      const seg = el("div", "wf-seg " + (s.status === "error" ? "wait" : "recv"));
      seg.style.width = "100%";
      bar.append(seg);
      track.append(bar);
      row.append(label, track, el("div", "wf-ms", fmtMs(s.dur)));
      wrap.append(row);
    }
    root.append(wrap);
  }
}

// ---------- Rendering / events ----------
let renderTimer = null;
function scheduleRender() {
  if (renderTimer) return;
  renderTimer = setTimeout(() => {
    renderTimer = null;
    const active = document.querySelector(".tab.active").dataset.tab;
    if (active === "waterfall") renderWaterfall();
    else if (active === "percentiles") renderPercentiles();
  }, 250);
}

for (const tab of document.querySelectorAll(".tab")) {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    tab.classList.add("active");
    $("#view-" + tab.dataset.tab).classList.add("active");
    if (tab.dataset.tab === "waterfall") renderWaterfall();
    if (tab.dataset.tab === "percentiles") renderPercentiles();
    if (tab.dataset.tab === "alerts") renderAlerts();
  });
}

$("#filter").addEventListener("input", (e) => { state.filter = e.target.value; scheduleRender(); });
$("#group-traces").addEventListener("change", (e) => { state.groupTraces = e.target.checked; renderWaterfall(); });
$("#pause-btn").addEventListener("click", () => {
  state.paused = !state.paused;
  $("#pause-btn").textContent = state.paused ? "Resume" : "Pause";
  const st = $("#capture-status");
  st.className = "status " + (state.paused ? "paused" : "live");
  st.textContent = state.paused ? "Capture paused" : "Capturing this tab's network traffic";
});
$("#clear-btn").addEventListener("click", () => {
  state.requests = []; state.selectedId = null;
  $("#detail").hidden = true;
  renderWaterfall(); renderPercentiles();
});
$("#clear-alerts").addEventListener("click", () => { state.alerts = []; renderAlerts(); });

$("#export-btn").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), requests: state.requests }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "agent-latency-capture.json";
  a.click();
  URL.revokeObjectURL(a.href);
});

$("#slo-form").addEventListener("submit", (e) => {
  e.preventDefault();
  state.settings.threshold = Number($("#slo-threshold").value) || 2000;
  state.settings.target = clamp(Number($("#slo-target").value) || 95, 1, 100);
  state.settings.window = Number($("#slo-window").value) || 100;
  state.settings.trials = Number($("#slo-trials").value) || 5000;
  state.settings.measure = $("#slo-measure").value;
  chrome.storage.local.set({ sloSettings: state.settings });
  runSimulation();
  renderPercentiles(); // threshold line moves
});

$("#otlp-render").addEventListener("click", () => {
  const status = $("#otlp-status");
  try {
    const json = JSON.parse($("#otlp-input").value);
    const spans = flattenOtlp(json);
    if (!spans.length) { status.textContent = "Parsed, but found no spans under resourceSpans."; return; }
    status.textContent = spans.length + " spans rendered.";
    renderOtlp(spans);
  } catch (err) {
    status.textContent = "Not valid JSON: " + err.message;
  }
});
$("#otlp-clear").addEventListener("click", () => {
  $("#otlp-input").value = "";
  $("#otlp-waterfall").textContent = "";
  $("#otlp-status").textContent = "";
});

// Restore persisted SLO settings
chrome.storage.local.get("sloSettings", (data) => {
  if (data && data.sloSettings) {
    Object.assign(state.settings, data.sloSettings);
    $("#slo-threshold").value = state.settings.threshold;
    $("#slo-target").value = state.settings.target;
    $("#slo-window").value = state.settings.window;
    $("#slo-trials").value = state.settings.trials;
    $("#slo-measure").value = state.settings.measure;
  }
});

renderWaterfall();
