/**
 * cache-leak.js
 *
 * Implements an unbounded in-memory cache that never evicts entries.
 * Each call to addToCache allocates a 1 MB Buffer that is permanently
 * retained in the global `leakedData` array, causing a steady memory
 * leak that grows with every request.
 *
 * This simulates a common production memory leak pattern where objects
 * are accumulated in module-level data structures without cleanup.
 */

const leakedData = [];

function addToCache(key, data) {
  leakedData.push({
    key,
    data,
    payload: new Array(150000).fill(0).map(() => Math.random().toString(36)),
    timestamp: Date.now(),
  });
  return leakedData.length;
}

function getCacheSize() {
  return leakedData.length;
}

module.exports = { addToCache, getCacheSize };
