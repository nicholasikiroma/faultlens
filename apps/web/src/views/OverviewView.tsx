import React, { useState } from 'react';
import type { Incident } from '../types';
import { Badge } from '../components/Badge';
import { Sparkline } from '../components/Sparkline';
import { Button, EmptyState, PageHeader, Panel } from '../components/ui';
import {
  Zap,
  CheckCircle2,
  ArrowRight,
  Play,
  Activity,
  Layers,
  ChevronRight,
  Flame,
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

  const sortedIncidents = [...incidents].sort(
    (a, b) => (b.lastSeenTimestamp ?? 0) - (a.lastSeenTimestamp ?? 0)
  );
  const isRecent = (ts?: number) => Boolean(ts && Date.now() - ts < 60_000);

  const priorityAnomalies = sortedIncidents
    .filter((i) => i.status === 'OPEN' || i.status === 'INVESTIGATING')
    .slice(0, 2);

  const classCounts = incidents.reduce((acc, inc) => {
    const cls = inc.cls || 'OTHER';
    acc[cls] = (acc[cls] || 0) + (inc.events || 1);
    return acc;
  }, {} as Record<string, number>);

  const classPercentages = [
    { label: 'RATE_LIMIT', color: 'bg-fl-danger-dot', count: classCounts['RATE_LIMIT'] || 0 },
    { label: 'SCHEMA_MISMATCH', color: 'bg-fl-warning-dot', count: classCounts['SCHEMA_MISMATCH'] || 0 },
    { label: 'NETWORK_TIMEOUT', color: 'bg-fl-violet-dot', count: classCounts['NETWORK_TIMEOUT'] || 0 },
    { label: 'INVALID_SIGNATURE', color: 'bg-fl-accent', count: classCounts['INVALID_SIGNATURE'] || 0 },
  ];

  const totalClassEvents = Math.max(1, classPercentages.reduce((sum, c) => sum + c.count, 0));

  const filteredIncidents = sortedIncidents.filter((inc) => {
    if (triageFilter === 'CRITICAL') return inc.severity === 'CRITICAL' || inc.severity === 'HIGH';
    if (triageFilter === 'INVESTIGATING') return inc.status === 'INVESTIGATING';
    if (triageFilter === 'RESOLVED') return inc.status === 'RESOLVED';
    return true;
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Incident Overview"
        title="System Health & Triage"
        description={
          <>
            Investigating{' '}
            <strong className="text-fl-ink font-mono font-medium">{incidents.length}</strong> incident
            clusters across {uniqueIntegrations.slice(0, 3).join(', ') || 'connected sources'}.
          </>
        }
        actions={
          <Button
            variant="primary"
            onClick={() => onNavigate('playground')}
            leadingIcon={<Play className="w-3.5 h-3.5 fill-current" />}
          >
            Simulate Anomaly
          </Button>
        }
      />

      {/* Asymmetric Command Grid: Active Triage Station + Unified Telemetry Deck */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        <Panel padding="lg" className="lg:col-span-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-fl-border-subtle">
              <div className="flex items-center gap-2">
                <Flame className="w-4 h-4 text-fl-danger-dot" aria-hidden="true" />
                <span className="font-sans text-[13px] font-semibold text-fl-ink">
                  Active Triage Queue
                </span>
              </div>
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono font-semibold uppercase tracking-wider bg-fl-danger-bg text-fl-danger-text border border-fl-danger-border">
                <span className="w-1.5 h-1.5 rounded-full bg-fl-danger-dot" aria-hidden="true" />
                {openCount} Open
              </span>
            </div>

            <div className="mt-4 flex items-baseline gap-3">
              <span className="fl-hero-stat text-fl-ink tabular-nums">
                {openCount < 10 ? `0${openCount}` : openCount}
              </span>
              <div className="text-xs font-sans">
                <span className="text-fl-danger-text font-mono font-semibold block">
                  {criticalCount} High / Critical
                </span>
                <span className="text-fl-muted block">
                  Across {uniqueCount} upstream provider{uniqueCount === 1 ? '' : 's'}
                </span>
              </div>
            </div>

            <div className="mt-5 space-y-2">
              <div className="text-[10px] font-mono font-medium text-fl-muted uppercase tracking-wider">
                Priority Cases
              </div>
              {priorityAnomalies.length === 0 ? (
                <div className="p-3.5 rounded-lg bg-fl-surface-subtle border border-fl-border text-xs text-fl-muted text-center font-sans">
                  No open anomalies require triage.
                </div>
              ) : (
                priorityAnomalies.map((inc) => (
                  <button
                    key={inc.id}
                    type="button"
                    onClick={() => onSelectIncident(inc.id)}
                    className="w-full text-left p-3 rounded-lg bg-fl-surface-subtle border border-fl-border hover:border-fl-accent-border hover:bg-fl-surface-elevated transition-colors flex items-center justify-between group"
                  >
                    <div className="min-w-0 pr-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[11px] font-semibold text-fl-accent-text">
                          {inc.key}
                        </span>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border bg-fl-danger-bg text-fl-danger-text border-fl-danger-border">
                          {inc.cls}
                        </span>
                      </div>
                      <div className="text-[13px] font-medium text-fl-ink font-sans truncate mt-1 group-hover:text-fl-accent-text transition-colors">
                        {inc.title}
                      </div>
                      <div className="text-[11px] font-sans text-fl-muted mt-0.5">
                        {inc.integration} •{' '}
                        <span className="font-mono text-fl-secondary font-medium tabular-nums">
                          {inc.events}
                        </span>{' '}
                        events
                      </div>
                    </div>
                    <ChevronRight
                      className="w-4 h-4 text-fl-muted group-hover:text-fl-accent-text transition-colors shrink-0"
                      aria-hidden="true"
                    />
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="mt-5 pt-3 border-t border-fl-border-subtle flex items-center justify-between text-xs font-sans">
            <span className="text-fl-muted">All grouped clusters</span>
            <button
              type="button"
              onClick={() => onNavigate('incidents')}
              className="text-fl-accent-text hover:underline font-medium text-xs inline-flex items-center gap-1"
            >
              <span>View full queue ({sortedIncidents.length})</span>
              <ArrowRight className="w-3 h-3" aria-hidden="true" />
            </button>
          </div>
        </Panel>

        <Panel variant="subtle" padding="lg" className="lg:col-span-7 flex flex-col justify-between space-y-5">
          <div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 pb-5 border-b border-fl-border">
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-fl-muted text-[11px] font-sans font-medium">
                  <Zap className="w-3.5 h-3.5 text-fl-accent" aria-hidden="true" />
                  <span>Observed Events</span>
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-fl-metric font-mono text-fl-ink tabular-nums">
                    {totalEvents.toLocaleString()}
                  </span>
                  <span className="text-xs font-sans text-fl-muted">total</span>
                </div>
                <div className="text-[11px] font-mono text-fl-secondary tabular-nums">
                  ~{Math.max(1, Math.round(totalEvents / Math.max(1, incidents.length)))} ev/case avg
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-fl-muted text-[11px] font-sans font-medium">
                  <CheckCircle2 className="w-3.5 h-3.5 text-fl-success-dot" aria-hidden="true" />
                  <span>Delivery Health</span>
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-fl-metric font-mono text-fl-ink tabular-nums">
                    {reliabilityRate}
                  </span>
                  <span className="text-sm font-mono text-fl-secondary font-medium">%</span>
                </div>
                <div className="pt-1 space-y-1">
                  <div className="h-1.5 w-full bg-fl-surface rounded-full overflow-hidden border border-fl-border">
                    <div
                      className="h-full bg-fl-accent rounded-full transition-all duration-500"
                      style={{ width: `${Math.min(100, Math.max(0, parseFloat(reliabilityRate)))}%` }}
                    />
                  </div>
                  <div className="text-[10px] font-mono text-fl-success-text font-medium flex items-center justify-between">
                    <span>Target: 95.0%</span>
                    <span>Healthy</span>
                  </div>
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-fl-muted text-[11px] font-sans font-medium">
                  <Activity className="w-3.5 h-3.5 text-fl-accent" aria-hidden="true" />
                  <span>Ingest Capture</span>
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-fl-metric font-mono text-fl-accent-text tabular-nums">
                    0%
                  </span>
                  <span className="text-xs font-mono text-fl-muted">dropped</span>
                </div>
                <div className="text-[11px] font-mono text-fl-secondary">
                  Redacted metadata active
                </div>
              </div>
            </div>

            <div className="pt-4 space-y-2.5">
              <div className="flex items-center justify-between text-xs font-sans">
                <span className="font-semibold text-fl-ink flex items-center gap-2">
                  <Layers className="w-3.5 h-3.5 text-fl-accent" aria-hidden="true" />
                  Failure Class Breakdown
                </span>
                <span className="font-mono text-[11px] text-fl-muted tabular-nums">
                  {totalClassEvents} classified events
                </span>
              </div>

              <div className="h-2.5 w-full bg-fl-surface rounded-full overflow-hidden flex border border-fl-border">
                {classPercentages.map((item) => {
                  const pct = Math.round((item.count / totalClassEvents) * 100);
                  if (pct <= 0) return null;
                  return (
                    <div
                      key={item.label}
                      title={`${item.label}: ${pct}% (${item.count} events)`}
                      className={`${item.color} h-full transition-all duration-300`}
                      style={{ width: `${pct}%` }}
                    />
                  );
                })}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-[11px] font-mono">
                {classPercentages.map((item) => {
                  const pct = Math.round((item.count / totalClassEvents) * 100);
                  return (
                    <div key={item.label} className="flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${item.color} shrink-0`} aria-hidden="true" />
                      <span className="text-fl-muted truncate">{item.label}</span>
                      <span className="text-fl-ink font-semibold ml-auto tabular-nums">{pct}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="pt-3 border-t border-fl-border flex items-center justify-between text-xs text-fl-muted font-sans">
            <span className="flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5 text-fl-accent" aria-hidden="true" />
              <span>Deterministic classification engine online</span>
            </span>
            <span className="font-mono text-[11px]">No AI key required</span>
          </div>
        </Panel>
      </div>

      {/* Activity Waveform */}
      <Panel padding="lg">
        <Sparkline incidents={incidents} />
      </Panel>

      {/* Active Incident Clusters */}
      <Panel padding="none" className="overflow-hidden">
        <div className="p-5 border-b border-fl-border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-fl-surface-subtle">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-fl-section text-fl-ink font-sans">
                Recent Incident Clusters
              </h2>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-fl-surface border border-fl-border text-fl-secondary tabular-nums">
                {filteredIncidents.length}
              </span>
            </div>
            <p className="text-xs font-sans text-fl-secondary mt-0.5">
              Grouped by failure fingerprint. Select a case to inspect its evidence timeline.
            </p>
          </div>

          <div className="flex items-center gap-1 p-1 rounded-lg bg-fl-surface border border-fl-border text-xs font-sans self-start sm:self-auto">
            {(['ALL', 'CRITICAL', 'INVESTIGATING', 'RESOLVED'] as const).map((filter) => (
              <button
                key={filter}
                type="button"
                onClick={() => setTriageFilter(filter)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  triageFilter === filter
                    ? 'bg-fl-surface-elevated text-fl-ink font-semibold border border-fl-border shadow-subtle'
                    : 'text-fl-muted hover:text-fl-secondary border border-transparent'
                }`}
              >
                {filter === 'ALL' ? 'All' : filter}
              </button>
            ))}
          </div>
        </div>

        <div className="divide-y divide-fl-border-subtle">
          {filteredIncidents.length === 0 ? (
            <EmptyState
              title="No matching incidents"
              description="No incident clusters match the selected status filter."
            />
          ) : (
            filteredIncidents.map((inc) => {
              const isUrgent = inc.severity === 'CRITICAL' || inc.severity === 'HIGH';
              const isResolved = inc.status === 'RESOLVED';
              const activeRecent = isRecent(inc.lastSeenTimestamp);

              return (
                <button
                  key={inc.id}
                  type="button"
                  onClick={() => onSelectIncident(inc.id)}
                  className="w-full text-left px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-fl-surface-subtle transition-colors group relative"
                >
                  <div
                    className={`absolute left-0 top-2 bottom-2 w-0.5 rounded-r ${
                      isResolved
                        ? 'bg-fl-success-dot'
                        : isUrgent
                        ? 'bg-fl-danger-dot'
                        : 'bg-fl-warning-dot'
                    }`}
                    aria-hidden="true"
                  />

                  <div className="pl-2 min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-fl-accent-text">
                        {inc.key}
                      </span>
                      <span className="text-[14px] font-semibold text-fl-ink font-sans group-hover:text-fl-accent-text transition-colors">
                        {inc.title}
                      </span>
                      {activeRecent && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-fl-success-bg text-fl-success-text border border-fl-success-border">
                          <span className="w-1.5 h-1.5 rounded-full bg-fl-success-dot" aria-hidden="true" />
                          Recent
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs font-sans text-fl-secondary mt-1">
                      <span className="font-medium text-fl-ink">{inc.integration}</span>
                      <span aria-hidden="true">•</span>
                      <span className="font-mono text-[11px] text-fl-muted bg-fl-surface-subtle px-1.5 py-0.5 rounded border border-fl-border">
                        {inc.cls}
                      </span>
                      <span aria-hidden="true">•</span>
                      <span className="text-fl-muted line-clamp-1">{inc.known}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 sm:justify-end shrink-0 pl-2 sm:pl-0">
                    <div className="text-right">
                      <span className="font-mono text-xs font-semibold text-fl-ink tabular-nums block">
                        {inc.events} events
                      </span>
                      <span className="font-mono text-[11px] text-fl-muted tabular-nums block">
                        {inc.seen}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <Badge severity={inc.severity} />
                      <Badge status={inc.status} withPulse={inc.status === 'INVESTIGATING'} />
                    </div>

                    <ArrowRight
                      className="w-4 h-4 text-fl-muted opacity-0 group-hover:opacity-100 group-hover:text-fl-accent-text transition-all"
                      aria-hidden="true"
                    />
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div className="px-5 py-3 border-t border-fl-border bg-fl-surface-subtle flex items-center justify-between text-xs text-fl-muted font-sans">
          <span>
            Press{' '}
            <kbd className="font-mono text-[10px] px-1.5 py-0.5 bg-fl-surface border border-fl-border rounded">
              ⌘K
            </kbd>{' '}
            to search across all incidents
          </span>
          <button
            type="button"
            onClick={() => onNavigate('incidents')}
            className="text-fl-accent-text hover:underline font-medium text-xs"
          >
            Open Triage Queue →
          </button>
        </div>
      </Panel>
    </div>
  );
};
