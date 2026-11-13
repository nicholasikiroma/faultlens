import React, { useEffect } from 'react';
import { ArrowRight, X, Radio } from 'lucide-react';
import type { Incident } from '../types';

interface IncidentToastProps {
  incident: Incident | null;
  onDismiss: () => void;
  onInvestigate: (id: string) => void;
}

export const IncidentToast: React.FC<IncidentToastProps> = ({
  incident,
  onDismiss,
  onInvestigate,
}) => {
  useEffect(() => {
    if (!incident) return;
    const timer = setTimeout(() => {
      onDismiss();
    }, 7000);
    return () => clearTimeout(timer);
  }, [incident, onDismiss]);

  if (!incident) return null;

  const severityColor =
    incident.severity === 'CRITICAL'
      ? 'border-ws-danger-border bg-ws-danger-bg/90 text-ws-danger-text'
      : incident.severity === 'HIGH'
      ? 'border-ws-warning-border bg-ws-warning-bg/90 text-ws-warning-text'
      : 'border-ws-border bg-ws-surface/95 text-ws-ink';

  const badgeColor =
    incident.severity === 'CRITICAL'
      ? 'bg-ws-danger-bg text-ws-danger-text border-ws-danger-border'
      : incident.severity === 'HIGH'
      ? 'bg-ws-warning-bg text-ws-warning-text border-ws-warning-border'
      : 'bg-ws-surface-subtle text-ws-secondary border-ws-border';

  return (
    <div
      role="alert"
      aria-live="polite"
      className="fixed bottom-6 right-6 z-50 max-w-sm w-full animate-in fade-in slide-in-from-bottom-4 duration-200"
    >
      <div
        className={`rounded-lg border shadow-overlay backdrop-blur-md p-4 transition-all ${severityColor}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-ws-danger-dot opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-ws-danger-dot" />
            </span>
            <div className="flex items-center gap-1.5 text-xs font-sans font-semibold text-ws-danger-text">
              <Radio className="w-3.5 h-3.5 animate-pulse" />
              <span>Real-Time Anomaly Stream</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-ws-surface/90 border border-ws-border text-ws-ink font-medium tabular-nums">
              {incident.events} events
            </span>
            <button
              onClick={onDismiss}
              className="text-ws-muted hover:text-ws-ink transition-colors p-0.5 rounded"
              aria-label="Dismiss notification"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="mt-2.5">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-mono text-xs font-medium text-ws-ink">
              {incident.key}
            </span>
            <span
              className={`text-[10px] font-mono px-1.5 py-0.5 rounded border uppercase ${badgeColor}`}
            >
              {incident.cls}
            </span>
            <span className="text-xs font-sans text-ws-muted truncate">
              {incident.integration}
            </span>
          </div>
          <p className="text-[13px] font-sans text-ws-ink font-medium line-clamp-2 leading-snug">
            {incident.title}
          </p>
        </div>

        <div className="mt-3 flex items-center justify-between pt-2.5 border-t border-ws-border/50 text-xs font-sans">
          <span className="text-[11px] font-mono text-ws-muted flex items-center gap-1.5 tabular-nums">
            <span className="w-1.5 h-1.5 rounded-full bg-ws-success-dot animate-pulse" />
            Active {incident.seen}
          </span>
          <button
            onClick={() => onInvestigate(incident.id)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-ws-accent text-ws-accent-ink hover:opacity-90 font-medium font-sans text-xs transition-opacity shadow-subtle"
          >
            <span>Investigate Case</span>
            <ArrowRight className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
};
