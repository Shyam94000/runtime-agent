'use client';

import React, { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';

/**
 * Dynamically import ReactECharts to prevent server-side rendering issues.
 * ECharts relies on browser APIs (canvas, DOM measurement) that are
 * unavailable during SSR, so we force client-only loading.
 */
const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false });

/**
 * Formats a timestamp value into HH:mm:ss for the X-axis.
 * Accepts ISO strings, epoch milliseconds, or Date objects.
 */
function formatTime(raw) {
  const d = new Date(raw);
  if (isNaN(d.getTime())) return '--:--:--';
  return d.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  });
}

const METRICS_CONFIG = [
  { id: 'cpu', label: 'CPU %', type: 'solid', getData: d => d.cpu_percent ?? 0 },
  { id: 'memory', label: 'Memory MB', type: 'dashed', getData: d => d.memory_mb ?? 0 },
  { id: 'elu', label: 'ELU %', type: 'dotted', getData: d => (d.elu ?? 0) * 100 },
  { id: 'gc', label: 'GC Max ms', type: [10, 5], getData: d => d.gc_pause_max_ms ?? 0 },
  { id: 'rps', label: 'req/s', type: [10, 5, 2, 5], getData: d => d.throughput_rps ?? 0 },
];

function LineIcon({ type }) {
  let dasharray = '';
  if (type === 'dashed') dasharray = '6,4';
  if (type === 'dotted') dasharray = '2,4';
  if (Array.isArray(type)) dasharray = type.join(',');

  return (
    <svg width="24" height="12" viewBox="0 0 24 12" style={{ marginRight: 6 }}>
      <line
        x1="0" y1="6" x2="24" y2="6"
        stroke="#000000"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={dasharray}
      />
    </svg>
  );
}

/**
 * MetricChart — real-time system metrics visualisation.
 *
 * @param {Object[]} data        Array of { timestamp, cpu_percent, memory_mb, heap_used_mb }
 * @param {Object}   thresholds  Optional { cpu: number, memory: number } for horizontal guide lines
 */
export default function MetricChart({ data = [], thresholds }) {
  const [selectedMetrics, setSelectedMetrics] = useState(new Set(['cpu', 'memory', 'elu', 'gc', 'rps']));

  const handleCheckboxChange = (id) => {
    setSelectedMetrics((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };
  const option = useMemo(() => {
    if (!data || data.length === 0) return null;

    const timestamps = data.map((d) => formatTime(d.timestamp));

    const series = METRICS_CONFIG
      .filter((config) => selectedMetrics.has(config.id))
      .map((config) => ({
        name: config.label,
        type: 'line',
        smooth: 0.2,
        symbol: 'none',
        label: { show: false },
        data: data.map(config.getData),
        lineStyle: { color: '#000000', width: 2.5, type: config.type },
        itemStyle: { color: '#000000' },
        emphasis: {
          focus: 'series',
          lineStyle: { width: 3.5 },
          label: { show: false }
        },
      }));

    /* ---------- no cpu markline anymore ---------- */
    
    return {
      backgroundColor: 'transparent',
      animation: true,
      animationDuration: 300,
      aria: { enabled: false },

      /* ---- tooltip ---- */
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        borderColor: 'rgba(0, 0, 0, 0.1)',
        borderWidth: 1,
        borderRadius: 8,
        padding: [12, 16],
        textStyle: { color: '#000000', fontSize: 12, fontFamily: 'var(--font-sans)', fontWeight: 500 },
        extraCssText: 'box-shadow: 0 4px 12px rgba(0,0,0,0.08);',
        axisPointer: { 
          type: 'line',
          lineStyle: { color: '#000000', width: 1, type: 'dashed', opacity: 0.5 },
          label: { show: false }
        }
      },

      /* ---- grid ---- */
      grid: {
        top: 30,
        left: 60,
        right: 40,
        bottom: 30,
        containLabel: false,
      },

      /* ---- X axis ---- */
      xAxis: {
        type: 'category',
        data: timestamps,
        boundaryGap: false,
        axisLine: { lineStyle: { color: 'rgba(0,0,0,0.2)', width: 1 } },
        axisTick: { show: false },
        axisLabel: { color: '#666666', fontSize: 11, margin: 12, fontFamily: 'var(--font-mono)' },
        splitLine: { show: false },
        axisPointer: { label: { show: false } },
      },

      /* ---- Y axis ---- */
      yAxis: {
        type: 'value',
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: '#666666', fontSize: 11, margin: 16, fontFamily: 'var(--font-mono)' },
        splitLine: { show: true, lineStyle: { color: 'rgba(0,0,0,0.06)', type: 'dashed' } },
        axisPointer: { label: { show: false } },
      },

      /* ---- series ---- */
      series: series,
    };
  }, [data, thresholds, selectedMetrics]);

  /* ---------- empty state ---------- */
  if (!data || data.length === 0) {
    return (
      <div className="chart-container">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: 260,
            color: '#484f58',
            fontSize: 14,
          }}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ marginRight: 8, opacity: 0.6 }}
          >
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
          </svg>
          Waiting for metrics data…
        </div>
      </div>
    );
  }

  return (
    <div className="chart-container" title="" style={{ background: '#fff', padding: '16px', borderRadius: '12px', border: '1px solid rgba(0,0,0,0.1)', boxShadow: '0 4px 20px rgba(0,0,0,0.03)' }}>
      <ReactECharts
        option={option}
        style={{ width: '100%', height: 320 }}
        opts={{ renderer: 'canvas' }}
        notMerge={true}
        lazyUpdate={true}
      />
      <div style={{ marginTop: '20px', display: 'flex', flexWrap: 'wrap', gap: '12px', justifyContent: 'center' }}>
        {METRICS_CONFIG.map((config) => {
          const isSelected = selectedMetrics.has(config.id);
          return (
            <label key={config.id} style={{
              display: 'flex', alignItems: 'center', cursor: 'pointer',
              fontSize: '13px', color: '#000000', fontFamily: 'var(--font-sans)',
              padding: '8px 14px', border: '1px solid rgba(0,0,0,0.1)', borderRadius: '8px',
              background: isSelected ? 'rgba(0,0,0,0.03)' : '#fff',
              opacity: isSelected ? 1 : 0.6,
              transition: 'all 0.2s ease',
              boxShadow: isSelected ? 'inset 0 1px 3px rgba(0,0,0,0.05)' : 'none'
            }}>
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => handleCheckboxChange(config.id)}
                style={{ display: 'none' }}
              />
              <LineIcon type={config.type} />
              <span style={{ fontWeight: 600 }}>{config.label}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
