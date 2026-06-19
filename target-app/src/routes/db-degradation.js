const express = require('express');
const router = express.Router();

router.get('/', async (req, res) => {
  const duration = parseInt(req.query.duration) || 3000; // 3 seconds default DB delay
  const start = process.hrtime.bigint();
  
  // Simulate slow DB query
  await new Promise(resolve => setTimeout(resolve, duration));
  
  const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
  if (global.dbLatencyWindow) {
    global.dbLatencyWindow.push(elapsed);
    if (global.dbLatencyWindow.length > 1000) global.dbLatencyWindow.shift();
  }

  res.json({
    route: '/api/db-degradation',
    message: 'Simulated a slow database query.',
    db_time_ms: elapsed
  });
});

module.exports = router;
