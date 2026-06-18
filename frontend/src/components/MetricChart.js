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
    const heapValues = data.map((d) => d.heap_used_mb ?? 0);

    /* ---------- threshold markLine for CPU series ---------- */
    const cpuMarkLine = thresholds?.cpu
      ? {
          silent: true,
          symbol: 'none',
          lineStyle: { type: 'dashed', color: '#f85149', width: 1.5 },
          label: {
            formatter: `CPU {c}%`,
            position: 'insideEndTop',
            color: '#f85149',
            fontSize: 11,
          },
          data: [{ yAxis: thresholds.cpu }],
        }
      : undefined;

    return {
      backgroundColor: 'transparent',
      animation: true,
      animationDuration: 500,
      animationEasing: 'cubicInOut',

      /* ---- tooltip ---- */
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#1c2028',
        borderColor: '#30363d',
        borderWidth: 1,
        borderRadius: 8,
        padding: [10, 14],
        textStyle: { color: '#c9d1d9', fontSize: 12 },
        axisPointer: { lineStyle: { color: 'rgba(88,166,255,0.25)', width: 1 } },
        formatter(params) {
          let html = `<div style="margin-bottom:6px;font-weight:600;color:#e6edf3">${params[0].axisValueLabel}</div>`;
          params.forEach((p) => {
            const dot = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color};margin-right:6px"></span>`;
            const unit = p.seriesName === 'CPU %' ? '%' : ' MB';
            html += `<div style="line-height:1.8">${dot}${p.seriesName}: <b>${p.value}${unit}</b></div>`;
          });
          return html;
        },
      },

      /* ---- legend ---- */
      legend: {
        top: 4,
        right: 0,
        textStyle: { color: '#8b949e', fontSize: 11 },
        icon: 'roundRect',
        itemWidth: 14,
        itemHeight: 3,
      },

      /* ---- grid ---- */
      grid: {
        top: 40,
        left: 56,
        right: 62,
        bottom: 32,
        containLabel: false,
      },

      /* ---- X axis ---- */
      xAxis: {
        type: 'category',
        data: timestamps,
        boundaryGap: false,
        axisLine: { lineStyle: { color: 'rgba(48,54,61,0.4)' } },
        axisTick: { show: false },
        axisLabel: { color: '#8b949e', fontSize: 10, margin: 10 },
        splitLine: { show: false },
      },

      /* ---- Y axes ---- */
      yAxis: [
        {
          type: 'value',
          name: 'CPU %',
          nameTextStyle: { color: '#58a6ff', fontSize: 11, padding: [0, 40, 0, 0] },
          min: 0,
          max: 100,
          splitNumber: 5,
          axisLine: { show: true, lineStyle: { color: 'rgba(48,54,61,0.4)' } },
          axisTick: { show: false },
          axisLabel: { color: '#8b949e', fontSize: 10, formatter: '{value}%' },
          splitLine: { lineStyle: { color: 'rgba(48,54,61,0.4)', type: 'dashed' } },
        },
        {
          type: 'value',
          name: 'Memory MB',
          nameTextStyle: { color: '#3fb950', fontSize: 11, padding: [0, 0, 0, 40] },
          axisLine: { show: true, lineStyle: { color: 'rgba(48,54,61,0.4)' } },
          axisTick: { show: false },
          axisLabel: { color: '#8b949e', fontSize: 10, formatter: '{value}' },
          splitLine: { show: false },
        },
      ],

      /* ---- series ---- */
      series: [
        {
          name: 'CPU %',
          type: 'line',
          smooth: true,
          symbol: 'none',
          yAxisIndex: 0,
          data: cpuValues,
          lineStyle: { color: '#58a6ff', width: 2 },
          itemStyle: { color: '#58a6ff' },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(88,166,255,0.20)' },
                { offset: 1, color: 'rgba(88,166,255,0.00)' },
              ],
            },
          },
          markLine: cpuMarkLine,
        },
        {
          name: 'Memory MB',
          type: 'line',
          smooth: true,
          symbol: 'none',
          yAxisIndex: 1,
          data: memValues,
          lineStyle: { color: '#3fb950', width: 2 },
          itemStyle: { color: '#3fb950' },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(63,185,80,0.18)' },
                { offset: 1, color: 'rgba(63,185,80,0.00)' },
              ],
            },
          },
        },
        {
          name: 'Heap Used',
          type: 'line',
          smooth: true,
          symbol: 'none',
          yAxisIndex: 1,
          data: heapValues,
          lineStyle: { color: '#d29922', width: 1.5, type: 'dashed' },
          itemStyle: { color: '#d29922' },
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
    <div className="chart-container">
      <ReactECharts
        option={option}
        style={{ width: '100%', height: 280 }}
        opts={{ renderer: 'canvas' }}
        notMerge={false}
        lazyUpdate={true}
      />
    </div>
  );
}
