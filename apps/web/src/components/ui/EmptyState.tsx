import React from 'react';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  action,
}) => {
  return (
    <div className="py-12 px-6 text-center flex flex-col items-center justify-center gap-2.5">
      {icon && (
        <div className="w-10 h-10 rounded-lg bg-fl-surface-subtle border border-fl-border flex items-center justify-center text-fl-muted">
          {icon}
        </div>
      )}
      <div className="text-[13px] font-semibold text-fl-ink font-sans">{title}</div>
      {description && (
        <p className="text-xs text-fl-secondary max-w-sm font-sans leading-relaxed">
          {description}
        </p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
};
