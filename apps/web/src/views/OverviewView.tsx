import React from 'react';
import type { Incident } from '../types';
import { Badge } from '../components/Badge';
import { Sparkline } from '../components/Sparkline';
import { Zap, CheckCircle2, ArrowRight, Play, Radio, Activity } from 'lucide-react';

interface OverviewViewProps {
  incidents: Incident[];
  onSelectIncident: (id: string) => void;
  onNavigate: (page: string) => void;
}

export const OverviewView: React.FC<OverviewViewProps> = ({
  incidents,
  onSelectIncident,
  onNavigate,
}) => {
  const openCount = incidents.filter((i) => i.status === 'OPEN' || i.status === 'INVESTIGATING').length;
  const criticalCount = incidents.filter((i) => i.severity === 'CRITICAL' || i.severity === 'HIGH').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="text-[10px] font-mono font-semibold tracking-widest text-ws-accent uppercase">
            INTEGRATION OBSERVABILITY
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-ws-ink mt-0.5">Overview</h1>
          <p className="text-xs text-ws-secondary mt-1">
            Real-time ingress flight recorder, passive stream observation, and deterministic classification.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => onNavigate('playground')}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-md bg-ws-btn-primary hover:bg-ws-btn-primary-hover active:bg-ws-btn-primary-active text-ws-btn-primary-ink border border-ws-btn-primary-border text-xs font-semibold shadow-subtle transition-colors"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>Simulate Anomaly</span>
          </button>
        </div>
      </div>

      {/* Telemetry Metric Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Active Anomalies */}
        <div className="p-5 rounded-lg bg-ws-surface border border-ws-border shadow-subtle flex flex-col justify-between space-y-3">
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="text-ws-muted uppercase tracking-wider text-[10px] font-semibold">
              Active Triage Queue
            </span>
            <span className="flex items-center gap-1.5 text-ws-danger-text font-medium text-[10px]">
              <span className="w-1.5 h-1.5 rounded-full bg-ws-danger-dot" />
              ANOMALIES
            </span>
          </div>
          <div className="flex items-baseline gap-2.5">
            <span className="text-2xl font-mono font-bold text-ws-ink tracking-tight tabular-nums">
              0{openCount}
            </span>
            <span className="text-xs font-mono text-ws-danger-text font-medium">
              {criticalCount} critical
            </span>
          </div>
          <div className="text-[11px] text-ws-muted">
            Grouped across 3 connected integration sources
          </div>
        </div>

        {/* Card 2: Failure Activity Meter */}
        <div className="p-5 rounded-lg bg-ws-surface border border-ws-border shadow-subtle flex flex-col justify-between space-y-3">
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="text-ws-muted uppercase tracking-wider text-[10px] font-semibold">
              24H Recorded Failures
            </span>
            <Zap className="w-3.5 h-3.5 text-ws-warning-dot" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-mono font-bold text-ws-ink tracking-tight tabular-nums">
              128
            </span>
            <span className="text-xs font-mono text-ws-muted">
              / 8,000 reqs
            </span>
          </div>
          {/* Progress Mini Bar */}
          <div className="w-full bg-ws-surface-subtle border border-ws-border-subtle rounded-sm h-1.5 overflow-hidden">
            <div className="bg-ws-warning-dot h-full rounded-sm" style={{ width: '16%' }} />
          </div>
        </div>

        {/* Card 3: Ingress Reliability Index */}
        <div className="p-5 rounded-lg bg-ws-surface border border-ws-border shadow-subtle flex flex-col justify-between space-y-3">
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="text-ws-muted uppercase tracking-wider text-[10px] font-semibold">
              Ingress Reliability Index
            </span>
            <CheckCircle2 className="w-3.5 h-3.5 text-ws-success-dot" />
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-mono font-bold text-ws-ink tracking-tight tabular-nums">
              98.4
            </span>
            <span className="text-sm font-mono text-ws-secondary font-semibold">%</span>
          </div>
          <div className="text-[11px] text-ws-success-text font-medium">
            +0.2% above reliability SLA target
          </div>
        </div>

        {/* Card 4: Flight Recorder Status */}
        <div className="p-5 rounded-lg bg-ws-surface border border-ws-border shadow-subtle flex flex-col justify-between space-y-3">
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="text-ws-muted uppercase tracking-wider text-[10px] font-semibold">
              Passive Wire Tap
            </span>
            <Radio className="w-3.5 h-3.5 text-ws-accent" />
          </div>
          <div>
            <div className="text-base font-mono font-bold text-ws-ink">
              0.12ms OVERHEAD
            </div>
            <div className="text-[11px] text-ws-secondary font-mono mt-0.5">
              Paused-mode non-flowing stream tap
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] font-mono text-ws-muted">
            <Activity className="w-3 h-3 text-ws-success-dot" />
            <span>Zero production latency added</span>
          </div>
        </div>
      </div>

      {/* Main Grid: Sparkline Telemetry + Recent Events */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Continuous Sparkline Chart */}
        <div className="lg:col-span-2 p-5 rounded-lg bg-ws-surface border border-ws-border shadow-subtle">
          <Sparkline />
        </div>

        {/* Right 1 Col: Recent Incident Feed */}
        <div className="p-5 rounded-lg bg-ws-surface border border-ws-border shadow-subtle flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-ws-border">
              <div className="text-xs font-bold text-ws-ink uppercase font-mono tracking-wider">
                Recent Telemetry Feed
              </div>
              <button
                onClick={() => onNavigate('incidents')}
                className="text-[11px] text-ws-accent hover:underline font-semibold"
              >
                View all
              </button>
            </div>
            <div className="divide-y divide-ws-border-subtle">
              {incidents.slice(0, 3).map((incident) => (
                <div
                  key={incident.id}
                  onClick={() => onSelectIncident(incident.id)}
                  className="py-3 cursor-pointer group"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-ws-ink group-hover:text-ws-accent transition-colors">
                      {incident.title}
                    </span>
                    <span className="text-[10px] font-mono text-ws-muted">{incident.seen}</span>
                  </div>
                  <div className="text-[11px] text-ws-secondary mt-1 line-clamp-1">
                    {incident.integration} • {incident.events} events recorded
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <Badge severity={incident.severity} />
                    <Badge status={incident.status} withPulse={incident.status === 'INVESTIGATING'} />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="pt-3 border-t border-ws-border text-[10px] font-mono text-ws-muted flex items-center justify-between">
            <span>Deterministic Rules Active</span>
            <span className="flex items-center gap-1.5 text-ws-success-text font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-ws-success-dot" />
              Connected
            </span>
          </div>
        </div>
      </div>

      {/* Active Incidents Quick Table */}
      <div className="rounded-lg bg-ws-surface border border-ws-border shadow-subtle overflow-hidden">
        <div className="p-4 border-b border-ws-border flex items-center justify-between bg-ws-surface-subtle">
          <div>
            <h2 className="text-xs font-bold text-ws-ink uppercase tracking-wider font-mono">
              Active Triage Queue
            </h2>
            <p className="text-[11px] text-ws-muted">Grouped anomalies awaiting engineering review</p>
          </div>
          <button
            onClick={() => onNavigate('incidents')}
            className="inline-flex items-center gap-1.5 text-xs text-ws-accent hover:text-ws-accent-hover font-semibold transition-colors"
          >
            <span>See full triage queue</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-ws-surface-subtle border-b border-ws-border text-[10px] font-mono uppercase text-ws-muted">
              <tr>
                <th className="py-2.5 px-4 font-semibold">Incident</th>
                <th className="py-2.5 px-4 font-semibold">Integration</th>
                <th className="py-2.5 px-4 font-semibold">Failure Class</th>
                <th className="py-2.5 px-4 font-semibold text-center">Events</th>
                <th className="py-2.5 px-4 font-semibold">Severity</th>
                <th className="py-2.5 px-4 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ws-border">
              {incidents.slice(0, 4).map((inc) => (
                <tr
                  key={inc.id}
                  onClick={() => onSelectIncident(inc.id)}
                  className="hover:bg-ws-surface-elevated/60 cursor-pointer transition-colors group"
                >
                  <td className="py-3 px-4">
                    <div className="font-semibold text-ws-ink group-hover:text-ws-accent transition-colors">
                      {inc.title}
                    </div>
                    <div className="text-[10px] font-mono text-ws-muted mt-0.5">{inc.key}</div>
                  </td>
                  <td className="py-3 px-4 text-ws-secondary font-medium">{inc.integration}</td>
                  <td className="py-3 px-4">
                    <span className="font-mono text-[11px] text-ws-ink bg-ws-surface-subtle px-2 py-0.5 rounded border border-ws-border">
                      {inc.cls}
                    </span>
                  </td>
                  <td className="py-3 px-4 font-mono text-center text-ws-ink font-semibold tabular-nums">
                    {inc.events}
                  </td>
                  <td className="py-3 px-4">
                    <Badge severity={inc.severity} />
                  </td>
                  <td className="py-3 px-4">
                    <Badge status={inc.status} withPulse={inc.status === 'INVESTIGATING'} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
