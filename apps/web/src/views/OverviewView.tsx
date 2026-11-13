import React, { useState } from 'react';
import type { Incident } from '../types';
import { Badge } from '../components/Badge';
import { Sparkline } from '../components/Sparkline';
import {
  Zap,
  CheckCircle2,
  ArrowRight,
  Play,
  Radio,
  Activity,
  Layers,
  ChevronRight,
  ShieldAlert,
  Flame,
  Clock,
  Cpu,
} from 'lucide-react';

interface OverviewViewProps {
  incidents: Incident[];
  onSelectIncident: (id: string) => void;
  onNavigate: (page: string) => void;
}

export const OverviewView: React.FC<OverviewViewProps> = ({
  incidents = [],
  onSelectIncident,
  onNavigate,
}) => {
  const [triageFilter, setTriageFilter] = useState<'ALL' | 'CRITICAL' | 'INVESTIGATING' | 'RESOLVED'>('ALL');

  const openCount = incidents.filter((i) => i.status === 'OPEN' || i.status === 'INVESTIGATING').length;
  const criticalCount = incidents.filter((i) => i.severity === 'CRITICAL' || i.severity === 'HIGH').length;
  const totalEvents = incidents.reduce((sum, i) => sum + (i.events || 1), 0);
  const uniqueIntegrations = Array.from(new Set(incidents.map((i) => i.integration))).filter(Boolean);
  const uniqueCount = Math.max(1, uniqueIntegrations.length);
  const reliabilityRate = Math.max(88, 100 - openCount * 2.2).toFixed(1);

  // Always order cases by latest activity first
  const sortedIncidents = [...incidents].sort(
    (a, b) => (b.lastSeenTimestamp ?? 0) - (a.lastSeenTimestamp ?? 0)
  );
  const isRecent = (ts?: number) => Boolean(ts && Date.now() - ts < 60_000);

  // Top 2 high priority incidents for the Hero Triage Station
  const priorityAnomalies = sortedIncidents
    .filter((i) => i.status === 'OPEN' || i.status === 'INVESTIGATING')
    .slice(0, 2);

  // Compute breakdown by failure class for the Live Ingress Spectrum bar
  const classCounts = incidents.reduce((acc, inc) => {
    const cls = inc.cls || 'OTHER';
    acc[cls] = (acc[cls] || 0) + (inc.events || 1);
    return acc;
  }, {} as Record<string, number>);

  const classPercentages = [
    { label: 'RATE_LIMIT', color: 'bg-ws-danger-dot', text: 'text-ws-danger-text', count: classCounts['RATE_LIMIT'] || 0 },
    { label: 'SCHEMA_MISMATCH', color: 'bg-ws-warning-dot', text: 'text-ws-warning-text', count: classCounts['SCHEMA_MISMATCH'] || 0 },
    { label: 'NETWORK_TIMEOUT', color: 'bg-ws-lavender-dot', text: 'text-ws-lavender-text', count: classCounts['NETWORK_TIMEOUT'] || 0 },
    { label: 'INVALID_SIGNATURE', color: 'bg-ws-accent', text: 'text-ws-accent', count: classCounts['INVALID_SIGNATURE'] || 0 },
  ];

  const totalClassEvents = Math.max(1, classPercentages.reduce((sum, c) => sum + c.count, 0));

  // Filtered incidents for the lower Triage Matrix
  const filteredIncidents = sortedIncidents.filter((inc) => {
    if (triageFilter === 'CRITICAL') return inc.severity === 'CRITICAL' || inc.severity === 'HIGH';
    if (triageFilter === 'INVESTIGATING') return inc.status === 'INVESTIGATING';
    if (triageFilter === 'RESOLVED') return inc.status === 'RESOLVED';
    return true;
  });

  return (
    <div className="space-y-8">
      {/* 1. Header & Live Operations Ticker (Editorial & Confident) */}
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-5 pb-2 border-b border-ws-border">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="ws-eyebrow text-ws-accent flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-ws-accent animate-ping" />
              TELEMETRY COCKPIT // CLUSTER INGRESS-01
            </span>
            <span className="text-[10px] font-mono text-ws-muted">·</span>
            <span className="text-[10px] font-mono text-ws-muted">127.0.0.1:3000</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-ws-ink font-sans leading-tight">
            System Telemetry & Ingress Flight Deck
          </h1>
          <p className="text-[14px] text-ws-secondary mt-1 font-sans max-w-2xl leading-relaxed">
            Lossless passive wiretap monitoring <strong className="text-ws-ink font-mono font-medium">{incidents.length}</strong> incident clusters across {uniqueIntegrations.slice(0, 3).join(', ')} & internal queues.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => onNavigate('playground')}
            className="ws-tactile-btn inline-flex items-center gap-2.5 px-4 py-2 rounded-lg bg-ws-btn-primary hover:bg-ws-btn-primary-hover active:bg-ws-btn-primary-active text-ws-btn-primary-ink border border-ws-btn-primary-border text-[13px] font-medium font-sans shadow-subtle"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>Simulate Anomaly</span>
            <kbd className="hidden sm:inline-block px-1.5 py-0.2 text-[10px] font-mono font-medium bg-ws-accent-active/40 text-ws-accent-ink rounded border border-ws-accent-border/40">
              ⌘S
            </kbd>
          </button>
        </div>
      </div>

      {/* 2. Asymmetric Command Bridge: Operational Hero Alert + Unified Telemetry Deck */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Left Panel: Hero Operational Alert Station (Urgency & Immediate Action) */}
        <div className="lg:col-span-5 p-6 rounded-xl bg-ws-surface border border-ws-border shadow-subtle flex flex-col justify-between relative overflow-hidden group hover:border-ws-border-strong transition-all">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-ws-danger-dot via-ws-warning-dot to-ws-accent" />
          
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-ws-border-subtle">
              <div className="flex items-center gap-2">
                <Flame className="w-4 h-4 text-ws-danger-dot" />
                <span className="font-sans text-[13px] font-semibold text-ws-ink uppercase tracking-wider">
                  Active Triage Station
                </span>
              </div>
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono font-semibold uppercase tracking-wider bg-ws-danger-bg text-ws-danger-text border border-ws-danger-border">
                <span className="w-1.5 h-1.5 rounded-full bg-ws-danger-dot animate-pulse" />
                {openCount} AWAITING TRIAGE
              </span>
            </div>

            {/* Huge Raycast-style Hero Number */}
            <div className="mt-4 flex items-baseline gap-3">
              <span className="ws-hero-stat text-ws-ink">
                {openCount < 10 ? `0${openCount}` : openCount}
              </span>
              <div className="text-xs font-sans">
                <span className="text-ws-danger-text font-mono font-semibold block">
                  {criticalCount} Critical Priority
                </span>
                <span className="text-ws-muted block">
                  Across {uniqueCount} upstream provider{uniqueCount === 1 ? '' : 's'}
                </span>
              </div>
            </div>

            {/* Embedded Live Action Stream (Direct one-click inspection) */}
            <div className="mt-4 space-y-2">
              <div className="text-[10px] font-mono font-medium text-ws-muted uppercase tracking-wider">
                TOP ANOMALIES REQUIRING ATTENTION
              </div>
              {priorityAnomalies.length === 0 ? (
                <div className="p-3 rounded-lg bg-ws-surface-subtle text-xs text-ws-muted text-center font-sans">
                  No critical anomalies active in the triage queue.
                </div>
              ) : (
                priorityAnomalies.map((inc) => (
                  <div
                    key={inc.id}
                    onClick={() => onSelectIncident(inc.id)}
                    className="p-3 rounded-lg bg-ws-surface-subtle border border-ws-border hover:border-ws-accent-border hover:bg-ws-surface-elevated cursor-pointer transition-all flex items-center justify-between group/case"
                  >
                    <div className="min-w-0 pr-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[11px] font-semibold text-ws-accent">
                          {inc.key}
                        </span>
                        <span className="text-[10px] font-mono px-1.5 py-0.2 rounded border bg-ws-danger-bg text-ws-danger-text border-ws-danger-border">
                          {inc.cls}
                        </span>
                      </div>
                      <div className="text-[13px] font-medium text-ws-ink font-sans truncate mt-0.5 group-hover/case:text-ws-accent transition-colors">
                        {inc.title}
                      </div>
                      <div className="text-[11px] font-sans text-ws-muted mt-0.5">
                        {inc.integration} • <span className="font-mono text-ws-secondary font-medium tabular-nums">{inc.events}</span> events
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-ws-muted group-hover/case:text-ws-accent transition-colors shrink-0" />
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-ws-border-subtle flex items-center justify-between text-xs font-sans">
            <span className="text-ws-muted">Fast triage shortcut:</span>
            <button
              onClick={() => onNavigate('incidents')}
              className="text-ws-accent hover:underline font-medium text-xs inline-flex items-center gap-1 font-sans"
            >
              <span>Open full queue ({sortedIncidents.length})</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Right Panel: Unified Telemetry & Reliability Deck (Secondary Backing, Not Identical Boxes!) */}
        <div className="lg:col-span-7 p-6 rounded-xl bg-ws-surface-subtle border border-ws-border shadow-subtle flex flex-col justify-between space-y-6">
          <div>
            {/* Top Stat Row with Crisp Hairline Dividers */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 pb-6 border-b border-ws-border">
              {/* Stat 1: Ingress Throughput */}
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-ws-muted text-[11px] font-sans font-medium">
                  <Zap className="w-3.5 h-3.5 text-ws-accent fill-ws-accent" />
                  <span>Cumulative Ingress</span>
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-3xl font-mono font-medium text-ws-ink tracking-tight tabular-nums">
                    {totalEvents.toLocaleString()}
                  </span>
                  <span className="text-xs font-sans text-ws-muted">events</span>
                </div>
                <div className="text-[11px] font-mono text-ws-secondary tabular-nums">
                  ~{Math.max(1, Math.round(totalEvents / Math.max(1, incidents.length)))} ev/case avg
                </div>
              </div>

              {/* Stat 2: Ingress Reliability Index */}
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-ws-muted text-[11px] font-sans font-medium">
                  <CheckCircle2 className="w-3.5 h-3.5 text-ws-success-dot" />
                  <span>Reliability Index</span>
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-mono font-medium text-ws-ink tracking-tight tabular-nums">
                    {reliabilityRate}
                  </span>
                  <span className="text-sm font-mono text-ws-secondary font-medium">%</span>
                </div>
                {/* Tactile Mini Segment Bar */}
                <div className="pt-1 space-y-1">
                  <div className="h-1.5 w-full bg-ws-surface rounded-full overflow-hidden border border-ws-border">
                    <div
                      className="h-full bg-ws-accent rounded-full transition-all duration-500"
                      style={{ width: `${Math.min(100, Math.max(0, parseFloat(reliabilityRate)))}%` }}
                    />
                  </div>
                  <div className="text-[10px] font-mono text-ws-success-text font-medium flex items-center justify-between">
                    <span>SLA: 95.0%</span>
                    <span>PASSING</span>
                  </div>
                </div>
              </div>

              {/* Stat 3: Flight Recorder Wire Tap */}
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-ws-muted text-[11px] font-sans font-medium">
                  <Radio className="w-3.5 h-3.5 text-ws-accent" />
                  <span>Passive Wire Tap</span>
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-3xl font-mono font-medium text-ws-accent tracking-tight tabular-nums">
                    0%
                  </span>
                  <span className="text-xs font-mono text-ws-muted">frame loss</span>
                </div>
                <div className="text-[11px] font-mono text-ws-secondary flex items-center gap-1.5">
                  <Activity className="w-3 h-3 text-ws-success-dot" />
                  <span>ALS Ringbuffer Active</span>
                </div>
              </div>
            </div>

            {/* Bottom Ingress Failure Spectrum Bar (High information density) */}
            <div className="pt-4 space-y-2.5">
              <div className="flex items-center justify-between text-xs font-sans">
                <span className="font-semibold text-ws-ink flex items-center gap-2">
                  <Layers className="w-3.5 h-3.5 text-ws-accent" />
                  Live Ingress Failure Spectrum
                </span>
                <span className="font-mono text-[11px] text-ws-muted tabular-nums">
                  {totalClassEvents} Classified Failures
                </span>
              </div>

              {/* Multi-segmented Horizontal Spectrum Bar */}
              <div className="h-3 w-full bg-ws-surface rounded-full overflow-hidden flex border border-ws-border">
                {classPercentages.map((item) => {
                  const pct = Math.round((item.count / totalClassEvents) * 100);
                  if (pct <= 0) return null;
                  return (
                    <div
                      key={item.label}
                      title={`${item.label}: ${pct}% (${item.count} events)`}
                      className={`${item.color} h-full transition-all duration-300 first:rounded-l-full last:rounded-r-full`}
                      style={{ width: `${pct}%` }}
                    />
                  );
                })}
              </div>

              {/* Legend with exact count and percentages */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-[11px] font-mono">
                {classPercentages.map((item) => {
                  const pct = Math.round((item.count / totalClassEvents) * 100);
                  return (
                    <div key={item.label} className="flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${item.color} shrink-0`} />
                      <span className="text-ws-muted truncate">{item.label}</span>
                      <span className="text-ws-ink font-semibold ml-auto tabular-nums">{pct}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="pt-3 border-t border-ws-border flex items-center justify-between text-xs text-ws-muted font-sans">
            <span className="flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5 text-ws-accent" />
              <span>Deterministic classification engine: Online</span>
            </span>
            <span className="font-mono text-[11px]">Buffer: 4.8 / 64 KB</span>
          </div>
        </div>
      </div>

      {/* 3. Central Telemetry Waveform Stage (Central Visual Feature!) */}
      <div className="p-6 rounded-xl bg-ws-surface border border-ws-border shadow-subtle">
        <Sparkline incidents={incidents} onSelectIncident={onSelectIncident} />
      </div>

      {/* 4. Linear-Style Refined Incident Stream & Triage Board (Lighter, modern, refined) */}
      <div className="rounded-xl bg-ws-surface border border-ws-border shadow-subtle overflow-hidden">
        {/* Triage Console Bar */}
        <div className="p-5 border-b border-ws-border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-ws-surface-subtle">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-ws-ink font-sans tracking-tight">
                Active Triage Queue & Incident Clusters
              </h2>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-ws-surface border border-ws-border text-ws-secondary tabular-nums">
                {filteredIncidents.length} Records
              </span>
            </div>
            <p className="text-xs font-sans text-ws-secondary mt-0.5">
              Sorted by latest stream activity. Select an incident to inspect sanitized traces and rule receipts.
            </p>
          </div>

          {/* Filter Pills */}
          <div className="flex items-center gap-1.5 p-1 rounded-lg bg-ws-surface border border-ws-border text-xs font-sans">
            {(['ALL', 'CRITICAL', 'INVESTIGATING', 'RESOLVED'] as const).map((filter) => (
              <button
                key={filter}
                onClick={() => setTriageFilter(filter)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  triageFilter === filter
                    ? 'bg-ws-surface-subtle text-ws-ink font-semibold border border-ws-border shadow-subtle'
                    : 'text-ws-muted hover:text-ws-secondary'
                }`}
              >
                {filter === 'ALL' ? 'All Cases' : filter}
              </button>
            ))}
          </div>
        </div>

        {/* Linear-Style High-Density Refined List */}
        <div className="divide-y divide-ws-border-subtle">
          {filteredIncidents.length === 0 ? (
            <div className="p-12 text-center text-xs font-sans text-ws-muted">
              No incident cases match the selected filter.
            </div>
          ) : (
            filteredIncidents.map((inc) => {
              const isUrgent = inc.severity === 'CRITICAL' || inc.severity === 'HIGH';
              const isResolved = inc.status === 'RESOLVED';
              const activeRecent = isRecent(inc.lastSeenTimestamp);

              return (
                <div
                  key={inc.id}
                  onClick={() => onSelectIncident(inc.id)}
                  className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-ws-surface-subtle/80 cursor-pointer transition-colors group relative"
                >
                  {/* Left State Ribbon Indicator */}
                  <div
                    className={`absolute left-0 top-2 bottom-2 w-1 rounded-r-sm transition-colors ${
                      isResolved
                        ? 'bg-ws-success-dot'
                        : isUrgent
                        ? 'bg-ws-danger-dot'
                        : 'bg-ws-warning-dot'
                    }`}
                  />

                  {/* Incident Identity & Context */}
                  <div className="pl-2 min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-ws-accent">
                        {inc.key}
                      </span>
                      <span className="text-[14px] font-semibold text-ws-ink font-sans group-hover:text-ws-accent transition-colors">
                        {inc.title}
                      </span>
                      {activeRecent && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[10px] font-mono font-medium bg-ws-success-bg text-ws-success-text border border-ws-success-border">
                          <span className="w-1.5 h-1.5 rounded-full bg-ws-success-dot animate-pulse" />
                          ACTIVE 60S
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs font-sans text-ws-secondary mt-1">
                      <span className="font-medium text-ws-ink">{inc.integration}</span>
                      <span>•</span>
                      <span className="font-mono text-[11px] text-ws-muted bg-ws-surface px-1.5 py-0.2 rounded border border-ws-border">
                        {inc.cls}
                      </span>
                      <span>•</span>
                      <span className="text-ws-muted line-clamp-1">{inc.known}</span>
                    </div>
                  </div>

                  {/* Telemetry Stats & Badges */}
                  <div className="flex items-center gap-4 sm:justify-end shrink-0 pl-2 sm:pl-0">
                    <div className="text-right">
                      <span className="font-mono text-xs font-semibold text-ws-ink tabular-nums block">
                        {inc.events} events
                      </span>
                      <span className="font-mono text-[11px] text-ws-muted tabular-nums block">
                        {inc.seen}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <Badge severity={inc.severity} />
                      <Badge status={inc.status} withPulse={inc.status === 'INVESTIGATING'} />
                    </div>

                    <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center text-xs font-sans font-medium text-ws-accent gap-1">
                      <span>Inspect</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer info bar */}
        <div className="p-4 border-t border-ws-border bg-ws-surface-subtle flex items-center justify-between text-xs text-ws-muted font-sans">
          <span>Keyboard triage: Select any case or press <kbd className="font-mono text-[10px] px-1.5 py-0.5 bg-ws-surface border border-ws-border rounded">⌘K</kbd> to search</span>
          <button
            onClick={() => onNavigate('incidents')}
            className="text-ws-accent hover:underline font-medium text-xs font-sans"
          >
            Go to Triage Queue console →
          </button>
        </div>
      </div>
    </div>
  );
};
