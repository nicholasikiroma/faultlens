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
          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono font-semibold tracking-wider uppercase border border-ws-accent-border bg-ws-accent-subtle text-ws-accent ${className}`}>
            <span className="w-1.5 h-1.5 rounded-full bg-ws-accent" />
            [OBSERVED]
          </span>
        );
      case 'RULE':
        return (
          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono font-semibold tracking-wider uppercase border border-ws-info-border bg-ws-info-bg text-ws-info-text ${className}`}>
            <Cpu className="w-3 h-3 text-ws-info-dot" />
            [RULE]
          </span>
        );
      case 'AI_HYPOTHESIS':
        return (
          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono font-semibold tracking-wider uppercase border border-dashed border-ws-warning-border bg-ws-warning-bg text-ws-warning-text ${className}`}>
            <Sparkles className="w-3 h-3 text-ws-warning-dot" />
            [AI HYPOTHESIS]
          </span>
        );
      case 'REDACTED':
        return (
          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono font-semibold tracking-wider uppercase border border-ws-border bg-ws-surface-subtle text-ws-muted select-none ${className}`}>
            <Shield className="w-3 h-3 text-ws-muted" />
            [REDACTED]
          </span>
        );
    }
  }

  if (type === 'severity' || severity) {
    const sev = severity || 'LOW';
    switch (sev) {
      case 'CRITICAL':
        return (
          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono font-medium border border-ws-danger-border bg-ws-danger-bg text-ws-danger-text ${className}`}>
            <AlertCircle className="w-3 h-3 text-ws-danger-dot" />
            CRITICAL
          </span>
        );
      case 'HIGH':
        return (
          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono font-medium border border-ws-danger-border bg-ws-danger-bg text-ws-danger-text ${className}`}>
            <AlertCircle className="w-3 h-3 text-ws-danger-dot" />
            HIGH
          </span>
        );
      case 'MEDIUM':
        return (
          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono font-medium border border-ws-warning-border bg-ws-warning-bg text-ws-warning-text ${className}`}>
            <AlertTriangle className="w-3 h-3 text-ws-warning-dot" />
            MEDIUM
          </span>
        );
      case 'LOW':
        return (
          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono font-medium border border-ws-success-border bg-ws-success-bg text-ws-success-text ${className}`}>
            <CheckCircle className="w-3 h-3 text-ws-success-dot" />
            LOW
          </span>
        );
    }
  }

  // Default: Status
  const st = status || 'OPEN';
  switch (st) {
    case 'INVESTIGATING':
      return (
        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono font-medium border border-ws-info-border bg-ws-info-bg text-ws-info-text ${className}`}>
          {withPulse ? (
            <span className="w-1.5 h-1.5 rounded-full bg-ws-info-dot" />
          ) : (
            <Activity className="w-3 h-3 text-ws-info-dot" />
          )}
          {label || 'INVESTIGATING'}
        </span>
      );
    case 'OPEN':
      return (
        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono font-medium border border-ws-danger-border bg-ws-danger-bg text-ws-danger-text ${className}`}>
          <span className="w-1.5 h-1.5 rounded-full bg-ws-danger-dot" />
          {label || 'OPEN'}
        </span>
      );
    case 'RESOLVED':
      return (
        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono font-medium border border-ws-success-border bg-ws-success-bg text-ws-success-text ${className}`}>
          <CheckCircle className="w-3 h-3 text-ws-success-dot" />
          {label || 'RESOLVED'}
        </span>
      );
    case 'IGNORED':
      return (
        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono font-medium border border-ws-border bg-ws-surface-subtle text-ws-muted ${className}`}>
          {label || 'IGNORED'}
        </span>
      );
  }
};
