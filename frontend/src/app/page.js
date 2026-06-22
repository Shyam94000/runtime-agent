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
  getDiagnostic,
  getConfig,
  getLogs,
  getFixes,
  deleteFix,
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
  HardDrive,
  GitPullRequest,
  Gauge,
  Timer
} from 'lucide-react';
import FixRequestCard, { FixRequestCardCompact } from '@/components/FixRequestCard';

export default function DashboardPage() {
  const [metricsHistory, setMetricsHistory] = useState([]);
  const [currentMetrics, setCurrentMetrics] = useState(null);
  const [anomalies, setAnomalies] = useState([]);
  const [diagnostics, setDiagnostics] = useState([]);
  const [thresholds, setThresholds] = useState({ cpu_threshold: 70, memory_growth_rate: 10 });
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [fixes, setFixes] = useState([]);
  const [selectedFix, setSelectedFix] = useState(null);
  const [selectedFixReport, setSelectedFixReport] = useState(null);

  const openFixModal = async (fix) => {
    setSelectedFix(fix);
    setSelectedFixReport(null);
    try {
      const data = await getDiagnostic(fix.id);
      setSelectedFixReport(data);
    } catch {
      setSelectedFixReport({ id: fix.id, root_cause_summary: fix.title, root_cause_file: fix.file });
    }
  };

  const closeFixModal = () => {
    setSelectedFix(null);
    setSelectedFixReport(null);
  };

  // Load fixes from API
  const loadFixes = useCallback(async () => {
    try {
      const data = await getFixes();
      setFixes(data || []);
    } catch {
      setFixes([]);
    }
  }, []);

  useEffect(() => {
    loadFixes();
  }, [loadFixes]);

  const handleDeleteFix = async (e, fixId) => {
    e.stopPropagation();
    if (confirm('Are you sure you want to remove this fix record?')) {
      try {
        await deleteFix(fixId);
        setFixes(fixes.filter(f => f.id !== fixId));
      } catch (err) {
        alert('Failed to delete fix: ' + err.message);
      }
    }
  };

  // Check for openFix query parameter to auto-open modal
  useEffect(() => {
    if (fixes.length === 0) return;
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const openFixId = params.get('openFix');
      if (openFixId) {
        const fix = fixes.find(f => f.id === openFixId);
        if (fix && !selectedFix) {
          setTimeout(() => {
            openFixModal(fix);
            // Remove query param without reloading page
            window.history.replaceState(null, '', '/');
          }, 0);
        }
      }
    }
  }, [fixes, selectedFix]);

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
    const initialRefresh = setTimeout(() => {
      fetchData();
      loadFixes();
    }, 0);

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

      {/* System & Resources */}
      <div className="section-header" style={{ marginTop: '24px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <Server size={18} strokeWidth={2} />
        <h2 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>System & Resources</h2>
      </div>
      <div className="grid-4 animate-fade-in">
        <div className={`metric-card ${getCpuStatus() === 'critical' ? 'metric-card-alert' : ''}`}>
          <div className="metric-card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Cpu size={16} strokeWidth={2} />
              <span className="metric-card-label">CPU Usage</span>
            </div>
            <span className={`status-dot ${getCpuStatus()}`} />
          </div>
          <div className={`metric-card-value metric-value-cpu`} style={{ fontSize: '2.5rem' }}>
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
          <div className="metric-card-value metric-value-memory" style={{ fontSize: '2.5rem' }}>
            {currentMetrics ? formatBytes(currentMetrics.memory_mb) : '—'}
          </div>
          <div className="metric-card-footer">
            <span className="metric-card-threshold" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <HardDrive size={12} strokeWidth={2} />
              Heap: {currentMetrics ? formatBytes(currentMetrics.heap_used_mb) : '—'}
            </span>
          </div>
        </div>

        <div className={`metric-card ${currentMetrics && currentMetrics.elu > 0.85 ? 'metric-card-alert' : ''}`}>
          <div className="metric-card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Gauge size={16} strokeWidth={2} />
              <span className="metric-card-label">Event Loop Util</span>
            </div>
            <span className={`status-dot ${currentMetrics && currentMetrics.elu > 0.85 ? 'critical' : currentMetrics && currentMetrics.elu > 0.7 ? 'warning' : 'normal'}`} />
          </div>
          <div className="metric-card-value" style={{ fontSize: '2.5rem' }}>
            {currentMetrics ? `${((currentMetrics.elu || 0) * 100).toFixed(1)}%` : '—'}
          </div>
          <div className="metric-card-footer">
            <span className="metric-card-threshold" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              Threshold: 85%
            </span>
          </div>
        </div>

        <div className={`metric-card ${currentMetrics && currentMetrics.gc_pause_max_ms > 100 ? 'metric-card-alert' : ''}`}>
          <div className="metric-card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Timer size={16} strokeWidth={2} />
              <span className="metric-card-label">GC Pressure</span>
            </div>
            <span className={`status-dot ${currentMetrics && currentMetrics.gc_pause_max_ms > 100 ? 'critical' : currentMetrics && currentMetrics.gc_pause_max_ms > 50 ? 'warning' : 'normal'}`} />
          </div>
          <div className="metric-card-value" style={{ fontSize: '2.5rem' }}>
            {currentMetrics ? `${(currentMetrics.gc_pause_max_ms || 0).toFixed(1)} ms` : '—'}
          </div>
          <div className="metric-card-footer">
            <span className="metric-card-threshold" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              GC time: {currentMetrics ? `${(currentMetrics.gc_time_percent || 0).toFixed(1)}%` : '—'}
            </span>
          </div>
        </div>
      </div>

      {/* Application Performance */}
      <div className="section-header" style={{ marginTop: '32px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <Activity size={18} strokeWidth={2} />
        <h2 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Application Performance</h2>
      </div>
      <div className="grid-4 animate-fade-in">
        <div className={`metric-card ${getNetStatus() === 'critical' ? 'metric-card-alert' : ''}`}>
          <div className="metric-card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>
              <span className="metric-card-label">API Response</span>
            </div>
            <span className={`status-dot ${getNetStatus()}`} />
          </div>
          <div className="metric-card-value" style={{ fontSize: '2.5rem' }}>
            {currentMetrics ? `${currentMetrics.network_p95_ms?.toFixed(1) || 0} ms` : '—'}
          </div>
          <div className="metric-card-footer">
            <span className="metric-card-threshold" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              Threshold: {thresholds.network_latency_threshold_ms || 3000} ms
            </span>
          </div>
        </div>

        <div className={`metric-card ${getDbStatus() === 'critical' ? 'metric-card-alert' : ''}`}>
          <div className="metric-card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Database size={16} strokeWidth={2} />
              <span className="metric-card-label">DB Latency</span>
            </div>
            <span className={`status-dot ${getDbStatus()}`} />
          </div>
          <div className="metric-card-value" style={{ fontSize: '2.5rem' }}>
            {currentMetrics ? `${currentMetrics.db_p95_ms?.toFixed(1) || 0} ms` : '—'}
          </div>
          <div className="metric-card-footer">
            <span className="metric-card-threshold" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              Threshold: {thresholds.db_latency_threshold_ms || 2000} ms
            </span>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Activity size={16} strokeWidth={2} />
              <span className="metric-card-label">Throughput</span>
            </div>
            <Zap size={16} strokeWidth={2} />
          </div>
          <div className="metric-card-value metric-value-requests" style={{ fontSize: '2.5rem' }}>
            {currentMetrics ? `${(currentMetrics.throughput_rps || 0).toFixed(1)}` : '—'}
          </div>
          <div className="metric-card-footer">
            <span className="metric-card-threshold" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              req/sec
            </span>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <GitPullRequest size={16} strokeWidth={2} />
              <span className="metric-card-label">AI Fixes</span>
            </div>
            <Zap size={16} strokeWidth={2} />
          </div>
          <div className="metric-card-value metric-value-requests" style={{ fontSize: '2.5rem' }}>
            {fixes.length}
          </div>
          <div className="metric-card-footer">
            <span className="metric-card-threshold" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              {fixes.filter(f => f.status === 'merged').length} merged · {fixes.filter(f => f.status === 'open').length} open
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
          {(() => {
            const visibleDiagnostics = diagnostics.filter((diag) => !fixes.some((f) => f.id === diag.id || f.id === diag.anomaly_id));
            if (visibleDiagnostics.length === 0) {
              return (
                <div className="empty-state">
                  <FileX size={40} strokeWidth={1.5} color="var(--color-text-secondary)" />
                  <p>No diagnostics yet</p>
                  <span>AI analysis will appear when anomalies are detected</span>
                </div>
              );
            }
            return <DiagnosticCard diagnostic={visibleDiagnostics[0]} href={`/diagnostics/${visibleDiagnostics[0].id}`} />;
          })()}
        </div>
      </div>

      {/* Fixes Tracker */}
      <div className="card animate-slide-up animate-delay-3" style={{ marginTop: '24px' }}>
        <div className="card-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <GitPullRequest size={20} strokeWidth={2} />
            <h2 className="card-title">Fix Requests</h2>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {fixes.length > 0 && (
              <>
                <span className="badge badge-info">
                  {fixes.filter(f => f.status === 'merged').length} merged
                </span>
                <span className="badge badge-info">
                  {fixes.filter(f => f.status === 'open').length} open
                </span>
              </>
            )}
          </div>
        </div>
        <div>
          {fixes.length === 0 ? (
            <div className="empty-state">
              <GitPullRequest size={40} strokeWidth={1.5} color="var(--color-text-secondary)" />
              <p>No fix requests yet</p>
              <span>Fix requests will appear here when you apply fixes from diagnostic reports</span>
            </div>
          ) : (
            fixes.slice(0, 10).map((fix, i) => (
              <div key={fix.id || i} onClick={() => openFixModal(fix)} style={{ cursor: 'pointer' }}>
                <FixRequestCardCompact fix={fix} onDelete={(e) => handleDeleteFix(e, fix.id)} />
              </div>
            ))
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

      {/* Fixes Modal */}
      {selectedFix && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.6)',
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px',
          backdropFilter: 'blur(4px)'
        }} onClick={closeFixModal}>
          <div style={{ width: '100%', maxWidth: '700px', maxHeight: '90vh', overflowY: 'auto', background: '#fff', borderRadius: '12px', boxShadow: '0 10px 40px rgba(0,0,0,0.3)' }} onClick={e => e.stopPropagation()}>
            {selectedFixReport ? (
              <FixRequestCard 
                report={selectedFixReport} 
                fix={selectedFix}
                onDismiss={closeFixModal}
              />
            ) : (
              <div style={{ padding: '60px', textAlign: 'center' }}>
                <div className="spinner" style={{ margin: '0 auto 16px', borderWidth: 3, borderTopColor: '#000', width: 32, height: 32 }} />
                <p style={{ color: '#666', fontWeight: 500 }}>Loading PR details...</p>
              </div>
            )}
          </div>
        </div>
      )}
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
    case 'gc_pressure': return 'GC Pressure';
    case 'elu_saturation': return 'ELU Saturation';
    case 'throughput_drop': return 'Throughput Drop';
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
    case 'gc_pressure':
      return `${anomaly.current_value.toFixed(1)}ms GC pause (threshold: ${anomaly.threshold}ms)`;
    case 'elu_saturation':
      return `${anomaly.current_value.toFixed(1)}% utilization (threshold: ${anomaly.threshold}%)`;
    case 'throughput_drop':
      return `${anomaly.current_value.toFixed(0)}% drop (threshold: ${anomaly.threshold}%)`;
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
    case 'gc_pressure':
      return <Timer size={18} strokeWidth={2} />;
    case 'elu_saturation':
      return <Gauge size={18} strokeWidth={2} />;
    case 'throughput_drop':
      return <Activity size={18} strokeWidth={2} />;
    case 'memory':
    default:
      return <MemoryStick size={18} strokeWidth={2} />;
  }
}
