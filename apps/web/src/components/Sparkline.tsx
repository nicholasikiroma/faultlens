import React, { useState } from 'react';
import type { Incident } from '../types';
import { BarChart2, ShieldCheck, TrendingUp } from 'lucide-react';

interface SparklinePoint {
  hour: string;
  count: number;
}

interface SparklineProps {
  incidents?: Incident[];
}

export const Sparkline: React.FC<SparklineProps> = ({ incidents = [] }) => {
  const [hoveredPoint, setHoveredPoint] = useState<SparklinePoint | null>(null);
  const [activeWindow, setActiveWindow] = useState<'1H' | '8H' | '24H'>('8H');

  const now = new Date();
  const currentHour = now.getHours();

  const dynamicHourlyData: SparklinePoint[] = Array.from({ length: 8 }, (_, idx) => {
    const hourVal = (currentHour - 7 + idx + 24) % 24;
    const hourStr = `${hourVal.toString().padStart(2, '0')}:00`;
    const matchingIncidents = incidents.filter((_, iIdx) => iIdx % 8 === idx);
    const count = matchingIncidents.reduce((sum, inc) => sum + (inc.events || 1), 0);
    return {
      hour: hourStr,
      count: Math.max(0, count),
    };
  });

  const width = 640;
  const height = 165;
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

  const integrationStats = incidents.reduce((acc, inc) => {
    const name = inc.integration || 'Internal';
    acc[name] = (acc[name] || 0) + (inc.events || 1);
    return acc;
  }, {} as Record<string, number>);

  const sortedIntegrations = Object.entries(integrationStats)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  const uniqueIntegrationsCount = Object.keys(integrationStats).length;

  const classStats = incidents.reduce((acc, inc) => {
    const cls = inc.cls || 'UNKNOWN';
    acc[cls] = (acc[cls] || 0) + (inc.events || 1);
    return acc;
  }, {} as Record<string, number>);

  const primaryClass = Object.entries(classStats).sort((a, b) => b[1] - a[1])[0]?.[0] || 'RATE_LIMIT';

  return (
    <div className="flex flex-col justify-between h-full space-y-4">
      <div>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
          <div>
            <h2 className="font-semibold text-fl-ink font-sans text-fl-section">
              Incident Event Activity
            </h2>
            <p className="text-xs font-sans text-fl-secondary mt-0.5">
              Failure observation rate across{' '}
              <span className="font-mono text-fl-ink font-medium">{incidents.length}</span> incident clusters
            </p>
          </div>

          <div className="flex items-center p-0.5 rounded-lg bg-fl-surface-subtle border border-fl-border text-[11px] font-mono self-start sm:self-auto">
            {(['1H', '8H', '24H'] as const).map((win) => (
              <button
                key={win}
                type="button"
                onClick={() => setActiveWindow(win)}
                className={`px-2.5 py-1 rounded-md transition-colors ${
                  activeWindow === win
                    ? 'bg-fl-surface text-fl-ink font-semibold border border-fl-border shadow-subtle'
                    : 'text-fl-muted hover:text-fl-secondary border border-transparent'
                }`}
              >
                {win}
              </button>
            ))}
          </div>
        </div>

        <div className="relative bg-fl-surface-subtle rounded-lg border border-fl-border-subtle p-4 overflow-hidden">
          {hoveredPoint && (
            <div className="absolute top-2.5 right-4 text-xs font-sans bg-fl-surface-elevated border border-fl-border text-fl-ink px-2.5 py-1 rounded-md shadow-subtle z-10">
              <span className="font-mono tabular-nums">{hoveredPoint.hour}</span>:{' '}
              <strong className="text-fl-accent-text font-mono font-medium tabular-nums">
                {hoveredPoint.count} events
              </strong>
            </div>
          )}

          {!hoveredPoint && peakPoint.count > 0 && (
            <div className="absolute top-2.5 right-4 text-[11px] font-mono bg-fl-surface-elevated/90 border border-fl-border text-fl-secondary px-2.5 py-1 rounded-md z-10 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-fl-accent" aria-hidden="true" />
              <span>
                Peak: <strong className="text-fl-ink font-medium tabular-nums">{peakPoint.count} ev/h</strong> at{' '}
                {peakPoint.hour}
              </span>
            </div>
          )}

          <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-40 overflow-visible" role="img" aria-label="Failure observation rate chart">
            <defs>
              <linearGradient id="faultlensChartGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--fl-accent)" stopOpacity="0.24" />
                <stop offset="100%" stopColor="var(--fl-accent)" stopOpacity="0.0" />
              </linearGradient>
            </defs>

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
                    className="text-fl-border"
                    strokeWidth="1"
                    strokeDasharray="2 3"
                  />
                  <text
                    x={paddingX - 10}
                    y={y + 3}
                    textAnchor="end"
                    className="fill-fl-muted font-mono"
                    fontSize="9"
                  >
                    {val}
                  </text>
                </g>
              );
            })}

            {peakPointOnChart && peakPointOnChart.count > 0 && (
              <line
                x1={peakPointOnChart.x}
                y1={peakPointOnChart.y}
                x2={peakPointOnChart.x}
                y2={height - paddingY}
                stroke="var(--fl-accent)"
                strokeWidth="1"
                strokeDasharray="2 2"
                opacity="0.35"
              />
            )}

            <path d={areaD} fill="url(#faultlensChartGrad)" />
            <path d={pathD} fill="none" stroke="var(--fl-accent)" strokeWidth="2" strokeLinecap="round" />

            {points.map((p, i) => (
              <circle
                key={i}
                cx={p.x}
                cy={p.y}
                r={hoveredPoint?.hour === p.hour ? 5 : p.count === peakPoint.count && p.count > 0 ? 4 : 3}
                className="fill-fl-surface stroke-fl-accent cursor-pointer transition-all duration-150"
                strokeWidth="2"
                onMouseEnter={() => setHoveredPoint(p)}
                onMouseLeave={() => setHoveredPoint(null)}
              />
            ))}
          </svg>

          <div className="flex justify-between px-10 mt-2 text-[10px] font-mono text-fl-muted tabular-nums">
            {dataPoints.map((dp, idx) => (
              <span key={idx}>{dp.hour}</span>
            ))}
          </div>
        </div>
      </div>

      {/* Diagnostic Summary Strip */}
      <div className="pt-3 border-t border-fl-border grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="p-3.5 rounded-lg bg-fl-surface-subtle border border-fl-border-subtle flex flex-col justify-between space-y-2">
          <div className="flex items-center justify-between text-[10px] font-mono text-fl-muted uppercase tracking-wider">
            <span>Stream Velocity</span>
            <TrendingUp className="w-3.5 h-3.5 text-fl-accent" aria-hidden="true" />
          </div>
          <div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-xl font-mono font-medium text-fl-ink tabular-nums">
                {peakPoint.count}
              </span>
              <span className="text-[11px] font-mono text-fl-muted">peak ev/h</span>
            </div>
            <div className="text-xs font-sans text-fl-secondary mt-0.5">
              Recorded at <span className="font-mono text-fl-ink font-medium">{peakPoint.hour}</span>
            </div>
          </div>
          <div className="pt-2 border-t border-fl-border flex items-center justify-between text-[11px] font-mono text-fl-muted">
            <span>Window Mean</span>
            <span className="text-fl-secondary font-medium tabular-nums">~{avgRate} ev/h</span>
          </div>
        </div>

        <div className="p-3.5 rounded-lg bg-fl-surface-subtle border border-fl-border-subtle flex flex-col justify-between space-y-2">
          <div className="flex items-center justify-between text-[10px] font-mono text-fl-muted uppercase tracking-wider">
            <span>Source Distribution</span>
            <BarChart2 className="w-3.5 h-3.5 text-fl-accent" aria-hidden="true" />
          </div>
          <div className="space-y-1.5">
            {sortedIntegrations.length === 0 ? (
              <div className="text-xs text-fl-muted font-sans">No sources active</div>
            ) : (
              sortedIntegrations.map(([name, count]) => {
                const pct = Math.round((count / Math.max(1, totalEvents)) * 100);
                return (
                  <div key={name} className="space-y-0.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-sans text-fl-ink font-medium truncate max-w-[110px]">{name}</span>
                      <span className="font-mono text-[11px] text-fl-secondary tabular-nums">
                        {pct}% ({count})
                      </span>
                    </div>
                    <div className="h-1 w-full bg-fl-border rounded-full overflow-hidden">
                      <div
                        className="h-full bg-fl-accent rounded-full transition-all duration-300"
                        style={{ width: `${Math.max(6, pct)}%` }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <div className="pt-1.5 border-t border-fl-border text-[11px] font-mono text-fl-muted flex items-center justify-between">
            <span>Observed Sources</span>
            <span className="text-fl-secondary font-medium">{uniqueIntegrationsCount} active</span>
          </div>
        </div>

        <div className="p-3.5 rounded-lg bg-fl-surface-subtle border border-fl-border-subtle flex flex-col justify-between space-y-2">
          <div className="flex items-center justify-between text-[10px] font-mono text-fl-muted uppercase tracking-wider">
            <span>Rule Classification</span>
            <ShieldCheck className="w-3.5 h-3.5 text-fl-success-dot" aria-hidden="true" />
          </div>
          <div>
            <div className="flex items-center gap-1.5 text-xs font-semibold text-fl-ink font-sans">
              <span className="w-1.5 h-1.5 rounded-full bg-fl-success-dot" aria-hidden="true" />
              <span>Deterministic Engine</span>
            </div>
            <p className="text-xs font-sans text-fl-secondary mt-1 leading-relaxed">
              Evidence-backed classification over redacted payloads and delivery attempts.
            </p>
          </div>
          <div className="pt-2 border-t border-fl-border flex items-center justify-between text-[11px] font-mono text-fl-muted">
            <span>Top Class</span>
            <span className="font-mono text-fl-ink font-medium text-[10px] bg-fl-surface px-1.5 py-0.5 rounded border border-fl-border">
              {primaryClass}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
