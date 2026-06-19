'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import MetricChart from '@/components/MetricChart';
import DiagnosticCard from '@/components/DiagnosticCard';
import {
  getMetrics,
  getCurrentMetrics,
  getAnomalies,
  getDiagnostics,
  getConfig,
  getLogs,
} from '@/lib/api';

export default function DashboardPage() {
  const [metricsHistory, setMetricsHistory] = useState([]);
  const [currentMetrics, setCurrentMetrics] = useState(null);
  const [anomalies, setAnomalies] = useState([]);
  const [diagnostics, setDiagnostics] = useState([]);
  const [thresholds, setThresholds] = useState({ cpu_threshold: 70, memory_growth_rate: 10 });
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchData = useCallback(async () => {
    try {
      const [metricsData, anomalyData, diagData, configData, logsData] =
        await Promise.allSettled([
          getMetrics({ minutes: 30 }),
          getAnomalies(),
          getDiagnostics(),
          getConfig(),
          getLogs(),
        ]);

      if (metricsData.status === 'fulfilled') {
        setMetricsHistory(metricsData.value);
        if (metricsData.value.length > 0) {
          setCurrentMetrics(metricsData.value[metricsData.value.length - 1]);
        }
      }
      if (anomalyData.status === 'fulfilled') setAnomalies(anomalyData.value);
      if (diagData.status === 'fulfilled') setDiagnostics(diagData.value);
      if (configData.status === 'fulfilled') setThresholds(configData.value);
      if (logsData.status === 'fulfilled') setLogs(logsData.value);
      setError(null);
    } catch (err) {
      setError('Unable to connect to monitoring backend');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initialRefresh = setTimeout(fetchData, 0);

    // Establish WebSocket connection to backend
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8000/api/ws';
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('🔗 Connected to backend WebSocket stream');
      setError(null);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'metrics_update') {
          const point = msg.data;
          setCurrentMetrics(point);
          setMetricsHistory((prev) => {
            const next = [...prev, point];
            if (next.length > 200) next.shift(); // keep last 200 points locally
            return next;
          });
        } else if (msg.type === 'anomaly_detected') {
          const anomaly = msg.data;
          setAnomalies((prev) => [
            anomaly,
            ...prev.filter((item) => item.id !== anomaly.id),
          ]);
        } else if (msg.type === 'diagnostic_completed') {
          const diagnostic = msg.data;
          const anomaly = msg.anomaly;
          setDiagnostics((prev) => [
            diagnostic,
            ...prev.filter((item) => item.id !== diagnostic.id && item.anomaly_id !== diagnostic.anomaly_id),
          ]);
          if (anomaly) {
            setAnomalies((prev) => [
              anomaly,
              ...prev.filter((item) => item.id !== anomaly.id),
            ]);
          }
          getLogs().then(setLogs).catch(() => {});
        }
      } catch (err) {
        console.error('Failed to parse WebSocket message:', err);
      }
    };

    ws.onerror = () => {
      setError('WebSocket connection error - backend unreachable');
    };

    ws.onclose = () => {
      console.log('❌ WebSocket disconnected');
    };

    return () => {
      clearTimeout(initialRefresh);
      ws.close();
    };
  }, [fetchData]);

  const getCpuStatus = () => {
    if (!currentMetrics) return 'normal';
    if (currentMetrics.cpu_percent > thresholds.cpu_threshold) return 'critical';
    if (currentMetrics.cpu_percent > thresholds.cpu_threshold * 0.8) return 'warning';
    return 'normal';
  };

  const getDbStatus = () => {
    if (!currentMetrics) return 'normal';
    if (currentMetrics.db_p95_ms > (thresholds.db_latency_threshold_ms || 2000)) return 'critical';
    if (currentMetrics.db_p95_ms > (thresholds.db_latency_threshold_ms || 2000) * 0.8) return 'warning';
    return 'normal';
  };

  const getNetStatus = () => {
    if (!currentMetrics) return 'normal';
    if (currentMetrics.network_p95_ms > (thresholds.network_latency_threshold_ms || 3000)) return 'critical';
    if (currentMetrics.network_p95_ms > (thresholds.network_latency_threshold_ms || 3000) * 0.8) return 'warning';
    return 'normal';
  };

  const getMemStatus = () => {
    if (!currentMetrics) return 'normal';
    if (currentMetrics.memory_mb > 500) return 'critical';
    if (currentMetrics.memory_mb > 300) return 'warning';
    return 'normal';
  };

  const formatBytes = (mb) => {
    if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
    return `${mb.toFixed(0)} MB`;
  };

  if (loading) {
    return (
      <div className="container">
        <div className="page-header">
          <div>
            <h1 className="page-title">Performance Dashboard</h1>
            <p className="page-subtitle">Real-time application monitoring & AI diagnostics</p>
          </div>
        </div>
        <div className="grid-3" style={{ marginTop: '24px' }}>
          {[1, 2, 3].map((i) => (
            <div key={i} className="metric-card">
              <div className="loading-shimmer" style={{ height: '24px', width: '60%', marginBottom: '12px', borderRadius: '6px' }} />
              <div className="loading-shimmer" style={{ height: '48px', width: '40%', borderRadius: '6px' }} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      {error && (
        <div className="alert-banner alert-warning animate-slide-down">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>{error}</span>
        </div>
      )}

      <div className="page-header">
        <div>
          <h1 className="page-title">Performance Dashboard</h1>
          <p className="page-subtitle">Real-time application monitoring & AI diagnostics</p>
        </div>
        <div className="header-actions">
          <span className={`badge badge-${anomalies.length > 0 ? 'critical' : 'success'}`}>
            {anomalies.length > 0 ? `${anomalies.length} Active Anomalies` : 'All Systems Normal'}
          </span>
        </div>
      </div>

      {/* Metric Summary Cards */}
      <div className="grid-3 animate-fade-in" style={{ marginTop: '24px' }}>
        <div className={`metric-card ${getCpuStatus() === 'critical' ? 'metric-card-alert' : ''}`}>
          <div className="metric-card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/></svg>
              <span className="metric-card-label">CPU Usage</span>
            </div>
            <span className={`status-dot ${getCpuStatus()}`} />
          </div>
          <div className={`metric-card-value metric-value-cpu`}>
            {currentMetrics ? `${currentMetrics.cpu_percent.toFixed(1)}%` : '—'}
          </div>
          <div className="metric-card-footer">
            <span className="metric-card-threshold" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>
              Threshold: {thresholds.cpu_threshold}%
            </span>
          </div>
        </div>

        <div className={`metric-card ${getMemStatus() === 'critical' ? 'metric-card-alert' : ''}`}>
          <div className="metric-card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>
              <span className="metric-card-label">Memory</span>
            </div>
            <span className={`status-dot ${getMemStatus()}`} />
          </div>
          <div className="metric-card-value metric-value-memory">
            {currentMetrics ? formatBytes(currentMetrics.memory_mb) : '—'}
          </div>
          <div className="metric-card-footer">
            <span className="metric-card-threshold" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
              Heap: {currentMetrics ? formatBytes(currentMetrics.heap_used_mb) : '—'}
            </span>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              <span className="metric-card-label">Active Requests</span>
            </div>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
          </div>
          <div className="metric-card-value metric-value-requests">
            {currentMetrics ? currentMetrics.active_requests : '—'}
          </div>
          <div className="metric-card-footer">
            <span className="metric-card-threshold" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              Uptime: {currentMetrics ? `${Math.floor(currentMetrics.uptime / 60)}m` : '—'}
            </span>
          </div>
        </div>
      </div>

      <div className="grid-2 animate-fade-in" style={{ marginTop: '24px' }}>
        <div className={`metric-card ${getDbStatus() === 'critical' ? 'metric-card-alert' : ''}`}>
          <div className="metric-card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>
              <span className="metric-card-label">Database Latency</span>
            </div>
            <span className={`status-dot ${getDbStatus()}`} />
          </div>
          <div className="metric-card-value">
            {currentMetrics ? `${currentMetrics.db_p95_ms?.toFixed(1) || 0} ms` : '—'}
          </div>
          <div className="metric-card-footer">
            <span className="metric-card-threshold" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              Threshold: {thresholds.db_latency_threshold_ms || 2000} ms
            </span>
          </div>
        </div>

        <div className={`metric-card ${getNetStatus() === 'critical' ? 'metric-card-alert' : ''}`}>
          <div className="metric-card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>
              <span className="metric-card-label">Network API Latency</span>
            </div>
            <span className={`status-dot ${getNetStatus()}`} />
          </div>
          <div className="metric-card-value">
            {currentMetrics ? `${currentMetrics.network_p95_ms?.toFixed(1) || 0} ms` : '—'}
          </div>
          <div className="metric-card-footer">
            <span className="metric-card-threshold" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              Threshold: {thresholds.network_latency_threshold_ms || 3000} ms
            </span>
          </div>
        </div>
      </div>

      {/* Metric Chart */}
      <div className="animate-slide-up animate-delay-1" style={{ marginTop: '24px' }}>
        <MetricChart
          data={metricsHistory}
          thresholds={{ cpu: thresholds.cpu_threshold }}
        />
      </div>

      {/* Bottom Section: Anomalies + Latest Diagnostic */}
      <div className="grid-2 animate-slide-up animate-delay-2" style={{ marginTop: '24px' }}>
        {/* Recent Anomalies */}
        <div className="card">
          <div className="card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              <h2 className="card-title">Recent Anomalies</h2>
            </div>
            <span className="badge badge-info">{anomalies.length}</span>
          </div>
          <div className="anomaly-list">
            {anomalies.length === 0 ? (
              <div className="empty-state">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-secondary)" strokeWidth="1.5">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
                <p>No anomalies detected</p>
                <span>System is operating within normal parameters</span>
              </div>
            ) : (
              anomalies.slice(0, 5).map((anomaly) => (
                <Link
                  key={anomaly.id}
                  href={`/diagnostics/${anomaly.id}`}
                  className="anomaly-item"
                >
                  <div className={`anomaly-type-icon anomaly-type-${anomaly.type}`}>
                    {getAnomalyIcon(anomaly.type)}
                  </div>
                  <div className="anomaly-info">
                    <span className="anomaly-title">
                      {getAnomalyTitle(anomaly.type)} Detected
                    </span>
                    <span className="anomaly-detail">
                      {getAnomalyDetail(anomaly)}
                    </span>
                  </div>
                  <div className="anomaly-right">
                    <span className={`badge badge-${anomaly.severity}`}>{anomaly.severity}</span>
                    <span className="anomaly-time">
                      {formatTimestamp(anomaly.timestamp)}
                    </span>
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>

        {/* Latest Diagnostic */}
        <div className="card">
          <div className="card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="7.5 4.21 12 6.81 16.5 4.21"/><polyline points="7.5 19.79 7.5 14.6 3 12"/><polyline points="21 12 16.5 14.6 16.5 19.79"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
              <h2 className="card-title">Latest AI Diagnosis</h2>
            </div>
            <Link href="/diagnostics" className="card-link">
              View All →
            </Link>
          </div>
          {diagnostics.length === 0 ? (
            <div className="empty-state">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-secondary)" strokeWidth="1.5">
                <circle cx="12" cy="12" r="10" />
                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <p>No diagnostics yet</p>
              <span>AI analysis will appear when anomalies are detected</span>
            </div>
          ) : (
            <DiagnosticCard diagnostic={diagnostics[0]} href={`/diagnostics/${diagnostics[0].id}`} />
          )}
        </div>
      </div>

      {/* LLM API Request Logs Section */}
      <div className="card animate-slide-up animate-delay-3" style={{ marginTop: '24px' }}>
        <div className="card-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
            <h2 className="card-title">LLM API Request Logs</h2>
          </div>
          <span className="badge badge-info">{logs.length} calls</span>
        </div>
        <div className="logs-table-wrapper" style={{ overflowX: 'auto', marginTop: '12px' }}>
          {logs.length === 0 ? (
            <div className="empty-state">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-secondary)" strokeWidth="1.5">
                <rect x="2" y="3" width="20" height="18" rx="2" ry="2" />
                <line x1="6" y1="8" x2="18" y2="8" />
                <line x1="6" y1="12" x2="18" y2="12" />
                <line x1="6" y1="16" x2="12" y2="16" />
              </svg>
              <p>No LLM API logs available</p>
              <span>Logs will appear here when the AI agent initiates diagnosis</span>
            </div>
          ) : (
            <table className="logs-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Provider</th>
                  <th style={{ textAlign: 'center' }}>Attempt</th>
                  <th>Anomaly ID</th>
                  <th>Status</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {logs.slice().reverse().map((log, index) => {
                  const isSuccess = log.status === 'success';
                  const isFailed = log.status === 'failed';
                  const statusClass = isSuccess ? 'log-status-success' : isFailed ? 'log-status-error' : 'log-status-warning';
                  
                  let providerClass = 'log-method-badge';
                  if (log.provider === 'gemini') providerClass += ' log-method-get';
                  else if (log.provider === 'nvidia-nim') providerClass += ' log-method-post';
                  else providerClass += ' log-method-delete';

                  return (
                    <tr key={index}>
                      <td>{new Date(log.timestamp).toLocaleTimeString()}</td>
                      <td>
                        <span className={providerClass} style={{ textTransform: 'uppercase' }}>
                          {log.provider}
                        </span>
                      </td>
                      <td style={{ textAlign: 'center', fontWeight: 'bold' }}>{log.attempt}</td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{log.anomaly_id}</td>
                      <td>
                        <span className={statusClass}>{log.status.toUpperCase()}</span>
                      </td>
                      <td>
                        {log.error ? (
                          <span style={{ color: 'var(--error)', fontSize: '0.8rem' }}>{log.error}</span>
                        ) : log.duration_ms ? (
                          <span>{log.duration_ms.toFixed(0)} ms ({log.model})</span>
                        ) : (
                          <span>{log.model}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function formatTimestamp(ts) {
  try {
    const date = new Date(ts);
    const now = new Date();
    const diffMs = now - date;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHr = Math.floor(diffMin / 60);

    if (diffSec < 60) return `${diffSec}s ago`;
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return ts;
  }
}

function getAnomalyTitle(type) {
  switch (type) {
    case 'cpu': return 'CPU Spike';
    case 'memory': return 'Memory Growth';
    case 'event_loop': return 'Event Loop Block';
    case 'latency': return 'High Latency';
    case 'error_rate': return 'Error Burst';
    case 'db_latency': return 'DB Degradation';
    case 'network_latency': return 'Network Delay';
    case 'runtime_error': return 'Runtime Error';
    default: return 'Anomaly';
  }
}

function getAnomalyDetail(anomaly) {
  switch (anomaly.type) {
    case 'cpu':
      return `${anomaly.current_value.toFixed(1)}% (threshold: ${anomaly.threshold}%)`;
    case 'memory':
      return `${anomaly.current_value.toFixed(0)} MB growth rate`;
    case 'event_loop':
      return `${anomaly.current_value.toFixed(1)}ms lag (threshold: ${anomaly.threshold}ms)`;
    case 'latency':
      return `${anomaly.current_value.toFixed(1)}ms latency (threshold: ${anomaly.threshold}ms)`;
    case 'error_rate':
      return `${anomaly.current_value.toFixed(2)}/s error rate (threshold: ${anomaly.threshold}/s)`;
    case 'db_latency':
      return `${anomaly.current_value.toFixed(1)}ms DB query (threshold: ${anomaly.threshold}ms)`;
    case 'network_latency':
      return `${anomaly.current_value.toFixed(1)}ms Net API (threshold: ${anomaly.threshold}ms)`;
    case 'runtime_error':
      return anomaly.details || `${anomaly.current_value.toFixed(0)} runtime error(s)`;
    default:
      return `${anomaly.current_value.toFixed(1)} (threshold: ${anomaly.threshold})`;
  }
}

function getAnomalyIcon(type) {
  switch (type) {
    case 'cpu':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="4" y="4" width="16" height="16" rx="2" />
          <rect x="9" y="9" width="6" height="6" />
          <line x1="9" y1="1" x2="9" y2="4" />
          <line x1="15" y1="1" x2="15" y2="4" />
          <line x1="9" y1="20" x2="9" y2="23" />
          <line x1="15" y1="20" x2="15" y2="23" />
          <line x1="20" y1="9" x2="23" y2="9" />
          <line x1="20" y1="14" x2="23" y2="14" />
          <line x1="1" y1="9" x2="4" y2="9" />
          <line x1="1" y1="14" x2="4" y2="14" />
        </svg>
      );
    case 'event_loop':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      );
    case 'error_rate':
    case 'runtime_error':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      );
    case 'latency':
    case 'network_latency':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
      );
    case 'db_latency':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <ellipse cx="12" cy="5" rx="9" ry="3"/>
          <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
          <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
        </svg>
      );
    case 'memory':
    default:
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72" />
          <line x1="2" y1="2" x2="22" y2="22" />
        </svg>
      );
  }
}
