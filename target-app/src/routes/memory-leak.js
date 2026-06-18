/**
 * memory-leak.js
 *
 * Route handler that triggers a memory leak by adding entries to an
 * unbounded in-memory cache. Each call allocates ~1 MB of memory that
 * is never freed, simulating a production memory leak.
 */

const express = require('express');
const { addToCache, getCacheSize } = require('../utils/cache-leak');

const router = express.Router();

router.get('/', (req, res) => {
  const key = `entry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const data = {
    payload: 'x'.repeat(1024),
    metadata: { source: 'memory-leak-endpoint', timestamp: new Date().toISOString() },
  };

  const cacheSize = addToCache(key, data);
  const memUsage = process.memoryUsage();

  res.json({
    route: '/api/memory-leak',
    cache_entries: cacheSize,
    memory: {
      rss_mb: (memUsage.rss / 1024 / 1024).toFixed(2),
      heap_used_mb: (memUsage.heapUsed / 1024 / 1024).toFixed(2),
      heap_total_mb: (memUsage.heapTotal / 1024 / 1024).toFixed(2),
    },
    warning: 'This endpoint leaks ~1 MB per call via an unbounded cache',
  });
});

module.exports = router;
