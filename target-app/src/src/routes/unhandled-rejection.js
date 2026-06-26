/**
 * unhandled-rejection.js
 *
 * Route handler that creates an unhandled Promise rejection to simulate
 * uncaught asynchronous errors. Used to test the uncaught error tracking
 * in the monitoring agent.
 */

const express = require('express');

const router = express.Router();

router.get('/', (req, res) => {
  // Create an unhandled rejection — intentionally not caught
  Promise.reject(new Error('Simulated unhandled rejection'));

  res.json({
    triggered: true,
    message: 'Unhandled rejection triggered',
  });
});

module.exports = router;
