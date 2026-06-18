/**
 * healthy.js
 *
 * Baseline route handler that returns a fast, constant-time response.
 * Used to contrast against the buggy endpoints for profiling comparison.
 */

const express = require('express');

const router = express.Router();

router.get('/', (req, res) => {
  res.json({
    route: '/api/healthy',
    status: 'ok',
    timestamp: new Date().toISOString(),
    message: 'This endpoint is performing within normal parameters',
  });
});

module.exports = router;
