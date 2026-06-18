/**
 * API client for the AI Runtime Monitoring Agent frontend.
 *
 * Communicates with the FastAPI backend and provides typed helper
 * functions for every endpoint the dashboard consumes.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

/**
 * Internal fetch wrapper that standardises headers, base-URL
 * resolution, and error handling for every outbound request.
 *
 * @param {string}  endpoint  - Path relative to API_BASE (e.g. "/api/status").
 * @param {object}  options   - Standard fetch options (method, body, headers …).
 * @returns {Promise<any>}      Parsed JSON response body.
 * @throws {Error}              On network failures or non-2xx responses.
 */
async function fetchAPI(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;

  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  let response;
  try {
    response = await fetch(url, { ...options, headers });
  } catch (networkError) {
    // Backend is unreachable (not started, network issue, CORS, etc.)
    const error = new Error('Backend unavailable');
    error.status = 0;
    error.isNetworkError = true;
    throw error;
  }

  if (!response.ok) {
    let errorBody;
    try {
      errorBody = await response.json();
    } catch {
      errorBody = { detail: response.statusText };
    }
    const message =
      errorBody?.detail ||
      errorBody?.message ||
      `Request failed with status ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.body = errorBody;
    throw error;
  }

  return response.json();
}

// ---------------------------------------------------------------------------
// System
// ---------------------------------------------------------------------------

/**
 * Fetch the overall system status.
 *
 * @returns {Promise<{
 *   monitoring_active: boolean,
 *   last_poll: string|null,
 *   anomaly_count: number,
 *   diagnostic_count: number,
 *   uptime: number
 * }>}
 */
export async function getSystemStatus() {
  return fetchAPI('/api/status');
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

/**
 * Fetch historical metric snapshots.
 *
 * @param {object}  params          - Optional query parameters.
 * @param {number}  [params.minutes=30] - Look-back window in minutes.
 * @returns {Promise<Array<{
 *   timestamp: string,
 *   cpu_percent: number,
 *   memory_mb: number,
 *   heap_used_mb: number,
 *   active_requests: number
 * }>>}
 */
export async function getMetrics(params = {}) {
  const query = new URLSearchParams();
  if (params.minutes !== undefined) {
    query.set('minutes', String(params.minutes));
  }
  const qs = query.toString();
  return fetchAPI(`/api/metrics${qs ? `?${qs}` : ''}`);
}

/**
 * Fetch the most recent metric snapshot.
 *
 * @returns {Promise<{
 *   timestamp: string,
 *   cpu_percent: number,
 *   memory_mb: number,
 *   heap_used_mb: number,
 *   active_requests: number
 * }>}
 */
export async function getCurrentMetrics() {
  return fetchAPI('/api/metrics/current');
}

// ---------------------------------------------------------------------------
// Anomalies
// ---------------------------------------------------------------------------

/**
 * Fetch all recorded anomalies.
 *
 * @returns {Promise<Array<{
 *   id: string,
 *   timestamp: string,
 *   type: string,
 *   current_value: number,
 *   threshold: number,
 *   severity: string,
 *   status: string
 * }>>}
 */
export async function getAnomalies() {
  return fetchAPI('/api/anomalies');
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

/**
 * Fetch all diagnostic reports (summary view).
 *
 * @returns {Promise<Array<object>>}
 */
export async function getDiagnostics() {
  return fetchAPI('/api/diagnostics');
}

/**
 * Fetch a single diagnostic report with full detail.
 *
 * @param {string} id - Diagnostic report identifier.
 * @returns {Promise<object>}
 */
export async function getDiagnostic(id) {
  return fetchAPI(`/api/diagnostics/${encodeURIComponent(id)}`);
}

/**
 * Clear all diagnostics and anomalies.
 *
 * @returns {Promise<object>}
 */
export async function clearDiagnostics() {
  return fetchAPI('/api/diagnostics', { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Retrieve the current monitoring configuration.
 *
 * @returns {Promise<{
 *   cpu_threshold: number,
 *   memory_growth_rate: number,
 *   poll_interval: number
 * }>}
 */
export async function getConfig() {
  return fetchAPI('/api/config');
}

/**
 * Update the monitoring configuration.
 *
 * @param {object} config - Partial or full configuration object.
 * @param {number} [config.cpu_threshold]
 * @param {number} [config.memory_growth_rate]
 * @param {number} [config.poll_interval]
 * @returns {Promise<object>} The updated configuration.
 */
export async function updateConfig(config) {
  return fetchAPI('/api/config', {
    method: 'PUT',
    body: JSON.stringify(config),
  });
}

// ---------------------------------------------------------------------------
// Diagnosis actions
// ---------------------------------------------------------------------------

/**
 * Trigger a diagnostic analysis for a specific anomaly.
 *
 * @param {string} anomalyId - The anomaly to diagnose.
 * @returns {Promise<object>} The resulting diagnostic report.
 */
export async function triggerDiagnosis(anomalyId) {
  return fetchAPI(`/api/diagnose/${encodeURIComponent(anomalyId)}`, {
    method: 'POST',
  });
}

// ---------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------

/**
 * Fetch the latest API request logs.
 *
 * @returns {Promise<Array<{
 *   method: string,
 *   path: string,
 *   statusCode: number,
 *   timestamp: string,
 *   duration_ms: number
 * }>>}
 */
export async function getLogs() {
  return fetchAPI('/api/logs');
}
