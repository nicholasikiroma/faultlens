import React from 'react';
import type { EpistemicType, IncidentSeverity, IncidentStatus } from '../types';
import { AlertCircle, AlertTriangle, CheckCircle, Activity, Shield, Cpu, Sparkles } from 'lucide-react';

interface BadgeProps {
  type?: 'status' | 'severity' | 'epistemic';
  status?: IncidentStatus;
  severity?: IncidentSeverity;
  epistemic?: EpistemicType;
  label?: string;
  withPulse?: boolean;
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({
  type = 'status',
  status,
  severity,
  epistemic,
  label,
  withPulse = false,
  className = '',
}) => {
  if (type === 'epistemic' || epistemic) {
    const ep = epistemic || 'OBSERVED';
    switch (ep) {
      case 'OBSERVED':
        return (
          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono font-medium tracking-wide uppercase border border-fl-accent-border bg-fl-accent-subtle text-fl-accent-text ${className}`}>
            <span className="w-1.5 h-1.5 rounded-full bg-fl-accent" aria-hidden="true" />
            OBSERVED
          </span>
        );
      case 'RULE':
        return (
          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono font-medium tracking-wide uppercase border border-fl-violet-border bg-fl-violet-bg text-fl-violet-text ${className}`}>
            <Cpu className="w-3 h-3 text-fl-violet-dot" aria-hidden="true" />
            RULE
          </span>
        );
      case 'AI_HYPOTHESIS':
        return (
          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono font-medium tracking-wide uppercase border border-dashed border-fl-warning-border bg-fl-warning-bg text-fl-warning-text ${className}`}>
            <Sparkles className="w-3 h-3 text-fl-warning-dot" aria-hidden="true" />
            AI HYPOTHESIS
          </span>
        );
      case 'REDACTED':
        return (
          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono font-medium tracking-wide uppercase border border-fl-border bg-fl-surface-subtle text-fl-muted select-none ${className}`}>
            <Shield className="w-3 h-3 text-fl-muted" aria-hidden="true" />
            REDACTED
          </span>
        );
    }
  }

  if (type === 'severity' || severity) {
    const sev = severity || 'LOW';
    switch (sev) {
      case 'CRITICAL':
        return (
          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono font-medium uppercase tracking-wide border border-fl-danger-border bg-fl-danger-bg text-fl-danger-text ${className}`}>
            <AlertCircle className="w-3 h-3 text-fl-danger-dot" aria-hidden="true" />
            CRITICAL
          </span>
        );
      case 'HIGH':
        return (
          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono font-medium uppercase tracking-wide border border-fl-danger-border bg-fl-danger-bg text-fl-danger-text ${className}`}>
            <AlertCircle className="w-3 h-3 text-fl-danger-dot" aria-hidden="true" />
            HIGH
          </span>
        );
      case 'MEDIUM':
        return (
          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono font-medium uppercase tracking-wide border border-fl-warning-border bg-fl-warning-bg text-fl-warning-text ${className}`}>
            <AlertTriangle className="w-3 h-3 text-fl-warning-dot" aria-hidden="true" />
            MEDIUM
          </span>
        );
      case 'LOW':
        return (
          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono font-medium uppercase tracking-wide border border-fl-success-border bg-fl-success-bg text-fl-success-text ${className}`}>
            <CheckCircle className="w-3 h-3 text-fl-success-dot" aria-hidden="true" />
            LOW
          </span>
        );
    }
  }

  const st = status || 'OPEN';
  switch (st) {
    case 'INVESTIGATING':
      return (
        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono font-medium uppercase tracking-wide border border-fl-violet-border bg-fl-violet-bg text-fl-violet-text ${className}`}>
          {withPulse ? (
            <span className="w-1.5 h-1.5 rounded-full bg-fl-violet-dot animate-pulse" aria-hidden="true" />
          ) : (
            <Activity className="w-3 h-3 text-fl-violet-dot" aria-hidden="true" />
          )}
          {label || 'INVESTIGATING'}
        </span>
      );
    case 'OPEN':
      return (
        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono font-medium uppercase tracking-wide border border-fl-danger-border bg-fl-danger-bg text-fl-danger-text ${className}`}>
          <span className="w-1.5 h-1.5 rounded-full bg-fl-danger-dot" aria-hidden="true" />
          {label || 'OPEN'}
        </span>
      );
    case 'RESOLVED':
      return (
        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono font-medium uppercase tracking-wide border border-fl-success-border bg-fl-success-bg text-fl-success-text ${className}`}>
          <CheckCircle className="w-3 h-3 text-fl-success-dot" aria-hidden="true" />
          {label || 'RESOLVED'}
        </span>
      );
    case 'IGNORED':
      return (
        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono font-medium uppercase tracking-wide border border-fl-border bg-fl-surface-subtle text-fl-muted ${className}`}>
          {label || 'IGNORED'}
        </span>
      );
  }
};
