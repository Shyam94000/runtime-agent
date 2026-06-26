/**
 * index.js — Target Application Server
 *
 * Express server that serves as the monitored application. Exposes
 * intentionally buggy endpoints for CPU spikes and memory leaks,
 * along with a /api/metrics endpoint that reports live process health
 * data for the monitoring agent to consume.
 */

const express = require('express');
const app = express();
const PORT = process.env.PORT || 3001;

// ── Route Imports ──────────────────────────────────────────────
const cpuHeavyRoute = require('./routes/cpu-heavy');
const memoryLeakRoute = require('./routes/memory-leak');
const healthyRoute = require('./routes/healthy');
const eventLoopBlockRoute = require('./routes/event-loop-block');
const unhandledRejectionRoute = require('./routes/unhandled-rejection');
const dbDegradationRoute = require('./routes/db-degradation');
const networkDelayRoute = require('./routes/network-delay');

// ── Event Loop Lag Monitoring ──────────────────────────────────
// Uses perf_hooks histogram for high-resolution event loop delay
// measurement. This is the #1 Node.js health signal.
const { monitorEventLoopDelay, PerformanceObserver, performance } = require('perf_hooks');
const eventLoopHistogram = monitorEventLoopDelay({ resolution: 20 });
eventLoopHistogram.enable();

// ── GC (Garbage Collection) Pressure Tracking ─────────────────
// Uses PerformanceObserver to capture every V8 GC event with
// pause duration. GC pauses freeze the entire process.
const gcStats = {
  count: 0,
  totalPauseMs: 0,
  maxPauseMs: 0,
  lastMajorPauseMs: 0,
  // Reset window — accumulate between metrics reads
  windowCount: 0,
  windowTotalMs: 0,
  windowMaxMs: 0,
  windowStart: Date.now(),
};

try {
  const gcObserver = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      gcStats.count++;
      gcStats.totalPauseMs += entry.duration;
      gcStats.maxPauseMs = Math.max(gcStats.maxPauseMs, entry.duration);
      gcStats.windowCount++;
      gcStats.windowTotalMs += entry.duration;
      gcStats.windowMaxMs = Math.max(gcStats.windowMaxMs, entry.duration);
      // kind 2 = Major GC (Mark-Sweep), kind 1 = Minor (Scavenge)
      if (entry.detail && entry.detail.kind === 2) {
        gcStats.lastMajorPauseMs = entry.duration;
      }
    }
  });
  gcObserver.observe({ entryTypes: ['gc'] });
} catch (e) {
  console.warn('GC monitoring not available:', e.message);
}

// ── Event Loop Utilization (ELU) ──────────────────────────────
// ELU measures what fraction of time the event loop is actually
// busy vs idle. Superior to lag for capacity planning.
let lastElu = performance.eventLoopUtilization();
let currentElu = 0;

setInterval(() => {
  const newElu = performance.eventLoopUtilization(lastElu);
  currentElu = newElu.utilization; // 0.0 to 1.0
  lastElu = performance.eventLoopUtilization();
}, 1000);

// ── Request Throughput Tracking ────────────────────────────────
// Counts completed requests per second in a rolling window.
let throughputCounter = 0;
let throughputRps = 0;

setInterval(() => {
  throughputRps = throughputCounter;
  throughputCounter = 0;
}, 1000);

// ── Uncaught Error / Rejection Tracking ────────────────────────
// Captures unhandled promise rejections and uncaught exceptions
// with full stack traces for diagnostic analysis.
const uncaughtErrors = [];

process.on('unhandledRejection', (reason, promise) => {
  const entry = {
    type: 'unhandledRejection',
    message: reason?.message || String(reason),
    stack: reason?.stack || null,
    timestamp: Date.now(),
  };
  uncaughtErrors.push(entry);
  if (uncaughtErrors.length > 50) uncaughtErrors.shift();
  console.error(`⚠️  Unhandled Rejection: ${entry.message}`);
});

process.on('uncaughtException', (err) => {
  const entry = {
    type: 'uncaughtException',
    message: err.message,
    stack: err.stack || null,
    timestamp: Date.now(),
  };
  uncaughtErrors.push(entry);
  if (uncaughtErrors.length > 50) uncaughtErrors.shift();
  console.error(`🔴 Uncaught Exception: ${entry.message}`);
  // NOTE: Not calling process.exit() since this is a demo app.
  // In production, you should exit after uncaughtException.
});

// ── Response Latency Tracking ──────────────────────────────────
// Tracks completed request latencies in a rolling window for
// percentile computation (P50/P95/P99).
const latencyWindow = [];
const MAX_LATENCY_SAMPLES = 1000;

