import React from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  leadingIcon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-fl-btn-primary text-fl-btn-primary-ink border border-fl-btn-primary-border hover:bg-fl-btn-primary-hover active:bg-fl-btn-primary-active shadow-subtle',
  secondary:
    'bg-fl-surface text-fl-ink border border-fl-border-strong/70 hover:border-fl-border-strong hover:bg-fl-surface-elevated shadow-subtle',
  ghost:
    'bg-transparent text-fl-secondary border border-transparent hover:text-fl-ink hover:bg-fl-surface-elevated',
  danger:
    'bg-fl-danger-bg text-fl-danger-text border border-fl-danger-border hover:brightness-110',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'px-2.5 py-1.5 text-xs rounded-md gap-1.5',
  md: 'px-3.5 py-2 text-[13px] rounded-lg gap-2',
};

export const Button: React.FC<ButtonProps> = ({
  variant = 'secondary',
  size = 'md',
  type = 'button',
  leadingIcon,
  trailingIcon,
  className = '',
  children,
  ...rest
}) => {
  return (
    <button
      type={type}
      className={`fl-tactile-btn inline-flex items-center justify-center font-sans font-medium whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      {...rest}
    >
      {leadingIcon}
      {children}
      {trailingIcon}
    </button>
  );
};
