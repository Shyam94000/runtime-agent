/**
 * fibonacci.js
 *
 * Computes Fibonacci numbers using a naive recursive algorithm.
 * Time complexity: O(2^n) — each call branches into two recursive calls
 * with no memoization, causing exponential CPU consumption.
 *
 * This is intentionally inefficient to simulate a CPU-bound performance
 * bottleneck in a production application.
 */

function fibonacci(n) {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

module.exports = { fibonacci };