global.dbLatencyWindow = [];
global.networkLatencyWindow = [];

// Simulate constant background healthy traffic for DB and Network
// This ensures that latencies decay back to normal even when there is no incoming traffic
setInterval(() => {
  for (let i = 0; i < 5; i++) {
    global.dbLatencyWindow.push(Math.random() * 5 + 2);
    if (global.dbLatencyWindow.length > MAX_LATENCY_SAMPLES) global.dbLatencyWindow.shift();
    
    global.networkLatencyWindow.push(Math.random() * 10 + 5);
    if (global.networkLatencyWindow.length > MAX_LATENCY_SAMPLES) global.networkLatencyWindow.shift();
  }
}, 1000);

const requestLogs = [];
const MAX_REQUEST_LOGS = 100;

function computePercentile(sortedArr, pct) {
  if (sortedArr.length === 0) return 0;
  const idx = Math.ceil((pct / 100) * sortedArr.length) - 1;
  return parseFloat(sortedArr[Math.max(0, idx)].toFixed(3));
}



// Combined latency + error tracking middleware
// Must be registered BEFORE route handlers to capture all requests.
app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  const requestPath = (req.originalUrl || req.url).split('?')[0];

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;

    // Track latency for completed requests (exclude metrics, profile, and heap-snapshot endpoints)
    if (requestPath !== '/api/metrics' && requestPath !== '/api/profile' && requestPath !== '/api/heap-snapshot') {
      latencyWindow.push(durationMs);
      if (latencyWindow.length > MAX_LATENCY_SAMPLES) latencyWindow.shift();
      // Count towards throughput
      throughputCounter++;
    }

    if (requestPath !== '/api/metrics') {
      requestLogs.push({
        method: req.method,
        path: requestPath,
        statusCode: res.statusCode,
        timestamp: new Date().toISOString(),
        duration_ms: parseFloat(durationMs.toFixed(3)),
      });
      if (requestLogs.length > MAX_REQUEST_LOGS) requestLogs.shift();
    }


  });

  next();
});

// ── Active Request Tracking ────────────────────────────────────
// Tracks in-flight requests to report which code paths are active.
const activeRequests = new Map();
let requestCounter = 0;

app.use((req, res, next) => {
  const id = ++requestCounter;
  const entry = {
    id,
    method: req.method,
    path: req.path,
    startTime: Date.now(),
  };
  activeRequests.set(id, entry);

  res.on('finish', () => {
    activeRequests.delete(id);
  });

  next();
});

// ── CPU Usage Tracking ─────────────────────────────────────────
// Node's process.cpuUsage() returns cumulative microseconds.
// We sample periodically to compute a percentage.
let cpuPercent = 0;
let lastCpuUsage = process.cpuUsage();
let lastCpuTime = Date.now();

function updateCpuPercent() {
  const now = Date.now();
  const elapsed = (now - lastCpuTime) * 1000; // convert ms to µs
  if (elapsed <= 0) return;

  const currentUsage = process.cpuUsage();
  const userDiff = currentUsage.user - lastCpuUsage.user;
  const systemDiff = currentUsage.system - lastCpuUsage.system;
  const totalCpuUsed = userDiff + systemDiff;

  // CPU percent relative to a single core
  cpuPercent = Math.min(100, (totalCpuUsed / elapsed) * 100);

  lastCpuUsage = currentUsage;
  lastCpuTime = now;
}

// Update CPU measurement every 1 second
setInterval(updateCpuPercent, 1000);


// ── Routes ─────────────────────────────────────────────────────
app.use('/api/cpu-heavy', cpuHeavyRoute);
app.use('/api/memory-leak', memoryLeakRoute);
app.use('/api/healthy', healthyRoute);
app.use('/api/event-loop-block', eventLoopBlockRoute);
app.use('/api/unhandled-rejection', unhandledRejectionRoute);
app.use('/api/db-degradation', dbDegradationRoute);
app.use('/api/network-delay', networkDelayRoute);

