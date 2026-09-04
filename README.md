# Agent Latency Lab

A Chrome DevTools panel for understanding how long an AI agent's requests actually take — and whether that meets the objective you've set for it.

Requests carrying a W3C `traceparent` header are grouped under their shared trace ID, so a single agent run reads as one unit instead of a flat list. Every request is split into connection setup, waiting for the first byte, and receiving — and for streaming model responses, that middle phase is the closest the network layer gets to time-to-first-token.

GPL-3.0 licensed. No dependencies, no build step, no telemetry.

## Install

**From source (current)**

```bash
git clone https://github.com/juubaker/agent-latency-lab-extension.git
```

Then in Chrome: `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select the cloned folder.

**Important:** DevTools panels register only when a DevTools window opens. If DevTools was already open, close it completely and reopen it. The panel is labeled **Agent Latency**, at the end of the tab strip after Recorder — often under the `»` overflow chevron.

## Panels

**Waterfall** — Phase-split bars grouped by trace. Click a row for the timing breakdown and parsed trace context: trace ID, span ID, sampling flags, `tracestate`.

**Percentiles** — p50/p90/p95/p99 for total duration and time to first byte, with a distribution histogram and your threshold marked on it.

**SLO simulator** — Bootstrap Monte Carlo over captured timings. Set a threshold and objective ("95% under 2s"), and it resamples observed measurements into windows of N requests to estimate how often a window actually meets the bar. No distribution assumed — the samples are the model. The window-compliance spread is where bursty behavior shows itself: a healthy mean with a long failing tail looks fine on a percentile dashboard and fails in production.

**Alerts** — Threshold breaches and 5xx responses, timestamped as they occur.

**OTLP import** — Paste an OpenTelemetry JSON export (`resourceSpans → scopeSpans → spans`) for a nested per-trace span waterfall with parent/child indentation. Useful for backend agent runs that never touched a browser.

The toolbar filter narrows every view at once. **Export** writes captured entries to JSON.

## How the simulation works

Given samples $x_1 \dots x_n$ of observed request durations, a threshold $T$, and a window size $W$, each trial draws $W$ samples with replacement and computes the fraction under $T$. Across many trials this yields the distribution of window compliance, and the reported figure is the share of trials meeting the objective.

This is a stationary bootstrap over whatever you captured. It inherits your sample's biases: capture during a quiet period and it will tell you things are fine. It does not model traffic growth, cold starts, or correlated failures — consecutive slow requests are common in real systems and independent resampling understates that clustering.

## Privacy

The extension makes no network requests, contains no analytics, and transmits nothing. It declares one permission, `storage`, used to persist your SLO settings locally. No host permissions, no access to history, cookies, or tabs. Request timings come from the standard DevTools API, only for the tab you have DevTools open on.

## Limits

- Chrome retains roughly the last 2,000 requests.
- Capture runs only while the panel is open (a DevTools API constraint).
- The simulator needs at least 10 captured requests.
- Timing phases come from Chrome's HAR entry; sub-millisecond values round.

## Layout

```
manifest.json      MV3 manifest
devtools.html/js   registers the panel
panel.html         panel markup
panel.css          styling
panel.js           capture, traceparent parsing, percentiles, Monte Carlo, OTLP
icons/             16/48/128 waterfall-motif icons
```

Vanilla JS throughout. To fold in React components later, CRXJS + Vite is the clean path — the capture and simulation logic in `panel.js` ports over unchanged.

## Contributing

Issues and pull requests welcome. There's no build step, so the loop is: edit, hit reload on the extension card at `chrome://extensions`, reopen DevTools.

## License

GPL-3.0 — see [LICENSE](LICENSE).
