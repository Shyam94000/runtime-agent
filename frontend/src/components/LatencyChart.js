'use client';

import React, { useMemo } from 'react';
import dynamic from 'next/dynamic';

const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false });

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

export default function LatencyChart({ data = [], dataKey, title, lineType = 'solid' }) {
  const option = useMemo(() => {
    if (!data || data.length === 0) return null;

    const timestamps = data.map((d) => formatTime(d.timestamp));
    const values = data.map((d) => d[dataKey] ?? 0);

    return {
      backgroundColor: 'transparent',
      animation: false,
      aria: { enabled: false },

      tooltip: {
        trigger: 'axis',
        backgroundColor: '#ffffff',
        borderColor: '#000000',
        borderWidth: 1,
        borderRadius: 0,
        padding: [8, 12],
        textStyle: { color: '#000000', fontSize: 12, fontFamily: 'var(--font-sans)' },
        axisPointer: { 
          type: 'line',
          lineStyle: { color: '#000000', width: 1, type: 'solid' },
        }
      },

      legend: {
        bottom: 0,
        left: 'center',
        textStyle: { color: '#000000', fontSize: 12, fontFamily: 'var(--font-serif)' },
        icon: lineType === 'dashed' ? 'path://M0,0 L10,0 M15,0 L20,0' : 'path://M0,0 L20,0',
        itemWidth: 24,
        itemHeight: 2,
        data: [{ name: title, icon: lineType === 'dashed' ? 'path://M0,0 L10,0 M15,0 L20,0' : 'path://M0,0 L20,0' }]
      },

      grid: {
        top: 20,
        left: 40,
        right: 20,
        bottom: 50,
        containLabel: false,
      },

      xAxis: {
        type: 'category',
        data: timestamps,
        boundaryGap: false,
        axisLine: { lineStyle: { color: '#000000', width: 1 } },
        axisTick: { show: true, lineStyle: { color: '#000000' } },
        axisLabel: { color: '#000000', fontSize: 10, margin: 10, fontFamily: 'var(--font-sans)' },
        splitLine: { show: false },
      },

      yAxis: {
        type: 'value',
        axisLine: { show: true, lineStyle: { color: '#000000', width: 1 } },
        axisTick: { show: true, lineStyle: { color: '#000000' } },
        axisLabel: { color: '#000000', fontSize: 10, fontFamily: 'var(--font-sans)' },
        splitLine: { show: false },
      },

      series: [
        {
          name: title,
          type: 'line',
          smooth: false,
          symbol: 'none',
          label: { show: false },
          data: values,
          lineStyle: { color: '#000000', width: 2, type: lineType },
          itemStyle: { color: '#000000' },
          emphasis: { label: { show: false } },
        }
      ],
    };
  }, [data, dataKey, title, lineType]);

  if (!data || data.length === 0) {
    return null;
  }

  return (
    <div style={{ flex: 1, minWidth: '300px' }}>
      <ReactECharts
        option={option}
        style={{ width: '100%', height: 160 }}
        opts={{ renderer: 'canvas' }}
        notMerge={true}
        lazyUpdate={true}
      />
    </div>
  );
}
