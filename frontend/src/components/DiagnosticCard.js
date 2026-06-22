'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, AlertCircle, Info, ShieldAlert } from 'lucide-react';

/**
 * Compact SVG icons keyed by severity for the meta row.
 */
function SeverityIcon({ severity }) {
  switch (severity) {
    case 'critical':
      return <ShieldAlert size={14} strokeWidth={2} />;
    case 'high':
      return <AlertTriangle size={14} strokeWidth={2} />;
    case 'warning':
      return <AlertCircle size={14} strokeWidth={2} />;
    default:
      return <Info size={14} strokeWidth={2} />;
  }
}

/**
 * Converts a timestamp into a human-friendly relative string.
 * Falls back to an absolute date/time when the delta exceeds 24 hours.
 */
function formatRelativeTime(timestamp) {
  if (!timestamp) return '';

  const now = Date.now();
  const then = new Date(timestamp).getTime();
  if (isNaN(then)) return String(timestamp);

  const diffMs = now - then;
  const diffSec = Math.round(diffMs / 1000);
  const diffMin = Math.round(diffSec / 60);
  const diffHr = Math.round(diffMin / 60);

  if (diffSec < 10) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffMin < 60) return `${diffMin} min ago`;
  if (diffHr < 24) return `${diffHr}h ago`;

  /* Absolute format for anything older than a day */
  const d = new Date(then);
  const month = d.toLocaleString('en-US', { month: 'short' });
  const day = d.getDate();
  const time = d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  return `${month} ${day}, ${time}`;
}

/**
 * DiagnosticCard — renders a single AI-generated diagnostic summary
 * as an interactive card with severity indicator, confidence bar,
 * and navigation affordance.
 *
 * @param {Object}   diagnostic  Full diagnostic record from the API
 * @param {string}   href        Optional route to open when the card is clicked
 * @param {Function} onClick     Optional callback invoked with the diagnostic on click
 */
export default function DiagnosticCard({ diagnostic, href, onClick }) {
  const router = useRouter();

  if (!diagnostic) return null;

  const {
    id,
    anomaly_id,
    timestamp,
    root_cause_summary,
    root_cause_function,
    root_cause_file,
    root_cause_lines,
    severity = 'info',
    explanation,
    confidence_score = 0,
  } = diagnostic;

  const confidencePercent = Math.min(Math.max(Math.round(confidence_score * 100), 0), 100);

  /* Build file:line reference string */
  const fileRef = root_cause_file
    ? root_cause_lines
      ? `${root_cause_file}:${root_cause_lines}`
      : root_cause_file
    : null;
  const interactive = Boolean(href || onClick);

  const openCard = () => {
    if (onClick) {
      onClick(diagnostic);
      return;
    }
    if (href) {
      router.push(href);
    }
  };

  return (
    <div
      className={`diagnostic-card animate-slide-up ${severity}`}
      onClick={interactive ? openCard : undefined}
      style={{ cursor: interactive ? 'pointer' : 'default' }}
      role={interactive ? 'link' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={(e) => {
        if (interactive && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          openCard();
        }
      }}
    >
      {/* ---- header row: severity badge + timestamp ---- */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 10,
        }}
      >
        <span className={`badge badge-${severity}`}>
          {severity.charAt(0).toUpperCase() + severity.slice(1)}
        </span>
        <span style={{ fontSize: 12, color: '#8b949e' }}>
          {formatRelativeTime(timestamp)}
        </span>
      </div>

      {/* ---- summary ---- */}
      <div className="diagnostic-summary">{root_cause_summary}</div>

      {/* ---- detail row: function + file reference ---- */}
      {(root_cause_function || fileRef) && (
        <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          {root_cause_function && (
            <span
              style={{
                fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
                fontSize: 12,
                background: 'rgba(88,166,255,0.08)',
                color: '#58a6ff',
                padding: '2px 8px',
                borderRadius: 4,
                border: '1px solid rgba(88,166,255,0.15)',
              }}
            >
              {root_cause_function}()
            </span>
          )}
          {fileRef && (
            <span style={{ fontSize: 12, color: '#8b949e' }}>
              {fileRef}
            </span>
          )}
        </div>
      )}

      {/* ---- confidence bar ---- */}
      <div style={{ marginTop: 14 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginBottom: 4,
            fontSize: 11,
            color: '#8b949e',
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            Confidence
            {diagnostic.model_used === 'local-fallback' && (
              <span style={{
                background: 'rgba(210, 153, 34, 0.15)',
                color: '#d29922',
                padding: '2px 6px',
                borderRadius: '4px',
                fontSize: '9px',
                textTransform: 'uppercase',
                fontWeight: 600,
                border: '1px solid rgba(210, 153, 34, 0.3)'
              }}>
                Fallback AI
              </span>
            )}
          </span>
          <span>{confidencePercent}%</span>
        </div>
        <div className="confidence-bar" style={{ border: '2px solid #000', background: '#fff', borderRadius: 0, height: 12 }}>
          <div
            className="confidence-bar-fill"
            style={{
              width: `${confidencePercent}%`,
              background: '#000000',
              height: '100%',
              borderRadius: 0,
              transition: 'width 0.4s ease',
            }}
          />
        </div>
      </div>

      {/* ---- meta row ---- */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: 14,
          paddingTop: 10,
          borderTop: '1px solid rgba(48,54,61,0.5)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#8b949e', fontSize: 12 }}>
          <SeverityIcon severity={severity} />
          <span>Anomaly #{anomaly_id || id}</span>
        </div>
        <span
          style={{
            fontSize: 12,
            color: '#58a6ff',
            fontWeight: 500,
            visibility: interactive ? 'visible' : 'hidden',
          }}
        >
          View Full Report →
        </span>
      </div>
    </div>
  );
}
