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
          className="ws-tactile-btn flex items-center gap-2.5 px-3 py-1.5 rounded-lg bg-ws-surface border border-ws-border text-ws-secondary hover:text-ws-ink hover:border-ws-border-strong text-xs transition-colors shadow-subtle"
        >
          <Search className="w-3.5 h-3.5 text-ws-accent" />
          <span className="hidden sm:inline">Search & command...</span>
          <kbd className="px-1.5 py-0.5 text-[10px] font-mono font-medium bg-ws-surface-subtle border border-ws-border rounded text-ws-muted">
            ⌘K
          </kbd>
        </button>

        {/* Dynamic Live API / Local Simulator Status Pill */}
        <button
          onClick={onRetryConnection}
          className={`hidden md:flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-[11px] font-mono font-medium transition-colors shadow-subtle ws-tactile-btn ${
            isLiveConnected
              ? 'bg-ws-surface border-ws-border text-ws-secondary hover:border-ws-border-strong'
              : 'bg-ws-warning-bg/40 border-ws-warning-border text-ws-warning-text hover:bg-ws-warning-bg/60 cursor-pointer'
          }`}
          title={
            isLiveConnected
              ? `Live API connected at 127.0.0.1:3000 (Ping: ${latencyMs ?? 1}ms) • Ingress Streaming: Active (3s)`
              : 'Backend API offline — operating in Local Simulator Mode. Click to reconnect.'
          }
        >
          <span
            className={`w-2 h-2 rounded-full ${
              isLiveConnected ? 'bg-ws-success-dot animate-pulse' : 'bg-ws-warning-dot'
            }`}
          />
          <span>{isLiveConnected ? 'LIVE API: CONNECTED' : 'LOCAL SIMULATOR: ARMED'}</span>
          {isLiveConnected && isRecording && (
            <span className="inline-flex items-center gap-1 text-[10px] text-ws-accent font-semibold px-1.5 py-0.5 bg-ws-surface-subtle border border-ws-border rounded">
              <span className="w-1.5 h-1.5 rounded-full bg-ws-accent animate-ping" />
              STREAMING (3s)
            </span>
          )}
          {isLiveConnected && !isRecording && (
            <span className="inline-flex items-center gap-1 text-[10px] text-ws-warning-text font-semibold px-1.5 py-0.5 bg-ws-warning-bg border border-ws-warning-border rounded">
              <span className="w-1.5 h-1.5 rounded-full bg-ws-warning-dot" />
              PAUSED (STANDBY)
            </span>
          )}
          {isLiveConnected && latencyMs !== null && (
            <span className="text-[10px] text-ws-muted tabular-nums">({latencyMs}ms)</span>
          )}
          {!isLiveConnected && <RefreshCw className="w-3 h-3 text-ws-warning-dot" />}
        </button>

        {/* Theme Switcher */}
        <button
          onClick={onToggleTheme}
          className="ws-tactile-btn flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-ws-surface border border-ws-border hover:border-ws-border-strong text-ws-secondary hover:text-ws-ink text-xs font-medium transition-colors shadow-subtle font-sans"
          title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} mode`}
          aria-label={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} mode`}
        >
          {theme === 'dark' ? (
            <>
              <Sun className="w-3.5 h-3.5 text-ws-accent" />
              <span className="hidden lg:inline text-xs font-medium font-sans">Light</span>
            </>
          ) : (
            <>
              <Moon className="w-3.5 h-3.5 text-ws-accent" />
              <span className="hidden lg:inline text-xs font-medium font-sans">Dark</span>
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