// ── Simple UI ──────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Target App - Bug Simulator</title>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap" rel="stylesheet">
      <style>
        :root {
          --bg-color: #0b0f19;
          --card-bg: rgba(255, 255, 255, 0.05);
          --card-border: rgba(255, 255, 255, 0.1);
          --text-main: #f1f5f9;
          --text-muted: #94a3b8;
          --accent-blue: #3b82f6;
          --accent-purple: #8b5cf6;
          --accent-orange: #f59e0b;
          --accent-red: #ef4444;
        }
        body {
          font-family: 'Inter', sans-serif;
          background: var(--bg-color);
          background-image: radial-gradient(circle at top right, rgba(59, 130, 246, 0.15), transparent 40%),
                            radial-gradient(circle at bottom left, rgba(139, 92, 246, 0.15), transparent 40%);
          color: var(--text-main);
          margin: 0;
          padding: 3rem 1rem;
          min-height: 100vh;
          display: flex;
          justify-content: center;
        }
        .container {
          max-width: 900px;
          width: 100%;
        }
        h2 {
          font-size: 2.5rem;
          font-weight: 800;
          margin-bottom: 0.5rem;
          background: linear-gradient(to right, #60a5fa, #c084fc);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        p.subtitle {
          color: var(--text-muted);
          font-size: 1.1rem;
          margin-bottom: 3rem;
        }
        .grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          gap: 1.5rem;
          margin-bottom: 3rem;
        }
        .category-card {
          background: var(--card-bg);
          border: 1px solid var(--card-border);
          border-radius: 16px;
          padding: 1.5rem;
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
          transition: transform 0.3s ease, box-shadow 0.3s ease;
        }
        .category-card:hover {
          transform: translateY(-5px);
          box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
        }
        .category-title {
          font-size: 1.2rem;
          font-weight: 600;
          margin-bottom: 1.5rem;
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        .btn {
          display: block;
          width: 100%;
          padding: 0.75rem 1rem;
          border-radius: 8px;
          border: none;
          font-size: 0.95rem;
          font-weight: 600;
          font-family: 'Inter', sans-serif;
          cursor: pointer;
          margin-bottom: 0.75rem;
          color: white;
          transition: all 0.2s ease;
          position: relative;
          overflow: hidden;
        }
        .btn::after {
          content: '';
          position: absolute;
          top: 0; left: 0; right: 0; bottom: 0;
          background: linear-gradient(rgba(255,255,255,0.1), transparent);
          opacity: 0;
          transition: opacity 0.2s ease;
        }
        .btn:hover::after { opacity: 1; }
        .btn:active { transform: scale(0.98); }
        .btn:last-child { margin-bottom: 0; }
        
        .btn-blue { background: var(--accent-blue); box-shadow: 0 4px 14px 0 rgba(59, 130, 246, 0.39); }
        .btn-orange { background: var(--accent-orange); box-shadow: 0 4px 14px 0 rgba(245, 158, 11, 0.39); }
        .btn-purple { background: var(--accent-purple); box-shadow: 0 4px 14px 0 rgba(139, 92, 246, 0.39); }
        .btn-red { background: var(--accent-red); box-shadow: 0 4px 14px 0 rgba(239, 68, 68, 0.39); }

        .output-panel {
          background: #0f172a;
          border: 1px solid #1e293b;
          border-radius: 12px;
          padding: 1.5rem;
          box-shadow: inset 0 2px 4px 0 rgba(0, 0, 0, 0.06);
        }
        .output-panel h4 {
          margin: 0 0 1rem 0;
          color: var(--text-muted);
          font-size: 0.9rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        pre {
          margin: 0;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size: 0.85rem;
          color: #a5b4fc;
          white-space: pre-wrap;
          word-wrap: break-word;
        }
        .loader {
          display: inline-block;
          width: 1rem;
          height: 1rem;
          border: 2px solid rgba(255,255,255,0.3);
          border-radius: 50%;
          border-top-color: white;
          animation: spin 1s ease-in-out infinite;
          margin-right: 0.5rem;
          vertical-align: middle;
          display: none;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
      </style>
    </head>
    <body>
      <div class="container">
        <h2>Target App Diagnostics</h2>
        <p class="subtitle">Select a scenario below to inject intentional performance issues or errors into the Node.js runtime.</p>
        
        <div class="grid">
          <!-- Category 1 -->
          <div class="category-card">
            <div class="category-title" style="color: var(--accent-blue);">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>
              Resource Exhaustion
            </div>
            <button class="btn btn-blue" onclick="trigger('/api/cpu-heavy', this)">Simulate CPU Spike (O(2^n))</button>
            <button class="btn btn-orange" onclick="trigger('/api/memory-leak?amount=15', this)">Simulate Memory Leak (15MB)</button>
          </div>

          <!-- Category 2 -->
          <div class="category-card">
            <div class="category-title" style="color: var(--accent-purple);">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
              Latency & Blocking
            </div>
            <button class="btn btn-red" onclick="trigger('/api/event-loop-block?duration=500', this)">Block Event Loop (500ms)</button>
            <button class="btn btn-purple" onclick="trigger('/api/db-degradation?duration=3000', this)">Simulate DB Degradation (3s)</button>
            <button class="btn btn-purple" onclick="trigger('/api/network-delay?duration=4000', this)">Simulate Slow API Response (4s)</button>
          </div>

          <!-- Category 3 -->
          <div class="category-card">
            <div class="category-title" style="color: var(--accent-red);">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
              Errors & Crashes
            </div>
            <button class="btn btn-red" onclick="trigger('/api/unhandled-rejection', this)">Trigger Unhandled Rejection</button>
          </div>
        </div>
        
        <div class="output-panel">
          <h4>Execution Output</h4>
          <pre id="output"><span style="color: #64748b;">Ready. Waiting for scenario execution...</span></pre>
        </div>
      </div>

      <script>
        async function trigger(endpoint, btn) {
          const out = document.getElementById('output');
          const originalText = btn.innerText;
          
          btn.innerHTML = '<span class="loader" style="display:inline-block;"></span> Running...';
          btn.style.opacity = '0.8';
          btn.style.pointerEvents = 'none';
          
          out.innerHTML = '<span style="color: #94a3b8;">Requesting ' + endpoint + '...</span>';
          
          try {
            const res = await fetch(endpoint);
            const json = await res.json();
            out.innerText = JSON.stringify(json, null, 2);
          } catch (e) {
            out.innerHTML = '<span style="color: #ef4444;">Error: ' + e.message + '</span>';
          } finally {
            btn.innerHTML = originalText;
            btn.style.opacity = '1';
            btn.style.pointerEvents = 'auto';
          }
        }
      </script>
    </body>
    </html>
  `);
});

// ── Health Check ───────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'up', uptime: process.uptime() });
});

// ── Metrics Endpoint ───────────────────────────────────────────
// This is the primary endpoint consumed by the monitoring agent.
// It reports CPU usage, memory consumption, active requests, and
// the call stacks of in-flight requests for profiling analysis.
app.get('/api/metrics', (req, res) => {
  res.json(generateMetricsPayload());
});

function generateMetricsPayload() {
  const mem = process.memoryUsage();
  const activeRequestList = Array.from(activeRequests.values())
    .filter((r) => r.path !== '/api/metrics') // exclude self
    .map((r) => ({
      method: r.method,
      path: r.path,
      duration_ms: Date.now() - r.startTime,
    }));

  // Compute latency percentiles from rolling window
  const sortedLatencies = [...latencyWindow].sort((a, b) => a - b);
  const avgLatency =
    latencyWindow.length > 0
      ? latencyWindow.reduce((sum, v) => sum + v, 0) / latencyWindow.length
      : 0;



  // DB and Network Latency averages
  const sortedDb = [...global.dbLatencyWindow].sort((a, b) => a - b);
  const sortedNet = [...global.networkLatencyWindow].sort((a, b) => a - b);

  // Compute GC stats for this window and reset
  const windowElapsed = Math.max(1, Date.now() - gcStats.windowStart);
  const gcTimePercent = parseFloat(((gcStats.windowTotalMs / windowElapsed) * 100).toFixed(2));

  const payload = {
    timestamp: new Date().toISOString(),
    cpu: {
      user: process.cpuUsage().user,
      system: process.cpuUsage().system,
      percentage: parseFloat(cpuPercent.toFixed(2)),
    },
    memory: {
      rss: mem.rss,
      heapTotal: mem.heapTotal,
      heapUsed: mem.heapUsed,
      external: mem.external,
      rss_mb: parseFloat((mem.rss / 1024 / 1024).toFixed(2)),
      heap_used_mb: parseFloat((mem.heapUsed / 1024 / 1024).toFixed(2)),
      heap_total_mb: parseFloat((mem.heapTotal / 1024 / 1024).toFixed(2)),
    },
    event_loop: {
      lag_mean_ms: parseFloat((eventLoopHistogram.mean / 1e6).toFixed(3)),
      lag_p50_ms: parseFloat((eventLoopHistogram.percentile(50) / 1e6).toFixed(3)),
      lag_p99_ms: parseFloat((eventLoopHistogram.percentile(99) / 1e6).toFixed(3)),
      lag_max_ms: parseFloat((eventLoopHistogram.max / 1e6).toFixed(3)),
      lag_min_ms: parseFloat((eventLoopHistogram.min / 1e6).toFixed(3)),
    },
    response_latency: {
      p50_ms: computePercentile(sortedLatencies, 50),
      p95_ms: computePercentile(sortedLatencies, 95),
      p99_ms: computePercentile(sortedLatencies, 99),
      avg_ms: parseFloat(avgLatency.toFixed(3)),
      sample_size: latencyWindow.length,
      db_p95_ms: computePercentile(sortedDb, 95),
      network_p95_ms: computePercentile(sortedNet, 95),
    },
    // ── New P0 Metrics ────────────────────────────────────────
    gc: {
      count: gcStats.windowCount,
      total_pause_ms: parseFloat(gcStats.windowTotalMs.toFixed(3)),
      max_pause_ms: parseFloat(gcStats.windowMaxMs.toFixed(3)),
      last_major_pause_ms: parseFloat(gcStats.lastMajorPauseMs.toFixed(3)),
      gc_time_percent: gcTimePercent,
    },
    elu: parseFloat(currentElu.toFixed(4)),
    throughput_rps: throughputRps,
    // ─────────────────────────────────────────────────────────
    uncaught_errors: uncaughtErrors.slice(-20),
    uptime: parseFloat(process.uptime().toFixed(2)),
    active_requests: activeRequestList.length,
    request_details: activeRequestList,
    call_stack: [],
    pid: process.pid,
    node_version: process.version,
    request_logs: requestLogs,
  };
  eventLoopHistogram.reset();
  latencyWindow.length = 0;
  // Reset GC window stats for next interval
  gcStats.windowCount = 0;
  gcStats.windowTotalMs = 0;
  gcStats.windowMaxMs = 0;
  gcStats.windowStart = Date.now();
  return payload;
}

// ── Built-in Profiling Endpoints ───────────────────────────────
const inspector = require('node:inspector');
const v8 = require('node:v8');

app.get('/api/heap-snapshot', (req, res) => {
  res.json({
    heap_stats: v8.getHeapStatistics(),
    heap_spaces: v8.getHeapSpaceStatistics()
  });
});

app.get('/api/profile', (req, res) => {
  try {
    const session = new inspector.Session();
    session.connect();
    
    session.post('Profiler.enable', () => {
      session.post('Profiler.start', () => {
        setTimeout(() => {
          session.post('Profiler.stop', (err, { profile }) => {
            session.post('Profiler.disable');
            session.disconnect();
            
            if (err) {
              return res.status(500).json({ error: "Profiling failed", detail: err.message });
            }
            
            const functions = profile.nodes
              .map(node => ({
                functionName: node.callFrame.functionName || '(anonymous)',
                url: node.callFrame.url,
                lineNumber: node.callFrame.lineNumber + 1,
                hitCount: node.hitCount
              }))
              .filter(n => n.hitCount > 0 && n.functionName !== '(root)' && n.functionName !== '(program)')
              .sort((a, b) => b.hitCount - a.hitCount)
              .slice(0, 10);
              
            res.json({
              duration_ms: 3000,
              hot_functions: functions
            });
          });
        }, 3000);
      });
    });
  } catch (err) {
    res.status(500).json({ error: "Profiling failed", detail: err.message });
  }
});

// ── Start Server ───────────────────────────────────────────────
const server = app.listen(PORT, () => {
  console.log(`\n🎯 Target Application running on http://localhost:${PORT}`);
  console.log(`\n   Endpoints:`);
  console.log(`   GET /api/healthy              — Normal baseline response`);
  console.log(`   GET /api/cpu-heavy            — Triggers CPU spike (fibonacci)`);
  console.log(`   GET /api/memory-leak          — Leaks ~1 MB per call`);
  console.log(`   GET /api/event-loop-block     — Blocks event loop (sync while loop)`);
  console.log(`   GET /api/unhandled-rejection  — Triggers unhandled Promise rejection`);
  console.log(`   GET /api/metrics              — Live process metrics`);
  console.log(`   GET /api/profile              — V8 CPU profiler (3s)`);
  console.log(`   GET /api/heap-snapshot        — V8 heap statistics`);
  console.log(`   GET /health                   — Health check`);
  console.log(`   WS  ws://localhost:${PORT}             — Real-time WebSocket metrics stream\n`);
});

// ── WebSocket Server ───────────────────────────────────────────
const { WebSocketServer } = require('ws');
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  console.log('🔗 WebSocket client connected to target-app');
  // Send immediate initial payload
  ws.send(JSON.stringify(generateMetricsPayload()));
  
  ws.on('close', () => console.log('❌ WebSocket client disconnected from target-app'));
});

// Broadcast metrics every 1 second
setInterval(() => {
  if (wss.clients.size === 0) return;
  const payload = JSON.stringify(generateMetricsPayload());
  for (const client of wss.clients) {
    if (client.readyState === 1 /* WebSocket.OPEN */) {
      client.send(payload);
    }
  }
}, 1000);
