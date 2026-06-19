/**
 * error-burst.js
 *
 * Route handler that returns HTTP 500 responses to simulate server
 * errors. Used to trigger error rate tracking in the monitoring agent.
 */

const express = require('express');

const router = express.Router();

router.get('/', (req, res) => {
  const count = parseInt(req.query.count) || 1;
  
  if (global.errorTracker) {
    const now = Date.now();
    for (let i = 0; i < count; i++) {
      global.errorTracker.total++;
      global.errorTracker.timestamps.push(now);
      global.errorTracker.recentErrors.push({
        statusCode: 500,
        path: '/api/error-burst',
        method: 'GET',
        timestamp: now,
      });
    }
  }

  res.status(500).json({
    error: true,
    message: 'Simulated server error',
    statusCode: 500,
    burst: true,
    requested_count: count,
    warning: 'This endpoint returns 500 to trigger error rate metrics',
  });
});

module.exports = router;
