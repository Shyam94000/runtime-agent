'use client';

import React, { useState, useCallback } from 'react';
import { applyFix } from '../lib/api';

/**
 * Generates a branch name from the diagnostic report data.
 */
function generateBranchName(report) {
  const fn = report.root_cause_function || 'unknown';
  const clean = fn.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
  return `fix/${clean}-${report.id?.slice(-6) || 'patch'}`;
}

/**
 * Parses a unified diff to count additions and deletions.
 */
function parseDiffStats(diff) {
  if (!diff) return { additions: 0, deletions: 0 };
  const lines = diff.split('\n');
  let additions = 0;
  let deletions = 0;
  for (const line of lines) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions++;
    if (line.startsWith('-') && !line.startsWith('---')) deletions++;
  }
  return { additions, deletions };
}

/**
 * Generates a short filename from a full path.
 */
function shortFileName(path) {
  if (!path) return 'unknown';
  const parts = path.replace(/\\/g, '/').split('/');
  return parts.slice(-2).join('/');
}

/**
 * FixRequestCard — GitHub-style Pull Request card for the AI fix workflow.
 *
 * Props:
 *   report       – The full diagnostic report object
 *   onMerge      – Callback when the fix is merged (receives the fix data)
 *   onDismiss    – Callback to dismiss/close the card
 */
