'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { getDiagnostic, getTrace, applyFix } from '@/lib/api';
import CodeDiff from '@/components/CodeDiff';
import FixRequestCard from '@/components/FixRequestCard';

const FIX_STEPS = [
  { key: 'analyze', label: 'Analyzing Code', icon: '1' },
  { key: 'generate', label: 'Generating Fix', icon: '2' },
  { key: 'create-pr', label: 'Creating PR', icon: '3' },
];



export default function DiagnosticDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [traceData, setTraceData] = useState(null);

  // Fix flow state
  const [fixState, setFixState] = useState('idle'); // idle | generating | pr-ready | dismissed
  const [fixStep, setFixStep] = useState(0);

  useEffect(() => {
    let intervalId = null;
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8000/api/ws';
    const ws = new WebSocket(wsUrl);

    const fetchReport = async () => {
      try {
        const data = await getDiagnostic(params.id);
        setReport(data);
        if (data && data.root_cause_summary === 'Agent is diagnosing...') {
          if (!intervalId) {
            intervalId = setInterval(fetchReport, 2000);
          }
        } else {
          if (intervalId) {
            clearInterval(intervalId);
            intervalId = null;
          }
        }
      } catch (err) {
        setError('Failed to load diagnostic report');
        if (intervalId) {
          clearInterval(intervalId);
          intervalId = null;
        }
      } finally {
        setLoading(false);
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type !== 'diagnostic_completed') return;

        const diagnostic = msg.data;
        if (diagnostic.id === params.id || diagnostic.anomaly_id === params.id) {
          setReport(diagnostic);
          setError(null);
          setLoading(false);
          if (intervalId) {
            clearInterval(intervalId);
            intervalId = null;
          }
        }
      } catch (err) {
        console.error('Failed to parse WebSocket message:', err);
      }
    };

    if (params.id) {
      fetchReport();
    }

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
      ws.close();
    };
  }, [params.id]);

  useEffect(() => {
    if (report?.agent_trace_id && !traceData) {
      getTrace(report.agent_trace_id)
        .then(data => setTraceData(data))
        .catch(err => console.error('Failed to fetch trace data:', err));
    }
  }, [report?.agent_trace_id, traceData]);

  // --- Apply Fix flow ---
  const handleApplyFix = useCallback(async () => {
    if (fixState !== 'idle') return;
    setFixState('generating');
    setFixStep(0);

    const fn = report.root_cause_function || 'unknown';
    const clean = fn.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    const branchName = `fix/${clean}-${report.id?.slice(-6) || 'patch'}`;
    const commitMessage = `Fix: ${report.root_cause_summary}`;

    try {
      // Step 1: Analyze Code
      await new Promise(r => setTimeout(r, 1200));
      setFixStep(1);
      
      // Step 2: Generate Fix
      await new Promise(r => setTimeout(r, 1800));
      setFixStep(2);
      
      // Step 3: Create PR on GitHub
      await applyFix(report.id, branchName, commitMessage);
      
      // Navigate to the home page to show the PR card
      router.push(`/?openFix=${report.id}`);
    } catch (err) {
      console.error('Failed to apply fix:', err);
      alert(`Failed to apply fix: ${err.message}`);
      setFixState('idle');
    }
  }, [fixState, report, router]);




  if (loading) {
    return (
      <div className="container">
        <div className="report-loading">
          <div className="loading-shimmer" style={{ height: '32px', width: '50%', marginBottom: '16px', borderRadius: '8px' }} />
          <div className="loading-shimmer" style={{ height: '20px', width: '70%', marginBottom: '8px', borderRadius: '6px' }} />
          <div className="loading-shimmer" style={{ height: '20px', width: '60%', marginBottom: '32px', borderRadius: '6px' }} />
          <div className="loading-shimmer" style={{ height: '200px', width: '100%', borderRadius: '12px' }} />
        </div>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="container">
        <div className="empty-state-large">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--color-error)" strokeWidth="1.5">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
          <h3>Report Not Found</h3>
          <p>{error || 'The requested diagnostic report could not be found.'}</p>
          <Link href="/diagnostics" className="btn btn-secondary">
            ← Back to Diagnostics
          </Link>
        </div>
      </div>
    );
  }

  const severityColors = {
    critical: '#f85149',
    high: '#e3b341',
    medium: '#d29922',
    low: '#58a6ff',
  };

  const formatDate = (ts) => {
    try {
      return new Date(ts).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      return ts;
    }
  };

  return (
    <div className="container">
      {/* Breadcrumb */}
      <nav className="breadcrumb animate-fade-in">
        <Link href="/" className="breadcrumb-link">Dashboard</Link>
        <span className="breadcrumb-separator">/</span>
        <Link href="/diagnostics" className="breadcrumb-link">Diagnostics</Link>
        <span className="breadcrumb-separator">/</span>
        <span className="breadcrumb-current">Report</span>
      </nav>

      {/* Report Header */}
      <div className="report-header animate-slide-up">
        <div className="report-header-left">
          <div className="report-header-top">
            {report.root_cause_summary === 'Agent is diagnosing...' ? (
              <span
                className="badge badge-warning"
                style={{ fontSize: '0.85rem', padding: '4px 14px', background: 'rgba(210, 153, 34, 0.15)', color: '#d29922', display: 'inline-flex', alignItems: 'center', gap: '8px' }}
              >
                <span className="spinner" style={{ borderTopColor: '#d29922' }} />
                ANALYZING...
              </span>
            ) : (
              <span
                className={`badge badge-${report.severity}`}
                style={{ fontSize: '0.85rem', padding: '4px 14px' }}
              >
                {report.severity?.toUpperCase()}
              </span>
            )}
            <span className="report-timestamp">{formatDate(report.timestamp)}</span>
          </div>
          <h1 className="report-title">{report.root_cause_summary}</h1>
          <div className="report-location">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-secondary)" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            <code className="report-function">{report.root_cause_function}</code>
            <span className="report-file">
              {report.root_cause_file}
              {report.root_cause_lines && `:${report.root_cause_lines}`}
            </span>
          </div>
        </div>
        <div className="report-header-right" style={{ minWidth: '200px' }}>
          <div style={{ marginBottom: 4, display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 600 }}>
            <span>
              Confidence
              {report.model_used === 'local-fallback' && (
                <span style={{ marginLeft: 6, padding: '2px 6px', background: 'rgba(0,0,0,0.05)', border: '2px solid #000', borderRadius: 0, fontSize: 10, textTransform: 'uppercase' }}>Fallback AI</span>
              )}
            </span>
            <span>{Math.round((report.confidence_score || 0) * 100)}%</span>
          </div>
          <div style={{ width: '100%', height: 12, background: '#fff', borderRadius: 0, overflow: 'hidden', border: '2px solid #000' }}>
            <div style={{
              width: `${Math.round((report.confidence_score || 0) * 100)}%`,
              height: '100%',
              background: '#000',
              transition: 'width 0.4s ease'
            }} />
          </div>
        </div>
      </div>

      {/* Root Cause Analysis */}
      <div className="report-section animate-slide-up animate-delay-1">
        <h2 className="report-section-title">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          Root Cause Analysis
        </h2>
        <div className="report-explanation">
          {report.explanation?.split('\n').map((paragraph, i) => (
            <p key={i}>{paragraph}</p>
          ))}
        </div>
      </div>

      {/* Source Code Context */}
      {report.source_code_context && (
        <div className="report-section animate-slide-up animate-delay-2">
          <h2 className="report-section-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-warning)" strokeWidth="2">
              <polyline points="16 18 22 12 16 6" />
              <polyline points="8 6 2 12 8 18" />
            </svg>
            Identified Source Code
          </h2>
          <div className="code-block">
            {report.source_code_context.split('\n').map((line, i) => {
              const isHighlighted = report.root_cause_lines && isLineInRange(i + 1, report.root_cause_lines);
              return (
                <div key={i} className={`code-line ${isHighlighted ? 'highlighted' : ''}`}>
                  <span className="code-line-number">{i + 1}</span>
                  <span className="code-line-content">{line}</span>
                </div>
              );
            })}
          </div>
          <div className="flex gap-8 mt-4 pt-4 border-t border-gray-100">
            <div>
              <div className="text-xs var(--text-tertiary) mb-1 uppercase tracking-wider">Model Used</div>
              <div className="text-sm font-medium">{report.model_used || "unknown"}</div>
            </div>
            <div>
              <div className="text-xs var(--text-tertiary) mb-1 uppercase tracking-wider">Total Tokens</div>
              <div className="text-sm font-medium">{traceData?.total_tokens ? traceData.total_tokens.toLocaleString() : "—"}</div>
            </div>
            <div>
              <div className="text-xs var(--text-tertiary) mb-1 uppercase tracking-wider">Est. Cost</div>
              <div className="text-sm font-medium">{traceData?.estimated_cost_usd ? "$" + traceData.estimated_cost_usd.toFixed(4) : "—"}</div>
            </div>
          </div>
        </div>
      )}

      {/* Suggested Fix */}
      {report.suggested_fix && (
        <div className="report-section animate-slide-up animate-delay-3">
          <CodeDiff
            diff={report.suggested_fix}
            filename={report.root_cause_file}
            title="AI-Generated Fix Suggestion"
          />
          {report.fix_justification && (
            <div className="fix-justification">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-success)" strokeWidth="2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
              <p>{report.fix_justification}</p>
            </div>
          )}

          {/* Apply Fix Button */}
          {fixState === 'idle' && (
            <div style={{ marginTop: 20 }}>
              <button
                onClick={handleApplyFix}
                className="fix-apply-btn"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '12px 28px',
                  fontSize: 14,
                  fontWeight: 700,
                  border: '2px solid #000',
                  background: '#000',
                  color: '#fff',
                  cursor: 'pointer',
                  boxShadow: '3px 3px 0 0 rgba(0,0,0,0.2)',
                  transition: 'all 0.2s ease',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                }}
                onMouseEnter={(e) => {
                  e.target.style.boxShadow = '5px 5px 0 0 rgba(0,0,0,0.3)';
                  e.target.style.transform = 'translate(-1px, -1px)';
                }}
                onMouseLeave={(e) => {
                  e.target.style.boxShadow = '3px 3px 0 0 rgba(0,0,0,0.2)';
                  e.target.style.transform = 'translate(0, 0)';
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
                </svg>
                Apply Fix — Create Pull Request
              </button>
            </div>
          )}

          {/* Fix Progress Steps */}
          {fixState === 'generating' && (
            <div className="fix-progress-container" style={{ marginTop: 24 }}>
              <div style={{
                padding: '24px',
                border: '2px solid #000',
                background: '#fff',
                boxShadow: '4px 4px 0 0 #000',
              }}>
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  🔧 Submitting Fix...
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: '#555', fontSize: 14 }}>
                  <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2, borderTopColor: '#000' }} />
                  <span>Generating branch, committing changes, and opening a pull request on GitHub...</span>
                </div>
              </div>
            </div>
          )}



          {/* Dismissed state */}
          {fixState === 'dismissed' && (
            <div style={{
              marginTop: 20,
              padding: '12px 20px',
              border: '1px solid rgba(0,0,0,0.1)',
              background: 'rgba(0,0,0,0.02)',
              fontSize: 13,
              color: '#888',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}>
              <span>Pull request was closed.</span>
              <button
                onClick={() => setFixState('idle')}
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  border: '1px solid #000',
                  background: '#fff',
                  color: '#000',
                  padding: '4px 12px',
                  cursor: 'pointer',
                }}
              >
                Try Again
              </button>
            </div>
          )}
        </div>
      )}

      {/* Report Metadata */}
      <div className="report-section animate-slide-up animate-delay-4">
        <h2 className="report-section-title">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-secondary)" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
          Report Metadata
        </h2>
        <div className="metadata-grid">
          <MetaItem label="Report ID" value={report.id} />
          <MetaItem label="Anomaly ID" value={report.anomaly_id} />
          <MetaItem label="Generated At" value={formatDate(report.timestamp)} />
          <MetaItem label="Severity" value={report.severity} />
          <MetaItem label="Root Cause Function" value={report.root_cause_function} />
          <MetaItem label="File" value={report.root_cause_file} />
          <MetaItem label="Model Used" value={report.model_used || 'gemini-3-flash-preview'} />
        </div>
      </div>

      {/* Actions */}
      <div className="report-actions animate-fade-in">
        <Link href="/diagnostics" className="btn btn-secondary">
          ← All Diagnostics
        </Link>
        <Link href="/" className="btn btn-primary">
          Dashboard
        </Link>
      </div>
    </div>
  );
}

function MetaItem({ label, value }) {
  return (
    <div className="meta-item">
      <span className="meta-label">{label}</span>
      <span className="meta-value">{value || '—'}</span>
    </div>
  );
}

function isLineInRange(lineNum, rangeStr) {
  try {
    if (!rangeStr) return false;
    const parts = rangeStr.split('-');
    const start = parseInt(parts[0]);
    const end = parts.length > 1 ? parseInt(parts[1]) : start;
    return lineNum >= start && lineNum <= end;
  } catch {
    return false;
  }
}

function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash;
}

