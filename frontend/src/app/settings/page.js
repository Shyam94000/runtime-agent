'use client';

import { useState, useEffect } from 'react';
import { getConfig, updateConfig, getSystemStatus } from '@/lib/api';

export default function SettingsPage() {
  const [config, setConfig] = useState({
    cpu_threshold: 70,
    memory_growth_rate: 10,
    poll_interval: 5,
    llm_kill_switch: false,
    db_latency_threshold_ms: 2000,
    network_latency_threshold_ms: 3000,
  });
  const [status, setStatus] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [configData, statusData] = await Promise.allSettled([
          getConfig(),
          getSystemStatus(),
        ]);
        if (configData.status === 'fulfilled') setConfig(configData.value);
        if (statusData.status === 'fulfilled') setStatus(statusData.value);
      } catch (err) {
        setError('Failed to load configuration');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await updateConfig(config);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError('Failed to save configuration');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setConfig({
      cpu_threshold: 70,
      memory_growth_rate: 10,
      poll_interval: 5,
      llm_kill_switch: false,
      db_latency_threshold_ms: 2000,
      network_latency_threshold_ms: 3000,
    });
  };

  if (loading) {
    return (
      <div className="container">
        <div className="page-header">
          <div>
            <h1 className="page-title">Settings</h1>
            <p className="page-subtitle">Configure monitoring thresholds and agent behavior</p>
          </div>
        </div>
        <div className="card" style={{ marginTop: '24px' }}>
          <div className="loading-shimmer" style={{ height: '200px', borderRadius: '12px' }} />
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">Configure monitoring thresholds and agent behavior</p>
        </div>
      </div>

      {/* Save Confirmation Toast */}
      {saved && (
        <div className="alert-banner alert-success animate-slide-down">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          <span>Configuration saved successfully</span>
        </div>
      )}

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

      <div className="settings-grid" style={{ marginTop: '24px' }}>
        {/* Anomaly Detection Thresholds */}
        <div className="card animate-slide-up">
          <div className="card-header">
            <h2 className="card-title">Anomaly Detection Thresholds</h2>
          </div>
          <div className="threshold-form">
            {/* CPU Threshold */}
            <div className="form-group">
              <label className="form-label" htmlFor="cpu-threshold">
                CPU Usage Threshold
              </label>
              <p className="form-hint">
                Alert when CPU usage exceeds this percentage for 3+ consecutive readings
              </p>
              <div className="form-slider-group">
                <input
                  type="range"
                  id="cpu-threshold"
                  className="form-slider"
                  min="10"
                  max="100"
                  step="5"
                  value={config.cpu_threshold}
                  onChange={(e) => setConfig({ ...config, cpu_threshold: Number(e.target.value) })}
                />
                <div className="form-input-wrapper">
                  <input
                    type="number"
                    className="form-input form-input-sm"
                    value={config.cpu_threshold}
                    onChange={(e) => setConfig({ ...config, cpu_threshold: Number(e.target.value) })}
                    min="10"
                    max="100"
                  />
                  <span className="form-input-suffix">%</span>
                </div>
              </div>
              <div className="threshold-preview">
                <span className={`status-dot ${config.cpu_threshold <= 50 ? 'warning' : 'healthy'}`} />
                <span>Trigger anomaly when CPU &gt; {config.cpu_threshold}% sustained</span>
              </div>
            </div>

            {/* Memory Growth Rate */}
            <div className="form-group">
              <label className="form-label" htmlFor="memory-threshold">
                Memory Growth Rate Threshold
              </label>
              <p className="form-hint">
                Alert when memory grows faster than this rate (MB/minute) over a 15-reading window
              </p>
              <div className="form-slider-group">
                <input
                  type="range"
                  id="memory-threshold"
                  className="form-slider"
                  min="1"
                  max="100"
                  step="1"
                  value={config.memory_growth_rate}
                  onChange={(e) => setConfig({ ...config, memory_growth_rate: Number(e.target.value) })}
                />
                <div className="form-input-wrapper">
                  <input
                    type="number"
                    className="form-input form-input-sm"
                    value={config.memory_growth_rate}
                    onChange={(e) => setConfig({ ...config, memory_growth_rate: Number(e.target.value) })}
                    min="1"
                    max="100"
                  />
                  <span className="form-input-suffix">MB/min</span>
                </div>
              </div>
              <div className="threshold-preview">
                <span className={`status-dot ${config.memory_growth_rate <= 5 ? 'warning' : 'healthy'}`} />
                <span>Trigger anomaly when memory growth &gt; {config.memory_growth_rate} MB/min</span>
              </div>
            </div>

            {/* DB Latency Threshold */}
            <div className="form-group">
              <label className="form-label" htmlFor="db-threshold">
                Database Latency Threshold (ms)
              </label>
              <p className="form-hint">
                Alert when DB queries take longer than this threshold for 3 consecutive polls
              </p>
              <div className="form-slider-group">
                <input
                  type="range"
                  id="db-threshold"
                  className="form-slider"
                  min="50"
                  max="5000"
                  step="50"
                  value={config.db_latency_threshold_ms}
                  onChange={(e) => setConfig({ ...config, db_latency_threshold_ms: Number(e.target.value) })}
                />
                <div className="form-input-wrapper">
                  <input
                    type="number"
                    className="form-input form-input-sm"
                    value={config.db_latency_threshold_ms}
                    onChange={(e) => setConfig({ ...config, db_latency_threshold_ms: Number(e.target.value) })}
                    min="50"
                    max="5000"
                  />
                  <span className="form-input-suffix">ms</span>
                </div>
              </div>
            </div>

            {/* Network Latency Threshold */}
            <div className="form-group">
              <label className="form-label" htmlFor="net-threshold">
                Slow API Response Threshold (ms)
              </label>
              <p className="form-hint">
                Alert when downstream API calls take longer than this threshold
              </p>
              <div className="form-slider-group">
                <input
                  type="range"
                  id="net-threshold"
                  className="form-slider"
                  min="50"
                  max="5000"
                  step="50"
                  value={config.network_latency_threshold_ms}
                  onChange={(e) => setConfig({ ...config, network_latency_threshold_ms: Number(e.target.value) })}
                />
                <div className="form-input-wrapper">
                  <input
                    type="number"
                    className="form-input form-input-sm"
                    value={config.network_latency_threshold_ms}
                    onChange={(e) => setConfig({ ...config, network_latency_threshold_ms: Number(e.target.value) })}
                    min="50"
                    max="5000"
                  />
                  <span className="form-input-suffix">ms</span>
                </div>
              </div>
            </div>

            {/* Polling Interval */}
            <div className="form-group">
              <label className="form-label" htmlFor="poll-interval">
                Monitoring Poll Interval
              </label>
              <p className="form-hint">
                How frequently the agent polls the target application for metrics
              </p>
              <div className="form-slider-group">
                <input
                  type="range"
                  id="poll-interval"
                  className="form-slider"
                  min="1"
                  max="30"
                  step="1"
                  value={config.poll_interval}
                  onChange={(e) => setConfig({ ...config, poll_interval: Number(e.target.value) })}
                />
                <div className="form-input-wrapper">
                  <input
                    type="number"
                    className="form-input form-input-sm"
                    value={config.poll_interval}
                    onChange={(e) => setConfig({ ...config, poll_interval: Number(e.target.value) })}
                    min="1"
                    max="30"
                  />
                  <span className="form-input-suffix">sec</span>
                </div>
              </div>
            </div>

            {/* LLM Kill Switch */}
            <div className="form-group" style={{ borderTop: '1px solid var(--border-muted)', paddingTop: '20px', marginTop: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <label className="form-label" htmlFor="llm-kill-switch" style={{ marginBottom: '4px' }}>
                    LLM Kill Switch
                  </label>
                  <p className="form-hint" style={{ margin: 0, maxWidth: '85%' }}>
                    If enabled, blocks all outgoing LLM API requests. Anomaly diagnosis and chat will be deactivated.
                  </p>
                </div>
                <div className="switch-wrapper">
                  <input
                    type="checkbox"
                    id="llm-kill-switch"
                    className="switch-input"
                    checked={config.llm_kill_switch || false}
                    onChange={(e) => setConfig({ ...config, llm_kill_switch: e.target.checked })}
                  />
                  <label htmlFor="llm-kill-switch" className="switch-slider" />
                </div>
              </div>
              <div className="threshold-preview" style={{ marginTop: '12px' }}>
                <span className={`status-dot ${config.llm_kill_switch ? 'warning' : 'healthy'}`} />
                <span>
                  {config.llm_kill_switch
                    ? 'Safe Mode Active: LLM requests are blocked'
                    : 'Normal Mode Active: LLM requests are enabled'}
                </span>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="form-actions">
              <button className="btn btn-secondary" onClick={handleReset} type="button">
                Reset to Defaults
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSave}
                disabled={saving}
                type="button"
              >
                {saving ? (
                  <>
                    <span className="spinner" /> Saving...
                  </>
                ) : (
                  'Save Configuration'
                )}
              </button>
            </div>
          </div>
        </div>

        {/* System Status */}
        <div className="card animate-slide-up animate-delay-1">
          <div className="card-header">
            <h2 className="card-title">Agent Status</h2>
            <span className={`badge badge-${status?.monitoring_active ? 'success' : 'warning'}`}>
              {status?.monitoring_active ? 'Active' : 'Inactive'}
            </span>
          </div>
          <div className="status-details">
            <StatusRow
              label="Monitoring Status"
              value={status?.monitoring_active ? 'Running' : 'Stopped'}
              valueClass={status?.monitoring_active ? 'status-active' : 'status-inactive'}
            />
            <StatusRow
              label="Last Poll"
              value={status?.last_poll ? new Date(status.last_poll).toLocaleTimeString() : '—'}
            />
            <StatusRow
              label="Total Anomalies Detected"
              value={status?.anomaly_count ?? '—'}
            />
            <StatusRow
              label="Total Diagnostics Generated"
              value={status?.diagnostic_count ?? '—'}
            />
            <StatusRow
              label="Agent Uptime"
              value={status?.uptime ? formatUptime(status.uptime) : '—'}
            />
            <StatusRow
              label="Target Application"
              value={status?.target_url || 'https://target.92.5.100.65.nip.io'}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusRow({ label, value, valueClass = '' }) {
  return (
    <div className="status-row">
      <span className="status-row-label">{label}</span>
      <span className={`status-row-value ${valueClass}`}>{value}</span>
    </div>
  );
}

function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
