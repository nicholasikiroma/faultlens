import React from 'react';
import type { IntegrationItem } from '../types';
import { Button, PageHeader, Panel } from '../components/ui';
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
      <PageHeader
        eyebrow="Connected Sources"
        title="Integrations"
        description="Observed webhook providers, async queues, and upstream services instrumented with the FaultLens SDK."
        actions={
          <Button
            variant="primary"
            onClick={() =>
              onShowToast('To connect an integration, mount the @faultlens/sdk middleware in your service.')
            }
            leadingIcon={<Plus className="w-3.5 h-3.5" />}
          >
            Connect Source
          </Button>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {integrations.map((int) => (
          <Panel
            key={int.id}
            padding="md"
            className="flex flex-col justify-between space-y-4 hover:border-fl-border-strong transition-colors"
          >
            <div>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-lg bg-fl-surface-subtle border border-fl-border text-fl-accent">
                    <Plug className="w-4 h-4" aria-hidden="true" />
                  </div>
                  <div>
                    <h3 className="text-fl-card text-fl-ink font-sans">{int.name}</h3>
                    <p className="text-xs font-sans text-fl-muted">{int.type}</p>
                  </div>
                </div>
              </div>

              <div className="mt-4">
                <span
                  className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono font-medium uppercase ${
                    int.status === 'HEALTHY'
                      ? 'bg-fl-success-bg text-fl-success-text border border-fl-success-border'
                      : 'bg-fl-warning-bg text-fl-warning-text border border-fl-warning-border'
                  }`}
                >
                  <Activity className="w-3 h-3" aria-hidden="true" />
                  {int.status}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 mt-4 pt-4 border-t border-fl-border text-xs">
                <div>
                  <span className="text-[10px] font-mono text-fl-muted uppercase block">
                    Failed Attempts
                  </span>
                  <span className="text-lg font-mono font-medium text-fl-ink tabular-nums">
                    {int.failedAttempts}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-mono text-fl-muted uppercase block">
                    Last Event
                  </span>
                  <span className="text-xs font-mono font-medium text-fl-secondary tabular-nums">
                    {int.lastSeen}
                  </span>
                </div>
              </div>
            </div>

            <Button
              variant="secondary"
              size="sm"
              className="w-full"
              onClick={() => onInspectIntegration(int.name)}
              trailingIcon={<ExternalLink className="w-3.5 h-3.5 text-fl-accent" />}
            >
              Inspect Connected Incidents
            </Button>
          </Panel>
        ))}

        {/* SDK Setup Card */}
        <div className="p-6 rounded-xl border border-dashed border-fl-border-strong bg-fl-surface-subtle flex flex-col justify-center items-center text-center space-y-3">
          <div className="p-2.5 rounded-lg bg-fl-surface border border-fl-border text-fl-accent">
            <Zap className="w-4 h-4" aria-hidden="true" />
          </div>
          <div className="text-[13px] font-semibold text-fl-ink font-sans">
            Instrument with @faultlens/sdk
          </div>
          <p className="text-xs font-sans text-fl-secondary leading-relaxed max-w-xs">
            Supports Express, Fastify, Hono, NestJS, and Node HTTP with non-blocking delivery and ingress redaction.
          </p>
          <code className="text-xs font-mono bg-fl-surface text-fl-accent-text px-3 py-1.5 rounded-md border border-fl-border">
            npm i @faultlens/sdk
          </code>
        </div>
      </div>
    </div>
  );
};
