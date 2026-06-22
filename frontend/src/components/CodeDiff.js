'use client';

import React, { useCallback, useState } from 'react';

/**
 * Parses a unified diff string into an array of structured line objects.
 * Each object carries the raw text, the computed old/new line numbers,
 * and a type classification used for styling.
 *
 * Supported line prefixes:
 *   '+'   → added line
 *   '-'   → removed line
 *   '@@'  → hunk header
 *   ' '   → context (unchanged)
 */
function parseDiff(raw) {
  if (!raw) return [];

  const lines = raw.split('\n');
  const parsed = [];
  let oldLine = 0;
  let newLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    /* ---- hunk header (@@ -a,b +c,d @@) ---- */
    if (line.startsWith('@@')) {
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldLine = parseInt(match[1], 10);
        newLine = parseInt(match[2], 10);
      }
      parsed.push({ type: 'header', content: line, oldNum: null, newNum: null });
      continue;
    }

    /* ---- removed line ---- */
    if (line.startsWith('-')) {
      parsed.push({ type: 'removed', content: line.slice(1), oldNum: oldLine, newNum: null });
      oldLine++;
      continue;
    }

    /* ---- added line ---- */
    if (line.startsWith('+')) {
      parsed.push({ type: 'added', content: line.slice(1), oldNum: null, newNum: newLine });
      newLine++;
      continue;
    }

    /* ---- context / unchanged ---- */
    const content = line.startsWith(' ') ? line.slice(1) : line;
    parsed.push({ type: 'context', content, oldNum: oldLine, newNum: newLine });
    oldLine++;
    newLine++;
  }

  return parsed;
}

/**
 * Resolves a CSS class string for a given line type.
 */
function lineClassName(type) {
  switch (type) {
    case 'added':
      return 'code-line added';
    case 'removed':
      return 'code-line removed';
    case 'header':
      return 'code-line header';
    default:
      return 'code-line';
  }
}

/**
 * CodeDiff — renders a unified diff with syntax colouring,
 * dual-gutter line numbers, and one-click copy.
 *
 * @param {string} diff      Unified diff content
 * @param {string} filename  Path/name of the file being modified
 * @param {string} title     Section heading (default: "Suggested Fix")
 */
export default function CodeDiff({ diff, filename, title = 'Suggested Fix' }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    if (!diff) return;
    try {
      await navigator.clipboard.writeText(diff);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* Fallback for older browsers or non-secure contexts */
      const textarea = document.createElement('textarea');
      textarea.value = diff;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [diff]);

  /* ---- empty / null guard ---- */
  if (!diff || diff.trim().length === 0) {
    return (
      <div className="report-section">
        <div className="report-section-title">{title}</div>
        <div
          style={{
            padding: '24px 16px',
            color: '#484f58',
            fontSize: 13,
            textAlign: 'center',
          }}
        >
          No diff available.
        </div>
      </div>
    );
  }

  const lines = parseDiff(diff);

  return (
    <div className="report-section">
      <div className="report-section-title">{title}</div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        {/* ---- filename badge ---- */}
        {filename ? (
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 12px',
              fontSize: 13,
              fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
              fontWeight: 600,
              color: '#000',
              background: '#e0e0e0',
              border: '2px solid #000',
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            {filename}
          </div>
        ) : (
          <div />
        )}

        {/* copy button */}
        <button
          onClick={handleCopy}
          aria-label="Copy diff to clipboard"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 12px',
            fontSize: 13,
            fontWeight: 700,
            color: copied ? '#fff' : '#000',
            background: copied ? '#1a7f37' : '#e0e0e0',
            border: '2px solid #000',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            boxShadow: '2px 2px 0 0 #000',
          }}
        >
          {copied ? (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Copied
            </>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
              </svg>
              Copy
            </>
          )}
        </button>
      </div>

      {/* ---- diff code block ---- */}
      <div className="code-block" style={{ marginTop: 0 }}>

        {/* rendered lines */}
        {lines.map((line, idx) => (
          <div key={idx} className={lineClassName(line.type)}>
            {line.type === 'header' ? (
              <span
                className="code-line-content"
                style={{
                  color: '#8b949e',
                  fontStyle: 'italic',
                  paddingLeft: 12,
                  userSelect: 'none',
                }}
              >
                {line.content}
              </span>
            ) : (
              <>
                <span className="code-line-number">
                  {line.oldNum !== null ? line.oldNum : ' '}
                </span>
                <span className="code-line-number">
                  {line.newNum !== null ? line.newNum : ' '}
                </span>
                <span className="code-line-content" style={{
                  color: line.type === 'added' ? '#0d5d21' : line.type === 'removed' ? '#cf222e' : 'inherit'
                }}>
                  {line.type === 'added' && (
                    <span style={{ userSelect: 'none', opacity: 0.7, marginRight: 4, fontWeight: 700 }}>+</span>
                  )}
                  {line.type === 'removed' && (
                    <span style={{ userSelect: 'none', opacity: 0.7, marginRight: 4, fontWeight: 700 }}>−</span>
                  )}
                  {line.content}
                </span>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
