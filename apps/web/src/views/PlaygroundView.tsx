import React, { useState } from 'react';
import type { PlaygroundScenario, Incident } from '../types';
import { Button, PageHeader, Panel } from '../components/ui';
import { Play, CheckCircle2, ArrowRight, Activity, RefreshCw } from 'lucide-react';

interface PlaygroundViewProps {
  scenarios: PlaygroundScenario[];
  onRunScenario: (scenario: PlaygroundScenario) => Incident | Promise<Incident>;
  onOpenIncident: (incidentId: string) => void;
}

export const PlaygroundView: React.FC<PlaygroundViewProps> = ({
  scenarios,
  onRunScenario,
  onOpenIncident,
}) => {
  const [runningScenario, setRunningScenario] = useState<PlaygroundScenario | null>(null);
  const [pipelineStep, setPipelineStep] = useState<number>(0);
  const [spawnedIncident, setSpawnedIncident] = useState<Incident | null>(null);

  const handleSimulate = (scen: PlaygroundScenario) => {
    setRunningScenario(scen);
    setPipelineStep(1);
    setSpawnedIncident(null);

    setTimeout(() => {
      setPipelineStep(2);

      setTimeout(() => {
        setPipelineStep(3);

        setTimeout(async () => {
          const newInc = await onRunScenario(scen);
          setSpawnedIncident(newInc);
          setPipelineStep(4);
        }, 700);
      }, 700);
    }, 600);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Failure Lab"
        title="Simulation Playground"
        description="Safely inject synthetic integration failures into the local FaultLens ingestion pipeline and verify deterministic rule classification."
      />

      {runningScenario && (
        <Panel padding="md" className="border-fl-accent-border space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-fl-border">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-fl-accent" aria-hidden="true" />
              <span className="text-xs font-sans font-semibold text-fl-ink">
                Simulating: {runningScenario.title}
              </span>
            </div>
            {pipelineStep < 4 ? (
              <span className="flex items-center gap-1.5 text-xs text-fl-warning-text font-mono font-medium">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                Ingesting...
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-xs text-fl-success-text font-mono font-medium">
                <CheckCircle2 className="w-4 h-4 text-fl-success-dot" aria-hidden="true" />
                Incident Classified
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
            <div
              className={`p-3 rounded-lg border transition-colors ${
                pipelineStep >= 1
                  ? 'border-fl-accent-border bg-fl-accent-subtle text-fl-ink font-semibold'
                  : 'border-fl-border bg-fl-surface-subtle text-fl-muted'
              }`}
            >
              <div className="text-[10px] uppercase font-mono text-fl-accent-text font-medium mb-1">
                Step 1: Dispatch
              </div>
              <div className="font-sans">Synthetic Event Sent</div>
            </div>

            <div
              className={`p-3 rounded-lg border transition-colors ${
                pipelineStep >= 2
                  ? 'border-fl-accent-border bg-fl-accent-subtle text-fl-ink font-semibold'
                  : 'border-fl-border bg-fl-surface-subtle text-fl-muted'
              }`}
            >
              <div className="text-[10px] uppercase font-mono text-fl-accent-text font-medium mb-1">
                Step 2: Redact
              </div>
              <div className="font-sans">Secrets Masked</div>
            </div>

            <div
              className={`p-3 rounded-lg border transition-colors ${
                pipelineStep >= 3
                  ? 'border-fl-accent-border bg-fl-accent-subtle text-fl-ink font-semibold'
                  : 'border-fl-border bg-fl-surface-subtle text-fl-muted'
              }`}
            >
              <div className="text-[10px] uppercase font-mono text-fl-accent-text font-medium mb-1">
                Step 3: Classify
              </div>
              <div className="font-sans">
                Matched <span className="font-mono">{runningScenario.cls}</span>
              </div>
            </div>

            <div
              className={`p-3 rounded-lg border transition-colors ${
                pipelineStep >= 4
                  ? 'border-fl-success-border bg-fl-success-bg text-fl-ink font-semibold'
                  : 'border-fl-border bg-fl-surface-subtle text-fl-muted'
              }`}
            >
              <div className="text-[10px] uppercase font-mono text-fl-success-text font-medium mb-1">
                Step 4: Ready
              </div>
              <div className="font-sans">Opened in Triage Queue</div>
            </div>
          </div>

          {spawnedIncident && (
            <div className="pt-3 border-t border-fl-border flex items-center justify-between gap-3">
              <span className="text-xs text-fl-muted font-sans">
                Created{' '}
                <span className="font-mono text-fl-secondary font-medium">
                  {spawnedIncident.key}
                </span>{' '}
                • Status: <span className="font-mono">{spawnedIncident.status}</span>
              </span>
              <Button
                variant="primary"
                onClick={() => onOpenIncident(spawnedIncident.id)}
                trailingIcon={<ArrowRight className="w-3.5 h-3.5" />}
              >
                Inspect Incident
              </Button>
            </div>
          )}
        </Panel>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {scenarios.map((scen, idx) => (
          <Panel
            key={scen.id}
            padding="md"
            className="flex flex-col justify-between space-y-4 hover:border-fl-border-strong transition-colors"
          >
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-mono font-medium text-fl-accent-text bg-fl-accent-subtle border border-fl-accent-border px-2 py-0.5 rounded">
                  SCENARIO 0{idx + 1}
                </span>
                <span className="text-[11px] font-mono text-fl-ink bg-fl-surface-subtle px-2 py-0.5 rounded border border-fl-border">
                  {scen.cls}
                </span>
              </div>
              <h3 className="text-fl-card text-fl-ink mt-3 font-sans">{scen.title}</h3>
              <p className="text-[13px] font-sans text-fl-secondary mt-1 leading-relaxed">
                {scen.description}
              </p>
            </div>

            <Button
              variant="secondary"
              size="sm"
              className="w-full"
              onClick={() => handleSimulate(scen)}
              disabled={pipelineStep > 0 && pipelineStep < 4}
              leadingIcon={<Play className="w-3.5 h-3.5 text-fl-accent fill-current" />}
            >
              Simulate Failure
            </Button>
          </Panel>
        ))}
      </div>
    </div>
  );
};
