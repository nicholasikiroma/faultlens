import React from 'react';

export interface PanelProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'subtle';
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

const paddingClasses = {
  none: '',
  sm: 'p-4',
  md: 'p-5',
  lg: 'p-6',
};

export const Panel: React.FC<PanelProps> = ({
  variant = 'default',
  padding = 'md',
  className = '',
  children,
  ...rest
}) => {
  const surfaceClass =
    variant === 'subtle' ? 'bg-fl-surface-subtle' : 'bg-fl-surface';

  return (
    <div
      className={`rounded-xl border border-fl-border shadow-subtle ${surfaceClass} ${paddingClasses[padding]} ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
};
