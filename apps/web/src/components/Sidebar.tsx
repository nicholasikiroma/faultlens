import React from 'react';
import { LayoutGrid, AlertCircle, Plug, Play, Settings, Radio, Disc3, Trash2, Power, Terminal } from 'lucide-react';

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
  onShowToast?: (msg: string) => void;
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
  onShowToast,
}) => {
  const safeBufferKb = typeof bufferKb === 'number' && !isNaN(bufferKb) ? bufferKb : 4.8;

  const formatTimer = (totalSec?: number) => {
    const sec = Math.max(0, Math.floor(totalSec || 0));
    const hrs = Math.floor(sec / 3600);
    const mins = Math.floor((sec % 3600) / 60);
    const secs = sec % 60;
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const handleToggleRecord = () => {
    if (onToggleRecording) {
      onToggleRecording();
    }
  };

  const handleFlush = () => {
    if (onFlushBuffer) {
      onFlushBuffer();
    }
  };

  const navChannels = [
    { id: 'overview', num: '01', label: 'Overview', icon: LayoutGrid },
    { id: 'incidents', num: '02', label: 'Triage Queue', icon: AlertCircle, count: openIncidentsCount },
    { id: 'integrations', num: '03', label: 'Probes & Sources', icon: Plug },
    { id: 'playground', num: '04', label: 'Simulation Lab', icon: Play },
    { id: 'settings', num: '05', label: 'Preferences', icon: Settings },
  ];

  return (
    <aside className="w-64 bg-ws-sidebar border-r border-ws-border h-screen sticky top-0 flex flex-col justify-between p-4 flex-shrink-0 select-none overflow-y-auto transition-colors duration-150">
      <div className="space-y-6">
        {/* 1. Strong Brand Header */}
        <div className="flex items-center gap-3 px-1.5 py-1">
          <div className="w-9 h-9 rounded-lg bg-ws-surface border border-ws-border flex items-center justify-center shadow-subtle relative overflow-hidden group">
            <Radio className="w-4 h-4 text-ws-accent relative z-10" />
            <div className="absolute inset-0 bg-ws-accent/10 opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-base font-bold tracking-tight text-ws-ink font-sans">
                Wire<span className="text-ws-accent">Sleuth</span>
              </span>
              <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-ws-surface border border-ws-border text-ws-muted font-medium">
                WS-24
              </span>
            </div>
            <div className="text-[10px] font-mono tracking-wider text-ws-muted uppercase flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-ws-accent" />
              PASSIVE WIRE TAP
            </div>
          </div>
        </div>

        {/* 2. Recognizable Flight Deck Cassette Recorder Pod (Hardware Aesthetic) */}
        <div className="p-3.5 rounded-xl bg-ws-surface border border-ws-border shadow-subtle space-y-3 relative group">
          {/* Deck Ticker Header */}
          <div className="flex items-center justify-between text-[10px] font-mono">
            <div className="flex items-center gap-1.5">
              <span
                className={`w-2 h-2 rounded-full ${
                  isRecording ? 'bg-ws-success-dot animate-pulse' : 'bg-ws-warning-dot'
                }`}
              />
              <span
                className={`font-semibold tracking-wider ${
                  isRecording ? 'text-ws-success-text' : 'text-ws-warning-text'
                }`}
              >
                {isRecording ? 'REC ACTIVE' : 'ARMED STANDBY'}
              </span>
            </div>
            <span className="text-ws-secondary font-mono tabular-nums font-medium">
              {formatTimer(uptimeSeconds)}
            </span>
          </div>

          {/* SVG Cassette Reels Display */}
          <div className="relative h-12 bg-ws-surface-subtle rounded-lg border border-ws-border flex items-center justify-around px-4 overflow-hidden">
            {/* Magnetic Tape Line */}
            <div className="absolute top-1/2 left-8 right-8 h-0.5 bg-ws-border -translate-y-1/2" />

            {/* Left Reel */}
            <div className="relative z-10 flex flex-col items-center">
              <Disc3
                className={`w-6 h-6 text-ws-accent transition-transform duration-300 ${
                  isRecording ? 'animate-spin-reel' : 'opacity-40'
                }`}
              />
            </div>

            {/* Center Tape Read/Write Head */}
            <div className="relative z-10 w-4 h-5 rounded bg-ws-surface border border-ws-border flex items-center justify-center shadow-subtle">
              <div className={`w-1 h-2 rounded-full ${isRecording ? 'bg-ws-accent animate-pulse' : 'bg-ws-muted'}`} />
            </div>

            {/* Right Reel */}
            <div className="relative z-10 flex flex-col items-center">
              <Disc3
                className={`w-6 h-6 text-ws-accent transition-transform duration-300 ${
                  isRecording ? 'animate-spin-reel-rev' : 'opacity-40'
                }`}
              />
            </div>
          </div>

          {/* Ingress Buffer Telemetry Meter */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[10px] font-mono text-ws-muted">
              <span>BUFFER // ALS-STREAM</span>
              <span className="text-ws-secondary font-medium tabular-nums">{safeBufferKb.toFixed(1)} / 64 KB</span>
            </div>
            {/* 8-Segment Hardware Meter */}
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5, 6, 7, 8].map((seg) => {
                const threshold = (seg / 8) * 64;
                const isFilled = safeBufferKb >= threshold * 0.5;
                const color =
                  seg >= 7
                    ? 'bg-ws-danger-dot'
                    : seg >= 5
                    ? 'bg-ws-warning-dot'
                    : 'bg-ws-success-dot';
                return (
                  <div
                    key={seg}
                    className={`h-1 flex-1 rounded-sm transition-colors ${
                      isFilled ? color : 'bg-ws-border'
                    }`}
                  />
                );
              })}
            </div>
          </div>

          {/* Tactile Hardware Action Buttons */}
          <div className="pt-1 flex items-center gap-2">
            <button
              onClick={handleToggleRecord}
              className={`flex-1 py-1 px-2 rounded-md border text-[11px] font-mono font-medium flex items-center justify-center gap-1.5 transition-all ws-tactile-btn ${
                isRecording
                  ? 'bg-ws-surface-subtle border-ws-border text-ws-secondary hover:text-ws-ink hover:border-ws-border-strong'
                  : 'bg-ws-btn-primary text-ws-btn-primary-ink border-ws-btn-primary-border shadow-subtle'
              }`}
            >
              <Power className="w-3 h-3" />
              <span>{isRecording ? 'Pause Tap' : 'Arm Tap'}</span>
            </button>

            {onFlushBuffer && (
              <button
                onClick={handleFlush}
                className="py-1 px-2 rounded-md bg-ws-surface-subtle border border-ws-border text-ws-muted hover:text-ws-danger-text hover:border-ws-danger-border text-[11px] font-mono transition-colors ws-tactile-btn"
                title="Flush Telemetry Ringbuffer"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {/* 3. Navigation Channels with Clean Architectural Visual Hierarchy */}
        <div className="space-y-1">
          <div className="text-[10px] font-mono font-semibold text-ws-muted uppercase tracking-wider px-2 mb-2">
            BUS CHANNELS // ROUTING
          </div>

          {navChannels.map((item) => {
            const isActive =
              currentPage === item.id ||
              (item.id === 'incidents' && currentPage === 'investigation');
            const Icon = item.icon;

            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-[13px] font-sans font-medium transition-all group relative ${
                  isActive
                    ? 'bg-ws-surface text-ws-ink font-semibold shadow-subtle border border-ws-border'
                    : 'text-ws-secondary hover:text-ws-ink hover:bg-ws-surface/70 border border-transparent'
                }`}
              >
                {/* Active Indicator Notch */}
                {isActive && (
                  <span className="absolute -left-1.5 top-1/2 -translate-y-1/2 w-1.5 h-4 bg-ws-accent rounded-r-sm shadow-subtle" />
                )}

                <div className="flex items-center gap-2.5">
                  <span
                    className={`text-[10px] font-mono tabular-nums transition-colors ${
                      isActive ? 'text-ws-accent font-semibold' : 'text-ws-muted group-hover:text-ws-secondary'
                    }`}
                  >
                    [{item.num}]
                  </span>
                  <Icon
                    className={`w-4 h-4 transition-colors ${
                      isActive ? 'text-ws-accent' : 'text-ws-muted group-hover:text-ws-secondary'
                    }`}
                  />
                  <span className="tracking-normal">{item.label}</span>
                </div>

                {/* Semantic Alert Pill */}
                {item.count !== undefined && item.count > 0 && (
                  <span className="flex items-center gap-1 px-1.5 py-0.2 text-[10px] font-mono font-semibold tabular-nums rounded bg-ws-danger-bg border border-ws-danger-border text-ws-danger-text">
                    <span className="w-1.5 h-1.5 rounded-full bg-ws-danger-dot animate-pulse" />
                    <span>0{item.count}</span>
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* 4. Footer Hardware Spec Plate */}
      <div className="pt-4 border-t border-ws-border space-y-2">
        <div className="p-2.5 rounded-lg bg-ws-surface border border-ws-border flex items-center justify-between shadow-subtle text-xs">
          <div>
            <div className="text-ws-ink font-mono font-medium text-[10px] tracking-wider">ALS-TAP // ZERO DROP</div>
            <div className="text-ws-muted font-sans text-[11px]">Passive Undici Stream</div>
          </div>
          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-ws-surface-subtle text-ws-accent font-semibold border border-ws-border">
            100% OK
          </span>
        </div>

        <div className="px-1 flex items-center justify-between text-[11px] text-ws-muted font-sans">
          <span className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${isLiveConnected ? 'bg-ws-success-dot animate-pulse' : 'bg-ws-warning-dot'}`} />
            <span className="font-mono text-[10px]">{isLiveConnected ? '127.0.0.1:3000' : 'SIMULATOR'}</span>
          </span>
          <span className="font-sans text-[11px]">{isLiveConnected ? 'Online' : 'Standby'}</span>
        </div>
      </div>
    </aside>
  );
};
