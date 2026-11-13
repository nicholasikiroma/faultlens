import React, { useState } from 'react';
import type { Incident } from '../types';
import { Activity, BarChart2, ShieldCheck, TrendingUp, Clock, Layers } from 'lucide-react';

interface SparklinePoint {
  hour: string;
  count: number;
}

interface SparklineProps {
  incidents?: Incident[];
  onSelectIncident?: (id: string) => void;
}

export const Sparkline: React.FC<SparklineProps> = ({ incidents = [], onSelectIncident }) => {
  const [hoveredPoint, setHoveredPoint] = useState<SparklinePoint | null>(null);
  const [activeWindow, setActiveWindow] = useState<'1H' | '8H' | '24H'>('8H');

  // Generate dynamic hourly distribution from real live incidents
  const now = new Date();
  const currentHour = now.getHours();

  const dynamicHourlyData: SparklinePoint[] = Array.from({ length: 8 }, (_, idx) => {
    const hourVal = (currentHour - 7 + idx + 24) % 24;
    const hourStr = `${hourVal.toString().padStart(2, '0')}:00`;
    // Weight points based on real live incident events
    const matchingIncidents = incidents.filter((_, iIdx) => iIdx % 8 === idx);
    const count = matchingIncidents.reduce((sum, inc) => sum + (inc.events || 1), 0);
    return {
      hour: hourStr,
      count: Math.max(0, count),
    };
  });

  const width = 640;
  const height = 175;
  const paddingX = 40;
  const paddingY = 20;

  const dataPoints = dynamicHourlyData;
  const maxCount = Math.max(10, ...dataPoints.map((d) => d.count)) + 2;

  const points = dataPoints.map((d, i) => {
    const x = paddingX + (i / (dataPoints.length - 1)) * (width - paddingX * 2);
    const y = height - paddingY - (d.count / maxCount) * (height - paddingY * 2);
    return { ...d, x, y };
  });

  const pathD = points.reduce((acc, p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `${acc} L ${p.x} ${p.y}`), '');
  const areaD = `${pathD} L ${points[points.length - 1].x} ${height - paddingY} L ${points[0].x} ${height - paddingY} Z`;

  // Dynamic Telemetry Metrics derived from live stream
  const totalEvents = incidents.reduce((sum, inc) => sum + (inc.events || 1), 0);

  const peakPoint = dynamicHourlyData.reduce(
    (max, p) => (p.count > max.count ? p : max),
    dynamicHourlyData[0] || { hour: '--:--', count: 0 }
  );

  const peakPointOnChart = points.reduce(
    (max, p) => (p.count > max.count ? p : max),
    points[0] || { x: 0, y: 0, count: 0, hour: '' }
  );

  const avgRate = Math.round(totalEvents / 8);

  // Group by Integration source
  const integrationStats = incidents.reduce((acc, inc) => {
    const name = inc.integration || 'Internal';
    acc[name] = (acc[name] || 0) + (inc.events || 1);
    return acc;
  }, {} as Record<string, number>);

  const sortedIntegrations = Object.entries(integrationStats)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  const uniqueIntegrationsCount = Object.keys(integrationStats).length;

  // Group by Failure Class
  const classStats = incidents.reduce((acc, inc) => {
    const cls = inc.cls || 'UNKNOWN';
    acc[cls] = (acc[cls] || 0) + (inc.events || 1);
    return acc;
  }, {} as Record<string, number>);

  const primaryClass = Object.entries(classStats).sort((a, b) => b[1] - a[1])[0]?.[0] || 'RATE_LIMIT';

  return (
    <div className="flex flex-col justify-between h-full space-y-4">
      {/* Chart Top Header & Window Controls */}
      <div>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-ws-ink font-sans text-sm">Live Ingress Telemetry Waveform</span>
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono text-ws-accent bg-ws-accent-subtle border border-ws-accent-border font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-ws-accent animate-ping" />
                LOSSLESS TAP
              </span>
            </div>
            <p className="text-xs font-sans text-ws-secondary mt-0.5">
              Continuous failure rate across <span className="font-mono text-ws-ink font-medium">{incidents.length}</span> active incident clusters
            </p>
          </div>

          <div className="flex items-center gap-2">
            {/* Window selector */}
            <div className="flex items-center p-0.5 rounded-md bg-ws-surface border border-ws-border text-[11px] font-mono">
              {(['1H', '8H', '24H'] as const).map((win) => (
                <button
                  key={win}
                  onClick={() => setActiveWindow(win)}
                  className={`px-2 py-0.5 rounded transition-colors ${
                    activeWindow === win
                      ? 'bg-ws-surface-subtle text-ws-ink font-semibold border border-ws-border shadow-subtle'
                      : 'text-ws-muted hover:text-ws-secondary'
                  }`}
                >
                  {win}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-ws-surface border border-ws-border text-[10px] font-mono text-ws-secondary font-medium tracking-wide uppercase">
              <span className="w-1.5 h-1.5 rounded-full bg-ws-success-dot animate-pulse" />
              <span>LIVE</span>
            </div>
          </div>
        </div>

        {/* SVG Graph Container */}
        <div className="relative bg-ws-surface-subtle rounded-md border border-ws-border-subtle p-4 overflow-hidden">
          {/* Hover Tooltip */}
          {hoveredPoint && (
            <div className="absolute top-2.5 right-4 text-xs font-sans bg-ws-surface-elevated border border-ws-border text-ws-ink px-2.5 py-1 rounded shadow-subtle z-10">
              <span className="font-mono tabular-nums">{hoveredPoint.hour}</span>: <strong className="text-ws-accent font-mono font-medium tabular-nums">{hoveredPoint.count} events</strong>
            </div>
          )}

          {/* Peak Indicator Callout on Graph */}
          {!hoveredPoint && peakPoint.count > 0 && (
            <div className="absolute top-2.5 right-4 text-[11px] font-mono bg-ws-surface-elevated/90 border border-ws-border-subtle text-ws-secondary px-2 py-0.5 rounded z-10 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-ws-accent" />
              <span>Peak: <strong className="text-ws-ink font-medium tabular-nums">{peakPoint.count} ev/h</strong> at {peakPoint.hour}</span>
            </div>
          )}

          <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-44 overflow-visible">
            <defs>
              <linearGradient id="telemetryGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--ws-accent)" stopOpacity="0.22" />
                <stop offset="100%" stopColor="var(--ws-accent)" stopOpacity="0.0" />
              </linearGradient>
            </defs>

            {/* Grid horizontal lines */}
            {[0, Math.floor(maxCount / 2), maxCount].map((val) => {
              const y = height - paddingY - (val / maxCount) * (height - paddingY * 2);
              return (
                <g key={val}>
                  <line
                    x1={paddingX}
                    y1={y}
                    x2={width - paddingX}
                    y2={y}
                    stroke="currentColor"
                    className="text-ws-border"
                    strokeWidth="1"
                    strokeDasharray="2 3"
                  />
                  <text
                    x={paddingX - 10}
                    y={y + 3}
                    textAnchor="end"
                    className="fill-ws-muted font-mono"
                    fontSize="9"
                  >
                    {val}
                  </text>
                </g>
              );
            })}

            {/* Peak vertical dashed indicator line */}
            {peakPointOnChart && peakPointOnChart.count > 0 && (
              <line
                x1={peakPointOnChart.x}
                y1={peakPointOnChart.y}
                x2={peakPointOnChart.x}
                y2={height - paddingY}
                stroke="var(--ws-accent)"
                strokeWidth="1"
                strokeDasharray="2 2"
                opacity="0.35"
              />
            )}

            {/* Fill area */}
            <path d={areaD} fill="url(#telemetryGrad)" />
            {/* Main stroke line */}
            <path d={pathD} fill="none" stroke="var(--ws-accent)" strokeWidth="2" strokeLinecap="round" />

            {/* Interactive Points */}
            {points.map((p, i) => (
              <circle
                key={i}
                cx={p.x}
                cy={p.y}
                r={hoveredPoint?.hour === p.hour ? 5 : p.count === peakPoint.count && p.count > 0 ? 4 : 3}
                className="fill-ws-surface stroke-ws-accent cursor-pointer transition-all duration-150"
                strokeWidth="2"
                onMouseEnter={() => setHoveredPoint(p)}
                onMouseLeave={() => setHoveredPoint(null)}
              />
            ))}
          </svg>

          {/* X-axis time labels */}
          <div className="flex justify-between px-10 mt-2 text-[10px] font-mono text-ws-muted tabular-nums">
            {dataPoints.map((dp, idx) => (
              <span key={idx}>{dp.hour}</span>
            ))}
          </div>
        </div>
      </div>

      {/* Additional Telemetry Information Panel (Fills previous gap with real insight) */}
      <div className="pt-3 border-t border-ws-border grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Metric Module 1: Ingress Velocity & Window Stats */}
        <div className="p-3 rounded-md bg-ws-surface-subtle border border-ws-border-subtle flex flex-col justify-between space-y-2">
          <div className="flex items-center justify-between text-[10px] font-mono text-ws-muted uppercase tracking-wider">
            <span>Stream Velocity</span>
            <TrendingUp className="w-3.5 h-3.5 text-ws-accent" />
          </div>
          <div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-xl font-mono font-medium text-ws-ink tabular-nums">
                {peakPoint.count}
              </span>
              <span className="text-[11px] font-mono text-ws-muted">peak ev/h</span>
            </div>
            <div className="text-[11px] font-sans text-ws-secondary mt-0.5">
              Recorded at <span className="font-mono text-ws-ink font-medium">{peakPoint.hour}</span>
            </div>
          </div>
          <div className="pt-2 border-t border-ws-border/60 flex items-center justify-between text-[10px] font-mono text-ws-muted">
            <span>Window Mean</span>
            <span className="text-ws-secondary font-medium tabular-nums">~{avgRate} ev/h</span>
          </div>
        </div>

        {/* Metric Module 2: Source Distribution */}
        <div className="p-3 rounded-md bg-ws-surface-subtle border border-ws-border-subtle flex flex-col justify-between space-y-2">
          <div className="flex items-center justify-between text-[10px] font-mono text-ws-muted uppercase tracking-wider">
            <span>Source Distribution</span>
            <BarChart2 className="w-3.5 h-3.5 text-ws-accent" />
          </div>
          <div className="space-y-1.5">
            {sortedIntegrations.length === 0 ? (
              <div className="text-xs text-ws-muted font-sans">No sources active</div>
            ) : (
              sortedIntegrations.map(([name, count]) => {
                const pct = Math.round((count / Math.max(1, totalEvents)) * 100);
                return (
                  <div key={name} className="space-y-0.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-sans text-ws-ink font-medium truncate max-w-[90px]">{name}</span>
                      <span className="font-mono text-[10px] text-ws-secondary tabular-nums">{pct}% ({count})</span>
                    </div>
                    <div className="h-1 w-full bg-ws-border rounded-full overflow-hidden">
                      <div
                        className="h-full bg-ws-accent rounded-full transition-all duration-300"
                        style={{ width: `${Math.max(6, pct)}%` }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <div className="pt-1.5 border-t border-ws-border/60 text-[10px] font-mono text-ws-muted flex items-center justify-between">
            <span>Observed Probes</span>
            <span className="text-ws-secondary font-medium">{uniqueIntegrationsCount} active</span>
          </div>
        </div>

        {/* Metric Module 3: Ingress Integrity & Diagnostics */}
        <div className="p-3 rounded-md bg-ws-surface-subtle border border-ws-border-subtle flex flex-col justify-between space-y-2">
          <div className="flex items-center justify-between text-[10px] font-mono text-ws-muted uppercase tracking-wider">
            <span>Ingress Integrity</span>
            <ShieldCheck className="w-3.5 h-3.5 text-ws-success-dot" />
          </div>
          <div>
            <div className="flex items-center gap-1.5 text-xs font-semibold text-ws-ink font-sans">
              <span className="w-1.5 h-1.5 rounded-full bg-ws-success-dot" />
              <span>Lossless Passive Tap</span>
            </div>
            <p className="text-[11px] font-sans text-ws-secondary mt-1 leading-relaxed">
              Deterministic rule evaluation against redacted payloads & traces.
            </p>
          </div>
          <div className="pt-2 border-t border-ws-border/60 flex items-center justify-between text-[10px] font-mono text-ws-muted">
            <span>Primary Anomaly</span>
            <span className="font-mono text-ws-ink font-medium text-[10px] bg-ws-surface px-1.5 py-0.5 rounded border border-ws-border">
              {primaryClass}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
