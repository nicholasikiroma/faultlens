import React from 'react';
import {
  LayoutGrid,
  AlertCircle,
  Plug,
  Play,
  Settings,
  Pause,
  RefreshCw,
} from 'lucide-react';

interface SidebarProps {
  currentPage: string;
  onNavigate: (page: string) => void;
  openIncidentsCount: number;
  isLiveConnected?: boolean;
  isRecording?: boolean;
  uptimeSeconds?: number;
  bufferKb?: number;
  onToggleRecording?: () => void;
  onFlushBuffer?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentPage = 'overview',
  onNavigate,
  openIncidentsCount = 0,
  isLiveConnected = false,
  isRecording = true,
  uptimeSeconds = 0,
  bufferKb = 4.8,
  onToggleRecording,
  onFlushBuffer,
}) => {
  const safeBufferKb = typeof bufferKb === 'number' && !isNaN(bufferKb) ? bufferKb : 4.8;

  const formatTimer = (totalSec?: number) => {
    const sec = Math.max(0, Math.floor(totalSec || 0));
    const hrs = Math.floor(sec / 3600);
    const mins = Math.floor((sec % 3600) / 60);
    const secs = sec % 60;
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const navChannels = [
    { id: 'overview', label: 'Overview', icon: LayoutGrid },
    { id: 'incidents', label: 'Incidents', icon: AlertCircle, count: openIncidentsCount },
    { id: 'integrations', label: 'Integrations', icon: Plug },
    { id: 'playground', label: 'Playground', icon: Play },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    <aside className="w-60 bg-fl-sidebar border-r border-fl-border h-screen sticky top-0 flex flex-col justify-between p-4 flex-shrink-0 select-none overflow-y-auto transition-colors duration-150">
      <div className="space-y-6">
        {/* Brand Header */}
        <div className="flex items-center gap-2.5 px-1.5 py-1">
          <div className="w-8 h-8 rounded-lg bg-fl-surface border border-fl-border flex items-center justify-center shadow-subtle shrink-0">
            <svg
              viewBox="0 0 24 24"
              className="w-4.5 h-4.5"
              fill="none"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="6.5" className="stroke-fl-accent" strokeWidth="2" />
              <path
                d="M7.5 11h1.6l1.1-2.2 1.4 4.2 1-2h1.9"
                className="stroke-fl-ink"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="m16 16 4 4"
                className="stroke-fl-accent"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[15px] font-semibold tracking-tight text-fl-ink font-sans">
                Fault<span className="text-fl-accent-text">Lens</span>
              </span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-fl-surface border border-fl-border text-fl-muted font-medium">
                OSS
              </span>
            </div>
            <div className="text-[10px] font-mono tracking-wider text-fl-muted uppercase">
              Incident Console
            </div>
          </div>
        </div>

        {/* Navigation Links */}
        <nav className="space-y-1" aria-label="Primary navigation">
          <div className="text-[10px] font-mono font-semibold text-fl-muted uppercase tracking-wider px-2.5 pb-1">
            Workspace
          </div>

          {navChannels.map((item) => {
            const isActive =
              currentPage === item.id ||
              (item.id === 'incidents' && currentPage === 'investigation');
            const Icon = item.icon;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-[13px] font-sans font-medium transition-colors relative ${
                  isActive
                    ? 'bg-fl-surface text-fl-ink font-semibold shadow-subtle border border-fl-border'
                    : 'text-fl-secondary hover:text-fl-ink hover:bg-fl-surface/60 border border-transparent'
                }`}
              >
                {isActive && (
                  <span
                    className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-4 bg-fl-accent rounded-r-full"
                    aria-hidden="true"
                  />
                )}

                <div className="flex items-center gap-2.5">
                  <Icon
                    className={`w-4 h-4 ${
                      isActive ? 'text-fl-accent' : 'text-fl-muted'
                    }`}
                    aria-hidden="true"
                  />
                  <span>{item.label}</span>
                </div>

                {item.count !== undefined && item.count > 0 && (
                  <span className="px-1.5 py-0.5 text-[10px] font-mono font-semibold tabular-nums rounded bg-fl-danger-bg border border-fl-danger-border text-fl-danger-text">
                    {item.count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Compact Ingestion & Worker Health Widget */}
      <div className="pt-4 border-t border-fl-border space-y-3">
        <div className="p-3 rounded-xl bg-fl-surface border border-fl-border shadow-subtle space-y-2.5">
          <div className="flex items-center justify-between text-[11px] font-mono">
            <span className="flex items-center gap-1.5 font-medium text-fl-ink">
              <span
                className={`w-2 h-2 rounded-full ${
                  isRecording
                    ? isLiveConnected
                      ? 'bg-fl-success-dot'
                      : 'bg-fl-accent'
                    : 'bg-fl-warning-dot'
                }`}
                aria-hidden="true"
              />
              {isRecording ? (isLiveConnected ? 'Live Stream' : 'Simulator') : 'Standby'}
            </span>
            <span className="text-fl-muted tabular-nums">{formatTimer(uptimeSeconds)}</span>
          </div>

          <div className="flex items-center justify-between text-[11px] font-sans text-fl-secondary">
            <span>Rule engine</span>
            <span className="font-mono text-fl-success-text font-medium">Ready</span>
          </div>

          <div className="flex items-center justify-between text-[11px] font-sans text-fl-secondary">
            <span>Session cache</span>
            <span className="font-mono text-fl-muted tabular-nums">{safeBufferKb.toFixed(1)} KB</span>
          </div>

          <div className="pt-1 flex items-center gap-1.5">
            {onToggleRecording && (
              <button
                type="button"
                onClick={onToggleRecording}
                className="fl-tactile-btn flex-1 py-1.5 px-2 rounded-md bg-fl-surface-subtle border border-fl-border hover:border-fl-border-strong text-[11px] font-sans font-medium text-fl-secondary hover:text-fl-ink flex items-center justify-center gap-1.5 transition-colors"
              >
                {isRecording ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                <span>{isRecording ? 'Pause' : 'Resume'}</span>
              </button>
            )}
            {onFlushBuffer && (
              <button
                type="button"
                onClick={onFlushBuffer}
                className="fl-tactile-btn py-1.5 px-2 rounded-md bg-fl-surface-subtle border border-fl-border hover:border-fl-border-strong text-fl-muted hover:text-fl-ink transition-colors"
                title="Refresh incident stream"
                aria-label="Refresh incident stream"
              >
                <RefreshCw className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        <div className="px-1 flex items-center justify-between text-[11px] text-fl-muted font-mono">
          <span>{isLiveConnected ? '127.0.0.1:3000' : 'local-fixtures'}</span>
          <span>{isLiveConnected ? 'API OK' : 'Offline'}</span>
        </div>
      </div>
    </aside>
  );
};
