'use client';

import React, { useMemo } from 'react';
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
    second: '2-digit',
  });
}

/**
 * MetricChart — real-time system metrics visualisation.
 *
 * @param {Object[]} data        Array of { timestamp, cpu_percent, memory_mb, heap_used_mb }
 * @param {Object}   thresholds  Optional { cpu: number, memory: number } for horizontal guide lines
 */
export default function MetricChart({ data = [], thresholds }) {
  const option = useMemo(() => {
    if (!data || data.length === 0) return null;

    const timestamps = data.map((d) => formatTime(d.timestamp));
    const cpuValues = data.map((d) => d.cpu_percent ?? 0);
    const memValues = data.map((d) => d.memory_mb ?? 0);

    /* ---------- no cpu markline anymore ---------- */
    
    return {
      backgroundColor: 'transparent',
      animation: false,
      aria: { enabled: false },

      /* ---- tooltip ---- */
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#ffffff',
        borderColor: '#000000',
        borderWidth: 1,
        borderRadius: 0,
        padding: [10, 14],
        textStyle: { color: '#000000', fontSize: 12, fontFamily: 'var(--font-sans)' },
        axisPointer: { 
          lineStyle: { color: '#000000', width: 1, type: 'solid' },
          label: { show: false }
        }
      },

      /* ---- legend ---- */
      legend: {
        bottom: 0,
        left: 'center',
        textStyle: { color: '#000000', fontSize: 12, fontFamily: 'var(--font-serif)' },
        icon: 'path://M0,0 L20,0',
        itemWidth: 24,
        itemHeight: 2,
        data: [
          { name: 'CPU %', icon: 'path://M0,0 L20,0' },
          { name: 'Memory MB', icon: 'path://M0,0 L10,0 M15,0 L20,0' }
        ]
      },

      /* ---- grid ---- */
      grid: {
        top: 20,
        left: 56,
        right: 40,
        bottom: 50,
        containLabel: false,
      },

      /* ---- X axis ---- */
      xAxis: {
        type: 'category',
        data: timestamps,
        boundaryGap: false,
        axisLine: { lineStyle: { color: '#000000', width: 1 } },
        axisTick: { show: true, lineStyle: { color: '#000000' } },
        axisLabel: { color: '#000000', fontSize: 10, margin: 10, fontFamily: 'var(--font-sans)' },
        splitLine: { show: false },
      },

      /* ---- Y axis ---- */
      yAxis: {
        type: 'value',
        axisLine: { show: true, lineStyle: { color: '#000000', width: 1 } },
        axisTick: { show: true, lineStyle: { color: '#000000' } },
        axisLabel: { color: '#000000', fontSize: 10, fontFamily: 'var(--font-sans)' },
        splitLine: { show: false },
      },

      /* ---- series ---- */
      series: [
        {
          name: 'CPU %',
          type: 'line',
          smooth: false,
          symbol: 'none',
          data: cpuValues,
          lineStyle: { color: '#000000', width: 2, type: 'solid' },
          itemStyle: { color: '#000000' },
        },
        {
          name: 'Memory MB',
          type: 'line',
          smooth: false,
          symbol: 'none',
          data: memValues,
          lineStyle: { color: '#000000', width: 2, type: 'dashed' },
          itemStyle: { color: '#000000' },
        },
      ],
    };
  }, [data, thresholds]);

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
    <div className="chart-container" title="">
      <ReactECharts
        option={option}
        style={{ width: '100%', height: 280 }}
        opts={{ renderer: 'canvas' }}
        notMerge={true}
        lazyUpdate={true}
      />
    </div>
  );
}
