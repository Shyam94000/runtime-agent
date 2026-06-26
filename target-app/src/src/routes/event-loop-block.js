/**
 * event-loop-block.js
 *
 * Route handler that blocks the event loop using a synchronous while
 * loop for a configurable duration. This simulates a CPU-bound
 * synchronous operation that starves the event loop.
 */

const express = require('express');

const router = express.Router();

router.get('/', (req, res) => {
  const duration = parseInt(req.query.duration) || 500;
  const start = Date.now();

  // Synchronously block the event loop
  while (Date.now() - start < duration) {
    // busy wait
  }

  const elapsed = Date.now() - start;
  res.json({
    blocked: true,
    duration_ms: elapsed,
    message: `Event loop was blocked for ${elapsed}ms`,
  });
});

module.exports = router;
