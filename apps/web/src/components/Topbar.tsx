import React from 'react';
import { Search, Sun, Moon, RefreshCw } from 'lucide-react';

interface TopbarProps {
  breadcrumbs: string[];
  theme: 'dark' | 'light';
  isLiveConnected?: boolean;
  isRecording?: boolean;
  latencyMs?: number | null;
  onToggleTheme: () => void;
  onOpenCommandPalette: () => void;
  onRetryConnection?: () => void;
}

export const Topbar: React.FC<TopbarProps> = ({
  breadcrumbs,
  theme,
  isLiveConnected = false,
  isRecording = true,
  latencyMs = null,
  onToggleTheme,
  onOpenCommandPalette,
  onRetryConnection,
}) => {
  return (
    <header className="h-14 border-b border-fl-border bg-fl-canvas/90 backdrop-blur-sm px-6 flex items-center justify-between sticky top-0 z-30 transition-colors duration-150">
      {/* Breadcrumbs */}
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-xs">
        <span className="text-fl-muted font-medium">Workspace</span>
        {breadcrumbs.map((crumb, idx) => (
          <React.Fragment key={idx}>
            <span className="text-fl-muted/60" aria-hidden="true">/</span>
            <span
              className={`font-medium ${
                idx === breadcrumbs.length - 1 ? 'text-fl-ink font-semibold' : 'text-fl-secondary'
              }`}
            >
              {crumb}
            </span>
          </React.Fragment>
        ))}
      </nav>

      {/* Right Actions */}
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={onOpenCommandPalette}
          className="fl-tactile-btn flex items-center gap-2.5 px-3 py-1.5 rounded-lg bg-fl-surface border border-fl-border-strong/60 text-fl-secondary hover:text-fl-ink hover:border-fl-border-strong text-xs transition-colors shadow-subtle"
        >
          <Search className="w-3.5 h-3.5 text-fl-accent" aria-hidden="true" />
          <span className="hidden sm:inline">Search incidents...</span>
          <kbd className="px-1.5 py-0.5 text-[10px] font-mono font-medium bg-fl-surface-subtle border border-fl-border rounded text-fl-muted">
            ⌘K
          </kbd>
        </button>

        <button
          type="button"
          onClick={onRetryConnection}
          className={`hidden md:flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-[11px] font-mono font-medium transition-colors shadow-subtle fl-tactile-btn ${
            isLiveConnected
              ? 'bg-fl-surface border-fl-border text-fl-secondary hover:border-fl-border-strong'
              : 'bg-fl-warning-bg border-fl-warning-border text-fl-warning-text hover:brightness-105'
          }`}
          title={
            isLiveConnected
              ? `Live API connected at 127.0.0.1:3000 (${latencyMs ?? 1}ms)`
              : 'Backend API offline — operating with local fixtures. Click to reconnect.'
          }
        >
          <span
            className={`w-2 h-2 rounded-full ${
              isLiveConnected ? 'bg-fl-success-dot' : 'bg-fl-warning-dot'
            }`}
            aria-hidden="true"
          />
          <span>{isLiveConnected ? 'API Connected' : 'Local Mode'}</span>
          {isLiveConnected && !isRecording && (
            <span className="text-[10px] text-fl-warning-text px-1.5 py-0.5 bg-fl-warning-bg border border-fl-warning-border rounded">
              Paused
            </span>
          )}
          {isLiveConnected && latencyMs !== null && (
            <span className="text-[10px] text-fl-muted tabular-nums">{latencyMs}ms</span>
          )}
          {!isLiveConnected && <RefreshCw className="w-3 h-3 text-fl-warning-dot" aria-hidden="true" />}
        </button>

        <button
          type="button"
          onClick={onToggleTheme}
          className="fl-tactile-btn flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-fl-surface border border-fl-border-strong/60 hover:border-fl-border-strong text-fl-secondary hover:text-fl-ink text-xs font-medium transition-colors shadow-subtle font-sans"
          title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} mode`}
          aria-label={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} mode`}
        >
          {theme === 'dark' ? (
            <>
              <Sun className="w-3.5 h-3.5 text-fl-accent-text" aria-hidden="true" />
              <span className="hidden lg:inline">Light</span>
            </>
          ) : (
            <>
              <Moon className="w-3.5 h-3.5 text-fl-accent" aria-hidden="true" />
              <span className="hidden lg:inline">Dark</span>
            </>
          )}
        </button>

        <div className="w-px h-4 bg-fl-border mx-0.5" aria-hidden="true" />

        <div
          className="w-7 h-7 rounded-md bg-fl-accent-subtle border border-fl-accent-border text-fl-accent-text flex items-center justify-center text-[10px] font-semibold font-mono"
          title="Local Maintainer Session"
        >
          FL
        </div>
      </div>
    </header>
  );
};
