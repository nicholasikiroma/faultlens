import React, { useState } from 'react';
import { Sun, Moon, RotateCcw, Server, RefreshCw } from 'lucide-react';

interface SettingsViewProps {
  theme: 'dark' | 'light';
  isLiveConnected?: boolean;
  latencyMs?: number | null;
  onToggleTheme: () => void;
  onResetFixtures: () => void;
  onTestConnection?: () => Promise<void>;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  theme,
  isLiveConnected = false,
  latencyMs = null,
  onToggleTheme,
  onResetFixtures,
  onTestConnection,
}) => {
  const [testing, setTesting] = useState(false);

  const handleTest = async () => {
    if (onTestConnection) {
      setTesting(true);
      try {
        await onTestConnection();
      } finally {
        setTesting(false);
      }
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div className="pb-2 border-b border-ws-border">
        <div className="ws-eyebrow text-ws-accent mb-1 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-ws-accent animate-ping" />
          WORKSPACE PREFERENCES // DIAGNOSTIC CONFIG
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-ws-ink font-sans leading-tight">
          Preferences & Diagnostics
        </h1>
        <p className="text-[14px] text-ws-secondary mt-1 font-sans leading-relaxed">
          Configure visual appearance, live telemetry connections, and workstation diagnostic settings.
        </p>
      </div>

      {/* Settings Panel */}
      <div className="rounded-lg bg-ws-surface border border-ws-border shadow-subtle divide-y divide-ws-border">
        {/* Backend API Service Row */}
        <div className="p-5 flex items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Server className="w-4 h-4 text-ws-accent" />
              <span className="text-sm font-semibold text-ws-ink font-sans">Live Backend API Service</span>
              <span
                className={`text-[10px] font-mono font-medium px-2 py-0.5 rounded border uppercase ${
                  isLiveConnected
                    ? 'bg-ws-success-bg text-ws-success-text border-ws-success-border'
                    : 'bg-ws-warning-bg text-ws-warning-text border-ws-warning-border'
                }`}
              >
                {isLiveConnected ? `LIVE CONNECTED (${latencyMs ?? 1}ms)` : 'OFFLINE / LOCAL STANDBY'}
              </span>
            </div>
            <p className="text-xs font-sans text-ws-secondary mt-0.5 leading-relaxed">
              Hono HTTP service on <code className="font-mono text-ws-ink">127.0.0.1:3000</code>. Provides live telemetry, real-time triage queue, and deterministic classification.
            </p>
          </div>
          <button
            onClick={handleTest}
            disabled={testing}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-ws-surface-subtle border border-ws-border hover:border-ws-border-strong text-xs font-medium font-sans hover:bg-ws-surface-elevated text-ws-ink transition-colors flex-shrink-0 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${testing ? 'animate-spin text-ws-accent' : 'text-ws-muted'}`} />
            <span>{testing ? 'Testing...' : 'Test Connection'}</span>
          </button>
        </div>

        {/* Appearance Row */}
        <div className="p-5 flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-ws-ink font-sans">Visual Appearance</div>
            <p className="text-xs font-sans text-ws-secondary mt-0.5 leading-relaxed">
              Switch between Bright White (Light Mode) and Pure Pitch Black + High Contrast (Dark Mode).
            </p>
          </div>
          <button
            onClick={onToggleTheme}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-md bg-ws-surface-subtle border border-ws-border hover:border-ws-border-strong text-xs font-medium font-sans hover:bg-ws-surface-elevated text-ws-ink transition-colors flex-shrink-0"
          >
            {theme === 'dark' ? (
              <>
                <Sun className="w-3.5 h-3.5 text-ws-accent" />
                <span>Switch to Light Mode</span>
              </>
            ) : (
              <>
                <Moon className="w-3.5 h-3.5 text-ws-accent" />
                <span>Switch to Dark Mode</span>
              </>
            )}
          </button>
        </div>

        {/* Environment Row */}
        <div className="p-5 flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-ws-ink font-sans">Environment Mode</div>
            <p className="text-xs font-sans text-ws-secondary mt-0.5 leading-relaxed">
              Current workstation execution target and data boundary.
            </p>
          </div>
          <span className="px-2.5 py-1 text-[11px] font-mono font-medium uppercase bg-ws-accent-subtle border border-ws-accent-border text-ws-accent rounded flex-shrink-0">
            LOCAL DEMO WORKSTATION
          </span>
        </div>

        {/* Raw Payload Retention Row */}
        <div className="p-5 flex items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-ws-ink font-sans">Raw Payload Retention</span>
              <span className="text-[10px] font-mono font-medium uppercase text-ws-success-text bg-ws-success-bg border border-ws-success-border px-1.5 py-0.5 rounded">
                SAFE DEFAULT
              </span>
            </div>
            <p className="text-xs font-sans text-ws-secondary mt-0.5 leading-relaxed">
              Only stores cryptographic digests, timestamps, and redacted metadata. Secrets are masked at ingress.
            </p>
          </div>
          <span className="text-xs font-mono font-medium text-ws-secondary flex-shrink-0 uppercase">
            OFF (REDACTED ONLY)
          </span>
        </div>

        {/* AI Bounded Diagnostics Row */}
        <div className="p-5 flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-ws-ink font-sans">Bounded AI Investigation</div>
            <p className="text-xs font-sans text-ws-secondary mt-0.5 leading-relaxed">
              Deterministic rule signatures run first; model analysis is read-only and restricted to current incident.
            </p>
          </div>
          <span className="text-[11px] font-mono font-medium uppercase text-ws-accent flex-shrink-0">
            ENABLED (BOUNDED)
          </span>
        </div>

        {/* Reset Fixtures Row */}
        <div className="p-5 flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-ws-danger-text font-sans">Reset Demo Fixtures</div>
            <p className="text-xs font-sans text-ws-secondary mt-0.5 leading-relaxed">
              Restore initial seed incidents and clear simulated playground incidents.
            </p>
          </div>
          <button
            onClick={onResetFixtures}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-ws-danger-bg border border-ws-danger-border text-ws-danger-text hover:opacity-90 text-xs font-medium font-sans transition-opacity flex-shrink-0"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset Fixtures</span>
          </button>
        </div>
      </div>
    </div>
  );
};
