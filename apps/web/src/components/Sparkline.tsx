import React, { useState } from 'react';

interface SparklinePoint {
  hour: string;
  count: number;
}

const SAMPLE_HOURLY_DATA: SparklinePoint[] = [
  { hour: '00:00', count: 4 },
  { hour: '02:00', count: 6 },
  { hour: '04:00', count: 3 },
  { hour: '06:00', count: 8 },
  { hour: '08:00', count: 14 },
  { hour: '10:00', count: 26 },
  { hour: '11:00', count: 42 },
  { hour: '12:00', count: 31 },
  { hour: '14:00', count: 19 },
  { hour: '16:00', count: 12 },
  { hour: '18:00', count: 7 },
  { hour: '20:00', count: 5 },
  { hour: '23:00', count: 3 },
];

export const Sparkline: React.FC = () => {
  const [hoveredPoint, setHoveredPoint] = useState<SparklinePoint | null>(null);

  const width = 640;
  const height = 180;
  const paddingX = 40;
  const paddingY = 20;

  const maxCount = 45;
  const points = SAMPLE_HOURLY_DATA.map((d, i) => {
    const x = paddingX + (i / (SAMPLE_HOURLY_DATA.length - 1)) * (width - paddingX * 2);
    const y = height - paddingY - (d.count / maxCount) * (height - paddingY * 2);
    return { ...d, x, y };
  });

  const pathD = points.reduce((acc, p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `${acc} L ${p.x} ${p.y}`), '');
  const areaD = `${pathD} L ${points[points.length - 1].x} ${height - paddingY} L ${points[0].x} ${height - paddingY} Z`;

  return (
    <div className="relative">
      <div className="flex items-center justify-between mb-3 text-xs">
        <div>
          <span className="font-semibold text-ws-ink">Failure Telemetry Stream</span>
          <p className="text-[11px] text-ws-muted">Recorded failure events by hour across all connected sources</p>
        </div>
        <div className="flex items-center gap-2 text-[11px] font-mono text-ws-secondary font-medium">
          <span className="w-1.5 h-1.5 rounded-full bg-ws-success-dot" />
          <span>PASSIVE STREAM</span>
        </div>
      </div>

      <div className="relative bg-ws-surface-subtle rounded-md border border-ws-border-subtle p-4 overflow-hidden">
        {hoveredPoint && (
          <div className="absolute top-2.5 right-4 text-xs font-mono bg-ws-surface-elevated border border-ws-border text-ws-ink px-2.5 py-1 rounded shadow-subtle">
            {hoveredPoint.hour}: <strong className="text-ws-accent">{hoveredPoint.count} failures</strong>
          </div>
        )}

        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-44 overflow-visible">
          <defs>
            <linearGradient id="telemetryGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--ws-accent)" stopOpacity="0.18" />
              <stop offset="100%" stopColor="var(--ws-accent)" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Grid lines */}
          {[0, 15, 30, 45].map((val) => {
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
                  className="fill-ws-muted"
                  fontSize="9"
                  fontFamily="monospace"
                >
                  {val}
                </text>
              </g>
            );
          })}

          {/* Fill area */}
          <path d={areaD} fill="url(#telemetryGrad)" />

          {/* Trend line */}
          <path
            d={pathD}
            fill="none"
            stroke="var(--ws-accent)"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Data Points */}
          {points.map((p, i) => (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r={p.count === 42 ? 4 : 2.75}
              fill={p.count === 42 ? 'var(--ws-accent)' : 'var(--ws-surface)'}
              stroke="var(--ws-accent)"
              strokeWidth="1.5"
              className="cursor-pointer transition-transform hover:scale-125"
              onMouseEnter={() => setHoveredPoint(p)}
              onMouseLeave={() => setHoveredPoint(null)}
            />
          ))}
        </svg>

        {/* X-axis time labels */}
        <div className="flex justify-between px-10 mt-2 text-[10px] font-mono text-ws-muted">
          <span>00:00</span>
          <span>04:00</span>
          <span>08:00</span>
          <span>12:00</span>
          <span>16:00</span>
          <span>20:00</span>
          <span>23:00</span>
        </div>
      </div>
    </div>
  );
};
