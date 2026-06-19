'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import MetricChart from '@/components/MetricChart';
import LatencyChart from '@/components/LatencyChart';
import DiagnosticCard from '@/components/DiagnosticCard';
import {
  getMetrics,
  getCurrentMetrics,
  getAnomalies,
  getDiagnostics,
  getConfig,
  getLogs,
} from '@/lib/api';
import {
  Cpu,
  MemoryStick,
  ActivitySquare,
  Network,
  Database,
  AlertTriangle,
  Info,
  AlertCircle,
  FileX,
  Server,
  Activity,
  Zap,
  TerminalSquare,
  HardDrive
} from 'lucide-react';

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
    let ws;
    let reconnectTimeout;

    const connectWebSocket = () => {
      ws = new WebSocket(wsUrl);

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
              ...prev.filter((item) => item.id !== diagnostic.id && (item.anomaly_id ? item.anomaly_id !== diagnostic.anomaly_id : true)),
            ]);
            if (anomaly) {
              setAnomalies((prev) => [
                anomaly,
                ...prev.filter((item) => item.id !== anomaly.id),
              ]);
            }
            getLogs().then(setLogs).catch(() => {});
          } else if (msg.type === 'logs_updated') {
            setLogs(msg.data);
          }
        } catch (err) {
          console.error('Failed to parse WebSocket message:', err);
        }
      };

      ws.onerror = () => {
        setError('WebSocket connection error - backend unreachable');
      };

      ws.onclose = () => {
        console.log('❌ WebSocket disconnected. Reconnecting in 3s...');
        clearTimeout(reconnectTimeout);
        reconnectTimeout = setTimeout(connectWebSocket, 3000);
      };
    };

    connectWebSocket();

    return () => {
      clearTimeout(initialRefresh);
      clearTimeout(reconnectTimeout);
      if (ws) ws.close();
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
              <Cpu size={16} strokeWidth={2} />
              <span className="metric-card-label">CPU Usage</span>
            </div>
            <span className={`status-dot ${getCpuStatus()}`} />
          </div>
          <div className={`metric-card-value metric-value-cpu`}>
            {currentMetrics ? `${currentMetrics.cpu_percent.toFixed(1)}%` : '—'}
          </div>
          <div className="metric-card-footer">
            <span className="metric-card-threshold" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Activity size={12} strokeWidth={2} />
              Threshold: {thresholds.cpu_threshold}%
            </span>
          </div>
        </div>

        <div className={`metric-card ${getMemStatus() === 'critical' ? 'metric-card-alert' : ''}`}>
          <div className="metric-card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <MemoryStick size={16} strokeWidth={2} />
              <span className="metric-card-label">Memory</span>
            </div>
            <span className={`status-dot ${getMemStatus()}`} />
          </div>
          <div className="metric-card-value metric-value-memory">
            {currentMetrics ? formatBytes(currentMetrics.memory_mb) : '—'}
          </div>
          <div className="metric-card-footer">
            <span className="metric-card-threshold" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <HardDrive size={12} strokeWidth={2} />
              Heap: {currentMetrics ? formatBytes(currentMetrics.heap_used_mb) : '—'}
            </span>
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <ActivitySquare size={16} strokeWidth={2} />
              <span className="metric-card-label">Active Requests</span>
            </div>
            <Zap size={16} strokeWidth={2} />
          </div>
          <div className="metric-card-value metric-value-requests">
            {currentMetrics ? currentMetrics.active_requests : '—'}
          </div>
          <div className="metric-card-footer">
            <span className="metric-card-threshold" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Server size={12} strokeWidth={2} />
              Uptime: {currentMetrics ? `${Math.floor(currentMetrics.uptime / 60)}m` : '—'}
            </span>
          </div>
        </div>

        <div className={`metric-card ${getDbStatus() === 'critical' ? 'metric-card-alert' : ''}`}>
          <div className="metric-card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Database size={16} strokeWidth={2} />
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
              <span className="metric-card-label">API Response</span>
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
        <div style={{ display: 'flex', gap: '24px', marginTop: '24px', flexWrap: 'wrap' }}>
          <LatencyChart data={metricsHistory} dataKey="db_p95_ms" title="DB Latency (p95 ms)" lineType="solid" />
          <LatencyChart data={metricsHistory} dataKey="network_p95_ms" title="API Response (p95 ms)" lineType="dashed" />
        </div>
      </div>

      {/* Bottom Section: Anomalies + Latest Diagnostic */}
      <div className="grid-2 animate-slide-up animate-delay-2" style={{ marginTop: '24px' }}>
        {/* Recent Anomalies */}
        <div className="card">
          <div className="card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <AlertCircle size={20} strokeWidth={2} />
              <h2 className="card-title">Recent Anomalies</h2>
            </div>
            <span className="badge badge-info">{anomalies.length}</span>
          </div>
          <div className="anomaly-list">
            {anomalies.length === 0 ? (
              <div className="empty-state">
                <ActivitySquare size={40} strokeWidth={1.5} color="var(--color-text-secondary)" />
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
              <Zap size={20} strokeWidth={2} />
              <h2 className="card-title">Latest AI Diagnosis</h2>
            </div>
            <Link href="/diagnostics" className="card-link">
              View All →
            </Link>
          </div>
          {diagnostics.length === 0 ? (
            <div className="empty-state">
              <FileX size={40} strokeWidth={1.5} color="var(--color-text-secondary)" />
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
            <TerminalSquare size={20} strokeWidth={2} />
            <h2 className="card-title">LLM API Request Logs</h2>
          </div>
          <span className="badge badge-info">{logs.length} calls</span>
        </div>
        <div className="logs-table-wrapper" style={{ overflowX: 'auto', marginTop: '12px' }}>
          {logs.length === 0 ? (
            <div className="empty-state">
              <TerminalSquare size={40} strokeWidth={1.5} color="var(--color-text-secondary)" />
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
    case 'db_latency': return 'DB Degradation';
    case 'network_latency': return 'Slow API Response';
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
      return <Cpu size={18} strokeWidth={2} />;
    case 'event_loop':
      return <ActivitySquare size={18} strokeWidth={2} />;
    case 'error_rate':
    case 'runtime_error':
      return <AlertTriangle size={18} strokeWidth={2} />;
    case 'latency':
    case 'network_latency':
      return <Network size={18} strokeWidth={2} />;
    case 'db_latency':
      return <Database size={18} strokeWidth={2} />;
    case 'memory':
    default:
      return <MemoryStick size={18} strokeWidth={2} />;
  }
}
