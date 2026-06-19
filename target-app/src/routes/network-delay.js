const express = require('express');
const router = express.Router();

router.get('/', async (req, res) => {
  const duration = parseInt(req.query.duration) || 4000; // 4 seconds default Network delay
  const start = process.hrtime.bigint();
  
  // Simulate slow External API call
  await new Promise(resolve => setTimeout(resolve, duration));
  
  const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
  if (global.networkLatencyWindow) {
    global.networkLatencyWindow.push(elapsed);
    if (global.networkLatencyWindow.length > 1000) global.networkLatencyWindow.shift();
  }

  res.json({
    route: '/api/network-delay',
    message: 'Simulated a slow external network response.',
    network_time_ms: elapsed
  });
});

module.exports = router;
