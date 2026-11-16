import React from 'react';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  leadingIcon?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ leadingIcon, className = '', ...rest }, ref) => {
    return (
      <div className="relative flex items-center w-full">
        {leadingIcon && (
          <span className="absolute left-3 text-fl-muted pointer-events-none flex items-center">
            {leadingIcon}
          </span>
        )}
        <input
          ref={ref}
          className={`w-full py-2 bg-fl-surface-subtle border border-fl-border-strong/60 rounded-lg text-[13px] text-fl-ink placeholder:text-fl-muted font-sans transition-colors focus:outline-none focus:border-fl-accent ${
            leadingIcon ? 'pl-9 pr-3.5' : 'px-3.5'
          } ${className}`}
          {...rest}
        />
      </div>
    );
  }
);
Input.displayName = 'Input';

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {}

export const Select: React.FC<SelectProps> = ({ className = '', children, ...rest }) => {
  return (
    <select
      className={`px-3 py-2 bg-fl-surface-subtle border border-fl-border-strong/60 rounded-lg text-[13px] font-sans text-fl-ink transition-colors focus:outline-none focus:border-fl-accent ${className}`}
      {...rest}
    >
      {children}
    </select>
  );
};
