import React from 'react';
import { Search, Sun, Moon } from 'lucide-react';

interface TopbarProps {
  breadcrumbs: string[];
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  onOpenCommandPalette: () => void;
}

export const Topbar: React.FC<TopbarProps> = ({
  breadcrumbs,
  theme,
  onToggleTheme,
  onOpenCommandPalette,
}) => {
  return (
    <header className="h-14 border-b border-ws-border bg-ws-canvas/90 backdrop-blur-sm px-6 flex items-center justify-between sticky top-0 z-30 transition-colors duration-150">
      {/* Breadcrumbs */}
      <div className="flex items-center gap-2 text-xs">
        <span className="text-ws-muted font-medium">Workspace</span>
        {breadcrumbs.map((crumb, idx) => (
          <React.Fragment key={idx}>
            <span className="text-ws-muted/50">/</span>
            <span
              className={`font-semibold ${
                idx === breadcrumbs.length - 1 ? 'text-ws-ink' : 'text-ws-secondary'
              }`}
            >
              {crumb}
            </span>
          </React.Fragment>
        ))}
      </div>

      {/* Right Actions */}
      <div className="flex items-center gap-2.5">
        {/* Command Palette Trigger */}
        <button
          onClick={onOpenCommandPalette}
          className="flex items-center gap-2.5 px-3 py-1.5 rounded-md bg-ws-surface border border-ws-border text-ws-secondary hover:text-ws-ink hover:border-ws-border-strong text-xs transition-colors shadow-subtle"
        >
          <Search className="w-3.5 h-3.5 text-ws-accent" />
          <span className="hidden sm:inline">Search & command...</span>
          <kbd className="px-1.5 py-0.5 text-[10px] font-mono font-medium bg-ws-surface-subtle border border-ws-border rounded text-ws-muted">
            ⌘K
          </kbd>
        </button>

        {/* Recorder Connection Indicator - Healthy State */}
        <div className="hidden md:flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-ws-surface border border-ws-border text-[11px] font-mono font-medium text-ws-secondary shadow-subtle">
          <span className="w-1.5 h-1.5 rounded-full bg-ws-success-dot" />
          <span>RECORDER ACTIVE</span>
        </div>

        {/* Theme Switcher */}
        <button
          onClick={onToggleTheme}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-ws-surface border border-ws-border hover:border-ws-border-strong text-ws-secondary hover:text-ws-ink text-xs font-medium transition-colors shadow-subtle"
          title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} mode`}
          aria-label={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} mode`}
        >
          {theme === 'dark' ? (
            <>
              <Sun className="w-3.5 h-3.5 text-ws-accent" />
              <span className="hidden lg:inline text-[11px] font-mono">Light</span>
            </>
          ) : (
            <>
              <Moon className="w-3.5 h-3.5 text-ws-accent" />
              <span className="hidden lg:inline text-[11px] font-mono">Dark</span>
            </>
          )}
        </button>

        <div className="w-px h-4 bg-ws-border mx-0.5" />

        {/* Maintainer Session Badge */}
        <div
          className="w-7 h-7 rounded-md bg-ws-surface-elevated border border-ws-border text-ws-accent flex items-center justify-center text-[10px] font-bold font-mono"
          title="Local Maintainer Session"
        >
          WS
        </div>
      </div>
    </header>
  );
};
