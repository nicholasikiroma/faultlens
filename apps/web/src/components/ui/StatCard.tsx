import React from 'react';

export interface StatCardProps {
  label: string;
  value: React.ReactNode;
  meta?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: 'default' | 'danger' | 'violet' | 'success' | 'warning';
}

const toneTextClasses = {
  default: 'text-fl-ink',
  danger: 'text-fl-danger-text',
  violet: 'text-fl-violet-text',
  success: 'text-fl-success-text',
  warning: 'text-fl-warning-text',
};

const toneLabelClasses = {
  default: 'text-fl-muted',
  danger: 'text-fl-danger-text',
  violet: 'text-fl-violet-text',
  success: 'text-fl-success-text',
  warning: 'text-fl-warning-text',
};

export const StatCard: React.FC<StatCardProps> = ({
  label,
  value,
  meta,
  icon,
  tone = 'default',
}) => {
  return (
    <div className="p-4 rounded-xl bg-fl-surface border border-fl-border shadow-subtle flex flex-col justify-between gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className={`font-mono text-fl-label uppercase ${toneLabelClasses[tone]}`}>
          {label}
        </span>
        {icon && <span className="text-fl-muted shrink-0">{icon}</span>}
      </div>
      <div className={`font-mono text-2xl font-medium tabular-nums tracking-tight ${toneTextClasses[tone]}`}>
        {value}
      </div>
      {meta && <div className="text-fl-meta text-fl-secondary font-sans">{meta}</div>}
    </div>
  );
};
