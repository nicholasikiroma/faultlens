import React from 'react';

export interface PageHeaderProps {
  eyebrow: string;
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  backAction?: React.ReactNode;
  badge?: React.ReactNode;
}

export const PageHeader: React.FC<PageHeaderProps> = ({
  eyebrow,
  title,
  description,
  actions,
  backAction,
  badge,
}) => {
  return (
    <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4 pb-4 border-b border-fl-border">
      <div className="min-w-0">
        {backAction && <div className="mb-2">{backAction}</div>}
        <div className="fl-eyebrow text-fl-accent-text mb-1.5 flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-fl-accent shrink-0" aria-hidden="true" />
          <span>{eyebrow}</span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-fl-title text-fl-ink font-sans">{title}</h1>
          {badge}
        </div>
        {description && (
          <p className="text-fl-body text-fl-secondary mt-1.5 max-w-2xl font-sans">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2.5 shrink-0">{actions}</div>}
    </div>
  );
};
