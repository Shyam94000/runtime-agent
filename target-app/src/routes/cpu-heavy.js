/**
 * cpu-heavy.js
 *
 * Route handler that triggers a CPU-intensive computation by calling
 * the naive recursive Fibonacci function with a large input value.
 * This causes a sustained CPU spike for the duration of the computation.
 */

const express = require('express');
const { fibonacci } = require('../utils/fibonacci');

const router = express.Router();

router.get('/', async (req, res) => {
  const n = parseInt(req.query.n) || 35; // a smaller N, ~100ms
  const duration = 20000; // run for 20 seconds to trigger anomaly
  const start = process.hrtime.bigint();
  const endTime = Date.now() + duration;

  let result;
  let iterations = 0;

  // Keep the CPU busy but yield occasionally so /api/metrics can respond
  while (Date.now() < endTime) {
    result = fibonacci(n);
    iterations++;
    // yield to event loop
    await new Promise(resolve => setImmediate(resolve));
  }

  const elapsed = Number(process.hrtime.bigint() - start) / 1e6; // ms
  res.json({
    route: '/api/cpu-heavy',
    input: n,
    result,
    iterations,
    computation_time_ms: elapsed.toFixed(2),
    warning: 'This endpoint artificially pegs the CPU for 8 seconds via repeated O(2^n) calls.',
  });
});

module.exports = router;
