import React, { useEffect } from 'react';
import { ArrowRight, X, AlertCircle } from 'lucide-react';
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

  const borderAccent =
    incident.severity === 'CRITICAL' || incident.severity === 'HIGH'
      ? 'border-fl-danger-border'
      : 'border-fl-border-strong';

  return (
    <div
      role="alert"
      aria-live="polite"
      className="fixed bottom-6 right-6 z-50 max-w-sm w-full"
    >
      <div
        className={`rounded-xl border ${borderAccent} bg-fl-surface shadow-overlay p-4 space-y-2.5`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 text-xs font-sans font-semibold text-fl-ink">
            <AlertCircle className="w-3.5 h-3.5 text-fl-danger-dot" aria-hidden="true" />
            <span>New Incident Activity</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-fl-surface-subtle border border-fl-border text-fl-secondary font-medium tabular-nums">
              {incident.events} events
            </span>
            <button
              type="button"
              onClick={onDismiss}
              className="text-fl-muted hover:text-fl-ink transition-colors p-0.5 rounded"
              aria-label="Dismiss notification"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="font-mono text-xs font-medium text-fl-accent-text">
              {incident.key}
            </span>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-fl-border bg-fl-surface-subtle text-fl-secondary uppercase">
              {incident.cls}
            </span>
          </div>
          <p className="text-[13px] font-sans text-fl-ink font-medium line-clamp-2 leading-snug">
            {incident.title}
          </p>
        </div>

        <div className="flex items-center justify-between pt-2.5 border-t border-fl-border text-xs font-sans">
          <span className="text-[11px] font-mono text-fl-muted tabular-nums">
            {incident.integration} • {incident.seen}
          </span>
          <button
            type="button"
            onClick={() => onInvestigate(incident.id)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-fl-btn-primary text-fl-btn-primary-ink hover:bg-fl-btn-primary-hover font-medium font-sans text-xs transition-colors"
          >
            <span>Investigate</span>
            <ArrowRight className="w-3 h-3" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
};
