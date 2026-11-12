import React, { useState, useEffect } from 'react';
import { LayoutGrid, AlertCircle, Plug, Play, Settings, Radio, Disc3, Trash2 } from 'lucide-react';

interface SidebarProps {
  currentPage: string;
  onNavigate: (page: string) => void;
  openIncidentsCount: number;
  onShowToast?: (msg: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentPage,
  onNavigate,
  openIncidentsCount,
  onShowToast,
}) => {
  const [isRecording, setIsRecording] = useState(true);
  const [seconds, setSeconds] = useState(14 * 60 + 32);
  const [bufferKb, setBufferKb] = useState(4.8);

  useEffect(() => {
    if (!isRecording) return;
    const interval = setInterval(() => {
      setSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [isRecording]);

  const formatTimer = (totalSec: number) => {
    const hrs = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const handleToggleRecord = () => {
    const nextState = !isRecording;
    setIsRecording(nextState);
    if (onShowToast) {
      onShowToast(nextState ? 'Passive Wire Recorder: RESUMED (Active Stream Tap)' : 'Passive Wire Recorder: ARMED (Standby Mode)');
    }
  };

  const handleFlushBuffer = () => {
    setBufferKb(0.0);
    if (onShowToast) {
      onShowToast('Flushed telemetry ingress buffer (0.0 KB / 64 KB).');
    }
    setTimeout(() => setBufferKb(1.2), 2500);
  };

  const navChannels = [
    { id: 'overview', num: '01', label: 'OVERVIEW', icon: LayoutGrid },
    { id: 'incidents', num: '02', label: 'TRIAGE QUEUE', icon: AlertCircle, count: openIncidentsCount },
    { id: 'integrations', num: '03', label: 'PROBES & SOURCES', icon: Plug },
    { id: 'playground', num: '04', label: 'SIMULATION LAB', icon: Play },
    { id: 'settings', num: '05', label: 'PREFERENCES', icon: Settings },
  ];

  return (
    <aside className="w-64 bg-ws-sidebar border-r border-ws-border h-screen sticky top-0 flex flex-col justify-between p-4 flex-shrink-0 select-none overflow-y-auto transition-colors duration-150">
      <div className="space-y-5">
        {/* Brand Header */}
        <div className="flex items-center gap-3 px-1 py-1">
          <div className="w-8 h-8 rounded-md bg-ws-surface border border-ws-border flex items-center justify-center shadow-subtle">
            <Radio className="w-4 h-4 text-ws-accent" />
          </div>
          <div>
            <div className="flex items-baseline gap-1 text-sm font-bold tracking-tight text-ws-ink font-mono">
              <span>WIRE</span>
              <span className="text-ws-accent">SLEUTH</span>
            </div>
            <div className="text-[9px] font-mono tracking-widest text-ws-muted uppercase">
              REC // OBS-NODE 01
            </div>
          </div>
        </div>

        {/* Flight Deck Telemetry Pod */}
        <div
          onClick={handleToggleRecord}
          className="p-3 rounded-lg bg-ws-surface border border-ws-border shadow-subtle cursor-pointer hover:border-ws-border-strong transition-colors group"
          title="Click to toggle passive wire recording / standby"
        >
          {/* Deck Ticker Header */}
          <div className="flex items-center justify-between text-[10px] font-mono mb-2">
            <div className="flex items-center gap-1.5">
              <span
                className={`w-2 h-2 rounded-full ${
                  isRecording ? 'bg-ws-success-dot' : 'bg-ws-warning-dot'
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
            <span className="text-ws-secondary font-mono tabular-nums">
              {formatTimer(seconds)}
            </span>
          </div>

          {/* SVG Cassette Reels Display */}
          <div className="relative h-11 bg-ws-surface-subtle rounded-md border border-ws-border-subtle flex items-center justify-around px-4 overflow-hidden">
            <div className="absolute top-1/2 left-8 right-8 h-px bg-ws-border -translate-y-1/2" />

            {/* Left Reel */}
            <div className="relative z-10 flex flex-col items-center">
              <Disc3
                className={`w-5 h-5 text-ws-accent transition-transform ${
                  isRecording ? 'animate-spin-reel' : 'opacity-40'
                }`}
              />
            </div>

            {/* Center Tape Head */}
            <div className="relative z-10 w-3 h-4 rounded-sm bg-ws-surface border border-ws-border flex items-center justify-center">
              <div className="w-1 h-1.5 bg-ws-accent rounded-full" />
            </div>

            {/* Right Reel */}
            <div className="relative z-10 flex flex-col items-center">
              <Disc3
                className={`w-5 h-5 text-ws-accent transition-transform ${
                  isRecording ? 'animate-spin-reel-rev' : 'opacity-40'
                }`}
              />
            </div>
          </div>

          {/* Ingress Buffer Telemetry Meter */}
          <div className="mt-2.5 space-y-1.5">
            <div className="flex items-center justify-between text-[9px] font-mono text-ws-muted">
              <span>BUFFER // ALS-STREAM</span>
              <span className="text-ws-secondary font-medium tabular-nums">{bufferKb.toFixed(1)} / 64 KB</span>
            </div>
            {/* 7-Segment Hardware Bar */}
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((seg) => (
                <div
                  key={seg}
                  className={`h-1 flex-1 rounded-sm transition-colors ${
                    bufferKb > 0 ? 'bg-ws-success-dot' : 'bg-ws-border'
                  }`}
                />
              ))}
              <div
                className={`h-1 flex-1 rounded-sm transition-colors ${
                  bufferKb > 40 ? 'bg-ws-warning-dot' : 'bg-ws-border'
                }`}
              />
              <div
                className={`h-1 flex-1 rounded-sm transition-colors ${
                  bufferKb > 55 ? 'bg-ws-danger-dot' : 'bg-ws-border'
                }`}
              />
            </div>
          </div>
        </div>

        {/* Channel Rack Navigation with Vertical Bus Track */}
        <div className="relative pl-3">
          {/* Vertical Bus Line */}
          <div className="absolute left-1 top-2 bottom-2 w-px bg-ws-border" />

          <div className="space-y-1">
            <div className="text-[9px] font-mono font-semibold text-ws-muted uppercase tracking-widest pl-2 mb-2">
              BUS CHANNELS
            </div>

            {navChannels.map((item) => {
              const isActive =
                currentPage === item.id ||
                (item.id === 'incidents' && currentPage === 'investigation');
              const Icon = item.icon;

              return (
                <div key={item.id} className="relative group">
                  {/* Active Sage Notch Marker */}
                  {isActive && (
                    <div className="absolute -left-[9px] top-1/2 -translate-y-1/2 w-1 h-4 bg-ws-accent rounded-sm" />
                  )}

                  <button
                    onClick={() => onNavigate(item.id)}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-xs font-mono transition-colors ${
                      isActive
                        ? 'bg-ws-accent-subtle text-ws-ink font-semibold border border-ws-accent-border'
                        : 'text-ws-secondary hover:text-ws-ink hover:bg-ws-surface/70 border border-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <span
                        className={`text-[10px] font-mono font-medium transition-colors ${
                          isActive ? 'text-ws-accent' : 'text-ws-muted group-hover:text-ws-secondary'
                        }`}
                      >
                        [{item.num}]
                      </span>
                      <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-ws-accent' : 'text-ws-muted group-hover:text-ws-secondary'}`} />
                      <span className="text-[11px] tracking-wide">{item.label}</span>
                    </div>

                    {/* Semantic Alert Pill */}
                    {item.count !== undefined && item.count > 0 && (
                      <span className="flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-mono font-semibold rounded bg-ws-danger-bg border border-ws-danger-border text-ws-danger-text">
                        <span className="w-1.5 h-1.5 rounded-full bg-ws-danger-dot" />
                        <span>0{item.count}</span>
                      </span>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Footer Spec Plate & Hardware Actions */}
      <div className="pt-4 mt-6 border-t border-ws-border space-y-2.5">
        <div className="p-2.5 rounded-md bg-ws-surface border border-ws-border flex items-center justify-between font-mono text-[10px]">
          <div>
            <div className="text-ws-ink font-medium tracking-wider">WS-REC // ALS-V2</div>
            <div className="text-ws-muted text-[9px]">ACTIVE SOCKET MONITOR</div>
          </div>
          <button
            onClick={handleFlushBuffer}
            className="p-1.5 rounded text-ws-muted hover:text-ws-ink hover:bg-ws-surface-elevated transition-colors"
            title="Flush Ingress Telemetry Buffer"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="px-1.5 flex items-center justify-between text-[10px] font-mono text-ws-muted">
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-ws-success-dot" />
            <span>127.0.0.1:3000</span>
          </span>
          <span>ENTERPRISE</span>
        </div>
      </div>
    </aside>
  );
};
