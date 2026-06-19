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
const errorBurstRoute = require('./routes/error-burst');
const unhandledRejectionRoute = require('./routes/unhandled-rejection');
const dbDegradationRoute = require('./routes/db-degradation');
const networkDelayRoute = require('./routes/network-delay');

// ── Event Loop Lag Monitoring ──────────────────────────────────
// Uses perf_hooks histogram for high-resolution event loop delay
// measurement. This is the #1 Node.js health signal.
const { monitorEventLoopDelay } = require('perf_hooks');
const eventLoopHistogram = monitorEventLoopDelay({ resolution: 20 });
eventLoopHistogram.enable();

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

// ── Error Rate Tracking ────────────────────────────────────────
// Counts 5xx responses in a rolling 60-second window.
global.errorTracker = {
  total: 0,
  timestamps: [],   // rolling 60s window of error timestamps
  recentErrors: [],  // last 20 error details
};

// Combined latency + error tracking middleware
// Must be registered BEFORE route handlers to capture all requests.
app.use((req, res, next) => {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;

    // Track latency for completed requests (exclude metrics, profile, and heap-snapshot endpoints)
    if (req.path !== '/api/metrics' && req.path !== '/api/profile' && req.path !== '/api/heap-snapshot') {
      latencyWindow.push(durationMs);
      if (latencyWindow.length > MAX_LATENCY_SAMPLES) latencyWindow.shift();
    }

    if (req.path !== '/api/metrics') {
      requestLogs.push({
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        timestamp: new Date().toISOString(),
        duration_ms: parseFloat(durationMs.toFixed(3)),
      });
      if (requestLogs.length > MAX_REQUEST_LOGS) requestLogs.shift();
    }

    // Track 5xx errors
    if (res.statusCode >= 500) {
      const now = Date.now();
      global.errorTracker.total++;
      global.errorTracker.timestamps.push(now);
      global.errorTracker.recentErrors.push({
        statusCode: res.statusCode,
        path: req.path,
        method: req.method,
        timestamp: now,
      });
      // Trim to 60s window
      const cutoff = now - 60000;
      global.errorTracker.timestamps = global.errorTracker.timestamps.filter((t) => t > cutoff);
      // Keep only last 20 error details
      if (global.errorTracker.recentErrors.length > 20) {
        global.errorTracker.recentErrors = global.errorTracker.recentErrors.slice(-20);
      }
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
app.use('/api/error-burst', errorBurstRoute);
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
      <style>
        body { font-family: system-ui, sans-serif; background: #0d1117; color: #e6edf3; padding: 2rem; max-width: 600px; margin: auto; }
        button { background: #58a6ff; color: white; border: none; padding: 10px 16px; border-radius: 6px; cursor: pointer; font-size: 1rem; margin-right: 10px; margin-bottom: 10px; }
        button:hover { background: #3182ce; }
        .memory-btn { background: #d29922; }
        .memory-btn:hover { background: #b7791f; }
        .danger-btn { background: #e53e3e; }
        .danger-btn:hover { background: #c53030; }
        .error-btn { background: #f56565; }
        .error-btn:hover { background: #e53e3e; }
        .rejection-btn { background: #9f7aea; }
        .rejection-btn:hover { background: #805ad5; }
        pre { background: #161b22; padding: 1rem; border-radius: 6px; border: 1px solid #30363d; overflow-x: auto; font-size: 0.85rem; }
        h3 { color: #8b949e; margin-top: 1.5rem; margin-bottom: 0.5rem; font-size: 0.9rem; text-transform: uppercase; letter-spacing: 0.05em; }
      </style>
    </head>
    <body>
      <h2>Bug Simulator</h2>
      <p>Click the buttons below to trigger intentional performance issues.</p>
      
      <h3>Original Simulations</h3>
      <button onclick="trigger('/api/cpu-heavy')">Simulate CPU Spike (O(2^n))</button>
      <button class="memory-btn" onclick="trigger('/api/memory-leak?amount=15')">Simulate Memory Leak (15MB)</button>
      
      <h3>New Metric Simulations</h3>
      <button class="danger-btn" onclick="trigger('/api/event-loop-block?duration=500')">Block Event Loop (500ms)</button>
      <button class="error-btn" onclick="trigger('/api/error-burst?count=35')">Trigger Error Burst (35 Errors)</button>
      <button class="rejection-btn" onclick="trigger('/api/unhandled-rejection')">Trigger Unhandled Rejection</button>
      <button class="memory-btn" onclick="trigger('/api/db-degradation?duration=3000')">Simulate DB Degradation (3s)</button>
      <button class="danger-btn" onclick="trigger('/api/network-delay?duration=4000')">Simulate Network Delay (4s)</button>
      
      <div style="margin-top: 1.5rem;">
        <h4>Last Response:</h4>
        <pre id="output">No action taken yet.</pre>
      </div>

      <script>
        async function trigger(endpoint) {
          const out = document.getElementById('output');
          out.innerText = 'Requesting ' + endpoint + '...';
          try {
            const res = await fetch(endpoint);
            const json = await res.json();
            out.innerText = JSON.stringify(json, null, 2);
          } catch (e) {
            out.innerText = 'Error: ' + e.message;
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

  // Compute current error rate (errors in last 60s / 60)
  const now = Date.now();
  const cutoff = now - 60000;
  const recentErrorTimestamps = global.errorTracker.timestamps.filter((t) => t > cutoff);
  const errorRatePerSecond = recentErrorTimestamps.length / 60;

  // DB and Network Latency averages
  const sortedDb = [...global.dbLatencyWindow].sort((a, b) => a - b);
  const sortedNet = [...global.networkLatencyWindow].sort((a, b) => a - b);

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
    error_rate: {
      total_5xx: global.errorTracker.total,
      rate_per_second: parseFloat(errorRatePerSecond.toFixed(3)),
      recent_errors: global.errorTracker.recentErrors.slice(-20),
    },
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
  console.log(`   GET /api/error-burst          — Returns 500 error responses`);
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
