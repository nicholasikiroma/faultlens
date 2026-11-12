import React, { useState } from 'react';
import type { PlaygroundScenario, Incident } from '../types';
import { Play, CheckCircle2, ArrowRight, Radio, RefreshCw } from 'lucide-react';

interface PlaygroundViewProps {
  scenarios: PlaygroundScenario[];
  onRunScenario: (scenario: PlaygroundScenario) => Incident;
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

    // Step 1: Egress
    setTimeout(() => {
      setPipelineStep(2);

      // Step 2: Redact & Verify
      setTimeout(() => {
        setPipelineStep(3);

        // Step 3: Rule Match
        setTimeout(() => {
          const newInc = onRunScenario(scen);
          setSpawnedIncident(newInc);
          setPipelineStep(4);
        }, 700);
      }, 700);
    }, 600);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="text-[10px] font-mono font-semibold tracking-widest text-ws-accent uppercase">
            FAILURE LAB & FLIGHT SIMULATOR
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-ws-ink mt-0.5">Playground</h1>
          <p className="text-xs text-ws-secondary mt-1">
            Safely inject synthetic integration failures into the local WireSleuth ingestion pipeline.
          </p>
        </div>
      </div>

      {/* Live Pipeline Animation Box when simulating */}
      {runningScenario && (
        <div className="p-5 rounded-lg bg-ws-surface border border-ws-accent-border shadow-subtle space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-ws-border">
            <div className="flex items-center gap-2">
              <Radio className="w-4 h-4 text-ws-accent" />
              <span className="text-xs font-mono font-bold text-ws-ink uppercase tracking-wider">
                Simulating: {runningScenario.title}
              </span>
            </div>
            {pipelineStep < 4 ? (
              <span className="flex items-center gap-1.5 text-xs text-ws-warning-text font-mono">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                Pipeline Ingestion Processing...
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-xs text-ws-success-text font-mono font-medium">
                <CheckCircle2 className="w-4 h-4 text-ws-success-dot" />
                Incident Created & Classified
              </span>
            )}
          </div>

          {/* 4-Step Pipeline Visualizer */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs font-mono">
            {/* Step 1 */}
            <div
              className={`p-3 rounded-md border transition-colors ${
                pipelineStep >= 1
                  ? 'border-ws-accent-border bg-ws-accent-subtle text-ws-ink font-semibold'
                  : 'border-ws-border bg-ws-surface-subtle text-ws-muted'
              }`}
            >
              <div className="text-[10px] uppercase text-ws-accent font-bold mb-1">
                Step 1: Egress
              </div>
              <div>Synthetic Delivery Dispatched</div>
            </div>

            {/* Step 2 */}
            <div
              className={`p-3 rounded-md border transition-colors ${
                pipelineStep >= 2
                  ? 'border-ws-accent-border bg-ws-accent-subtle text-ws-ink font-semibold'
                  : 'border-ws-border bg-ws-surface-subtle text-ws-muted'
              }`}
            >
              <div className="text-[10px] uppercase text-ws-accent font-bold mb-1">
                Step 2: Ingest & Redact
              </div>
              <div>Secrets Masked [REDACTED]</div>
            </div>

            {/* Step 3 */}
            <div
              className={`p-3 rounded-md border transition-colors ${
                pipelineStep >= 3
                  ? 'border-ws-accent-border bg-ws-accent-subtle text-ws-ink font-semibold'
                  : 'border-ws-border bg-ws-surface-subtle text-ws-muted'
              }`}
            >
              <div className="text-[10px] uppercase text-ws-accent font-bold mb-1">
                Step 3: Rule Match
              </div>
              <div>Matched {runningScenario.cls}</div>
            </div>

            {/* Step 4 */}
            <div
              className={`p-3 rounded-md border transition-colors ${
                pipelineStep >= 4
                  ? 'border-ws-success-border bg-ws-success-bg text-ws-ink font-semibold'
                  : 'border-ws-border bg-ws-surface-subtle text-ws-muted'
              }`}
            >
              <div className="text-[10px] uppercase text-ws-success-text font-bold mb-1">
                Step 4: Incident Ready
              </div>
              <div>Opened in Triage Queue</div>
            </div>
          </div>

          {/* CTA when complete */}
          {spawnedIncident && (
            <div className="pt-3 border-t border-ws-border flex items-center justify-between">
              <span className="text-xs text-ws-muted font-mono">
                Generated {spawnedIncident.key} • Status: {spawnedIncident.status}
              </span>
              <button
                onClick={() => onOpenIncident(spawnedIncident.id)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-ws-btn-primary hover:bg-ws-btn-primary-hover active:bg-ws-btn-primary-active text-ws-btn-primary-ink border border-ws-btn-primary-border text-xs font-semibold shadow-subtle transition-colors"
              >
                <span>Inspect in Investigation Workspace</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Scenario Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {scenarios.map((scen, idx) => (
          <div
            key={scen.id}
            className="p-5 rounded-lg bg-ws-surface border border-ws-border shadow-subtle flex flex-col justify-between space-y-4 hover:border-ws-border-strong transition-colors"
          >
            <div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono font-semibold text-ws-accent bg-ws-accent-subtle border border-ws-accent-border px-2 py-0.5 rounded">
                  SCENARIO 0{idx + 1}
                </span>
                <span className="text-[11px] font-mono text-ws-ink bg-ws-surface-subtle px-2 py-0.5 rounded border border-ws-border">
                  {scen.cls}
                </span>
              </div>
              <h3 className="text-sm font-bold text-ws-ink mt-3">{scen.title}</h3>
              <p className="text-xs text-ws-secondary mt-1 leading-relaxed">{scen.description}</p>
            </div>

            <button
              onClick={() => handleSimulate(scen)}
              disabled={pipelineStep > 0 && pipelineStep < 4}
              className="w-full inline-flex items-center justify-center gap-2 py-2 px-3 rounded-md bg-ws-surface-subtle border border-ws-border hover:bg-ws-surface-elevated text-xs font-semibold text-ws-ink transition-colors disabled:opacity-50"
            >
              <Play className="w-3.5 h-3.5 text-ws-accent fill-current" />
              <span>Simulate Failure</span>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