export default function FixRequestCard({ report, fix, onDismiss }) {
  if (!report) return null;

  const branchName = fix?.branchName || generateBranchName(report);
  const prNumber = fix?.prNumber || Math.floor(Math.abs(hashCode(report.id || '')) % 900) + 100;
  const stats = parseDiffStats(report.suggested_fix);
  const fileName = shortFileName(report.root_cause_file);

  const isMerged = fix?.status === 'merged';
  const prUrl = fix?.prUrl;

  return (
    <div
      className={`fix-request-card ${isMerged ? 'fix-request-merged' : ''}`}
      style={{
        border: `2px solid ${isMerged ? '#1a7f37' : '#000'}`,
        background: '#fff',
        boxShadow: isMerged ? '4px 4px 0 0 #1a7f37' : '4px 4px 0 0 #000',
        padding: 0,
        overflow: 'hidden',
        transition: 'all 0.3s ease',
      }}
    >
      {/* PR Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 20px',
          borderBottom: `2px solid ${isMerged ? '#1a7f37' : '#000'}`,
          background: isMerged ? 'rgba(26, 127, 55, 0.04)' : 'rgba(0,0,0,0.02)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* PR icon */}
          <svg width="20" height="20" viewBox="0 0 16 16" fill={isMerged ? '#1a7f37' : '#000'}>
            {isMerged ? (
              <path fillRule="evenodd" d="M5 3.254V3.25v.005a.75.75 0 110-.005v.004zm.45 1.9a2.25 2.25 0 10-1.95.218v5.256a2.25 2.25 0 101.5 0V7.123A5.735 5.735 0 009.25 9h1.378a2.251 2.251 0 100-1.5H9.25a4.25 4.25 0 01-3.8-2.346zM12.75 9a.75.75 0 100-1.5.75.75 0 000 1.5zm-8.5 4.5a.75.75 0 100-1.5.75.75 0 000 1.5z" />
            ) : (
              <path fillRule="evenodd" d="M7.177 3.073L9.573.677A.25.25 0 0110 .854v4.792a.25.25 0 01-.427.177L7.177 3.427a.25.25 0 010-.354zM3.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122v5.256a2.251 2.251 0 11-1.5 0V5.372A2.25 2.25 0 011.5 3.25zM11 2.5h-1V4h1a1 1 0 011 1v5.628a2.251 2.251 0 101.5 0V5A2.5 2.5 0 0011 2.5zm1 10.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0zM3.75 12a.75.75 0 100 1.5.75.75 0 000-1.5z" />
            )}
          </svg>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: isMerged ? '#1a7f37' : '#000' }}>
              {report.root_cause_summary}
            </div>
            <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>
              #{prNumber} opened by <span style={{ fontWeight: 600 }}>runtime-agent-bot</span>
            </div>
          </div>
        </div>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 12px',
            fontSize: 12,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            border: `2px solid ${isMerged ? '#1a7f37' : '#000'}`,
            background: isMerged ? '#1a7f37' : '#000',
            color: '#fff',
          }}
        >
          {isMerged ? (
            <>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                <path fillRule="evenodd" d="M5 3.254V3.25v.005a.75.75 0 110-.005v.004zm.45 1.9a2.25 2.25 0 10-1.95.218v5.256a2.25 2.25 0 101.5 0V7.123A5.735 5.735 0 009.25 9h1.378a2.251 2.251 0 100-1.5H9.25a4.25 4.25 0 01-3.8-2.346zM12.75 9a.75.75 0 100-1.5.75.75 0 000 1.5zm-8.5 4.5a.75.75 0 100-1.5.75.75 0 000 1.5z" />
              </svg>
              Merged
            </>
          ) : (
            <>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                <path fillRule="evenodd" d="M7.177 3.073L9.573.677A.25.25 0 0110 .854v4.792a.25.25 0 01-.427.177L7.177 3.427a.25.25 0 010-.354zM3.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122v5.256a2.251 2.251 0 11-1.5 0V5.372A2.25 2.25 0 011.5 3.25zM11 2.5h-1V4h1a1 1 0 011 1v5.628a2.251 2.251 0 101.5 0V5A2.5 2.5 0 0011 2.5zm1 10.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0zM3.75 12a.75.75 0 100 1.5.75.75 0 000-1.5z" />
              </svg>
              Open
            </>
          )}
        </span>
      </div>

      {/* Branch info */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '12px 20px',
          borderBottom: '1px solid rgba(0,0,0,0.1)',
          fontSize: 13,
        }}
      >
        <span style={{ color: '#666' }}>
          {isMerged ? 'Merged' : 'Wants to merge'} into
        </span>
        <code
          style={{
            padding: '2px 8px',
            fontSize: 12,
            fontFamily: "'JetBrains Mono', monospace",
            background: 'rgba(0,0,0,0.06)',
            border: '1px solid rgba(0,0,0,0.15)',
            fontWeight: 600,
          }}
        >
          main
        </code>
        <span style={{ color: '#666' }}>from</span>
        <code
          style={{
            padding: '2px 8px',
            fontSize: 12,
            fontFamily: "'JetBrains Mono', monospace",
            background: 'rgba(0,0,0,0.06)',
            border: '1px solid rgba(0,0,0,0.15)',
            fontWeight: 600,
          }}
        >
          {branchName}
        </code>
      </div>

      {/* Description */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(0,0,0,0.1)' }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#888' }}>
          Description
        </div>
        <p style={{ fontSize: 14, lineHeight: 1.6, color: '#333', margin: 0 }}>
          {report.fix_justification || report.explanation?.split('\n')[0] || 'Automated fix generated by AI runtime agent.'}
        </p>
      </div>

      {/* Changed files */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(0,0,0,0.1)' }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#888' }}>
          Changed Files
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 14px',
            background: 'rgba(0,0,0,0.02)',
            border: '1px solid rgba(0,0,0,0.1)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="2">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            <code style={{ fontSize: 13, fontFamily: "'JetBrains Mono', monospace", fontWeight: 500 }}>
              {fileName}
            </code>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 13, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", color: '#1a7f37' }}>
              +{stats.additions}
            </span>
            <span style={{ fontSize: 13, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", color: '#cf222e' }}>
              −{stats.deletions}
            </span>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 20px',
          background: isMerged ? 'rgba(26, 127, 55, 0.04)' : 'rgba(0,0,0,0.02)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: isMerged ? '#1a7f37' : '#000', fontSize: 14, fontWeight: 600 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span>
            {prUrl ? (
              <a href={prUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'underline', color: isMerged ? '#1a7f37' : '#000' }}>
                View Pull Request on GitHub
              </a>
            ) : (
              'Pull Request ready'
            )}
          </span>
        </div>
        <button
          onClick={onDismiss}
          style={{
            padding: '8px 16px',
            fontSize: 13,
            fontWeight: 600,
            border: '2px solid #000',
            background: '#fff',
            color: '#000',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={(e) => { e.target.style.background = '#f5f5f5'; }}
          onMouseLeave={(e) => { e.target.style.background = '#fff'; }}
        >
          Close
        </button>
      </div>
    </div>
  );
}

/**
 * Compact version of the card for use on the dashboard.
 */
export function FixRequestCardCompact({ fix, onDelete }) {
  if (!fix) return null;

  const isMerged = fix.status === 'merged';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 16px',
        borderBottom: '1px solid rgba(0,0,0,0.08)',
        transition: 'background 0.15s ease',
        cursor: 'default',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.02)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
        {/* PR status icon */}
        <div
          style={{
            width: 28,
            height: 28,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: `2px solid ${isMerged ? '#1a7f37' : '#000'}`,
            background: isMerged ? 'rgba(26, 127, 55, 0.08)' : 'rgba(0,0,0,0.03)',
            flexShrink: 0,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill={isMerged ? '#1a7f37' : '#000'}>
            {isMerged ? (
              <path fillRule="evenodd" d="M5 3.254V3.25v.005a.75.75 0 110-.005v.004zm.45 1.9a2.25 2.25 0 10-1.95.218v5.256a2.25 2.25 0 101.5 0V7.123A5.735 5.735 0 009.25 9h1.378a2.251 2.251 0 100-1.5H9.25a4.25 4.25 0 01-3.8-2.346zM12.75 9a.75.75 0 100-1.5.75.75 0 000 1.5zm-8.5 4.5a.75.75 0 100-1.5.75.75 0 000 1.5z" />
            ) : (
              <path fillRule="evenodd" d="M7.177 3.073L9.573.677A.25.25 0 0110 .854v4.792a.25.25 0 01-.427.177L7.177 3.427a.25.25 0 010-.354zM3.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122v5.256a2.251 2.251 0 11-1.5 0V5.372A2.25 2.25 0 011.5 3.25zM11 2.5h-1V4h1a1 1 0 011 1v5.628a2.251 2.251 0 101.5 0V5A2.5 2.5 0 0011 2.5zm1 10.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0zM3.75 12a.75.75 0 100 1.5.75.75 0 000-1.5z" />
            )}
          </svg>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#000', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {fix.title}
          </div>
          <div style={{ fontSize: 11, color: '#888', marginTop: 2, fontFamily: "'JetBrains Mono', monospace" }}>
            #{fix.prNumber} · {fix.branchName}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        {fix.file && (
          <code style={{ fontSize: 11, color: '#888', fontFamily: "'JetBrains Mono', monospace" }}>
            {shortFileName(fix.file)}
          </code>
        )}
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '3px 10px',
            fontSize: 11,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            border: `2px solid ${isMerged ? '#1a7f37' : '#000'}`,
            background: isMerged ? '#1a7f37' : '#000',
            color: '#fff',
          }}
        >
          {isMerged ? 'Merged' : 'Open'}
        </span>
        {onDelete && (
          <button
            onClick={onDelete}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: '#cf222e',
              padding: '4px',
              display: 'flex',
              alignItems: 'center',
            }}
            title="Remove Fix"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              <line x1="10" y1="11" x2="10" y2="17"></line>
              <line x1="14" y1="11" x2="14" y2="17"></line>
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Simple string hash for generating deterministic PR numbers.
 */
function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash;
}
