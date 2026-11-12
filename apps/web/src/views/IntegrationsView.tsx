import React from 'react';
import type { IntegrationItem } from '../types';
import { Plug, Zap, Plus, ExternalLink, Activity } from 'lucide-react';

interface IntegrationsViewProps {
  integrations: IntegrationItem[];
  onInspectIntegration: (integrationName: string) => void;
  onShowToast: (msg: string) => void;
}

export const IntegrationsView: React.FC<IntegrationsViewProps> = ({
  integrations,
  onInspectIntegration,
  onShowToast,
}) => {
  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="text-[10px] font-mono font-semibold tracking-widest text-ws-accent uppercase">
            CONNECTED SOURCES
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-ws-ink mt-0.5">Integrations</h1>
          <p className="text-xs text-ws-secondary mt-1">
            Observed webhook providers, message queues, and upstream HTTP microservices.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() =>
              onShowToast('To connect an integration, mount the @wiresleuth/sdk middleware in your HTTP handler.')
            }
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-md bg-ws-btn-primary hover:bg-ws-btn-primary-hover active:bg-ws-btn-primary-active text-ws-btn-primary-ink border border-ws-btn-primary-border text-xs font-semibold shadow-subtle transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Connect New Source</span>
          </button>
        </div>
      </div>

      {/* Grid of Integration Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {integrations.map((int) => (
          <div
            key={int.id}
            className="p-5 rounded-lg bg-ws-surface border border-ws-border shadow-subtle flex flex-col justify-between space-y-4 hover:border-ws-border-strong transition-colors"
          >
            <div>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-md bg-ws-surface-subtle border border-ws-border text-ws-accent">
                    <Plug className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-ws-ink">{int.name}</h3>
                    <p className="text-xs text-ws-muted">{int.type}</p>
                  </div>
                </div>
              </div>

              {/* Status Badge */}
              <div className="mt-4">
                <span
                  className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono font-semibold uppercase ${
                    int.status === 'HEALTHY'
                      ? 'bg-ws-success-bg text-ws-success-text border border-ws-success-border'
                      : 'bg-ws-warning-bg text-ws-warning-text border border-ws-warning-border'
                  }`}
                >
                  <Activity className="w-3 h-3" />
                  {int.status}
                </span>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-2 gap-3 mt-4 pt-4 border-t border-ws-border text-xs">
                <div>
                  <span className="text-[10px] font-mono text-ws-muted uppercase block">
                    Failed Attempts
                  </span>
                  <span className="text-lg font-mono font-bold text-ws-ink tabular-nums">
                    {int.failedAttempts}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-mono text-ws-muted uppercase block">
                    Last Event
                  </span>
                  <span className="text-sm font-mono font-semibold text-ws-secondary">
                    {int.lastSeen}
                  </span>
                </div>
              </div>
            </div>

            <button
              onClick={() => onInspectIntegration(int.name)}
              className="w-full inline-flex items-center justify-center gap-2 py-2 px-3 rounded-md bg-ws-surface-subtle border border-ws-border hover:bg-ws-surface-elevated text-xs font-semibold text-ws-ink transition-colors"
            >
              <span>Inspect Connected Incidents</span>
              <ExternalLink className="w-3.5 h-3.5 text-ws-accent" />
            </button>
          </div>
        ))}

        {/* Integration Guidance Card */}
        <div className="p-6 rounded-lg border border-dashed border-ws-border bg-ws-surface-subtle/50 flex flex-col justify-center items-center text-center space-y-3">
          <div className="p-2.5 rounded-md bg-ws-surface border border-ws-border text-ws-accent">
            <Zap className="w-4 h-4" />
          </div>
          <div className="text-xs font-bold text-ws-ink">Mount @wiresleuth/sdk</div>
          <p className="text-xs text-ws-secondary leading-relaxed max-w-xs">
            Supports Express, Fastify, Next.js, Hono, and Node HTTP with passive stream taps and tamper-evident redaction.
          </p>
          <code className="text-[11px] font-mono bg-ws-surface text-ws-accent px-3 py-1.5 rounded border border-ws-border">
            npm i @wiresleuth/sdk
          </code>
        </div>
      </div>
    </div>
  );
};
