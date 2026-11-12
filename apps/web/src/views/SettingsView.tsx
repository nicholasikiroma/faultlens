import React from 'react';
import { Sun, Moon, RotateCcw } from 'lucide-react';

interface SettingsViewProps {
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  onResetFixtures: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  theme,
  onToggleTheme,
  onResetFixtures,
}) => {
  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div>
        <div className="text-[10px] font-mono font-semibold tracking-widest text-ws-accent uppercase">
          WORKSPACE PREFERENCES
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-ws-ink mt-0.5">Settings</h1>
        <p className="text-xs text-ws-secondary mt-1">
          Configure visual appearance, telemetry retention rules, and workstation diagnostic settings.
        </p>
      </div>

      {/* Settings Panel */}
      <div className="rounded-lg bg-ws-surface border border-ws-border shadow-subtle divide-y divide-ws-border">
        {/* Appearance Row */}
        <div className="p-5 flex items-center justify-between gap-4">
          <div>
            <div className="text-xs font-bold text-ws-ink">Visual Appearance</div>
            <p className="text-xs text-ws-secondary mt-0.5">
              Switch between Graphite + Soft Sage (Dark Mode) and Warm Neutral + Muted Sage (Light Mode).
            </p>
          </div>
          <button
            onClick={onToggleTheme}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-md bg-ws-surface-subtle border border-ws-border hover:border-ws-border-strong text-xs font-semibold hover:bg-ws-surface-elevated text-ws-ink transition-colors flex-shrink-0"
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
            <div className="text-xs font-bold text-ws-ink">Environment Mode</div>
            <p className="text-xs text-ws-secondary mt-0.5">
              Current workstation execution target and data boundary.
            </p>
          </div>
          <span className="px-2.5 py-1 text-xs font-mono font-semibold bg-ws-accent-subtle border border-ws-accent-border text-ws-accent rounded flex-shrink-0">
            LOCAL DEMO WORKSTATION
          </span>
        </div>

        {/* Raw Payload Retention Row */}
        <div className="p-5 flex items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-ws-ink">Raw Payload Retention</span>
              <span className="text-[10px] font-mono font-semibold text-ws-success-text bg-ws-success-bg border border-ws-success-border px-1.5 py-0.5 rounded">
                SAFE DEFAULT
              </span>
            </div>
            <p className="text-xs text-ws-secondary mt-0.5">
              Only stores cryptographic digests, timestamps, and redacted metadata. Secrets are masked at ingress.
            </p>
          </div>
          <span className="text-xs font-mono font-medium text-ws-secondary flex-shrink-0">
            OFF (REDACTED ONLY)
          </span>
        </div>

        {/* AI Bounded Diagnostics Row */}
        <div className="p-5 flex items-center justify-between gap-4">
          <div>
            <div className="text-xs font-bold text-ws-ink">Bounded AI Investigation</div>
            <p className="text-xs text-ws-secondary mt-0.5">
              Deterministic rule signatures run first; model analysis is read-only and restricted to current incident.
            </p>
          </div>
          <span className="text-xs font-mono font-semibold text-ws-accent flex-shrink-0">
            ENABLED (BOUNDED)
          </span>
        </div>

        {/* Reset Fixtures Row */}
        <div className="p-5 flex items-center justify-between gap-4">
          <div>
            <div className="text-xs font-bold text-ws-danger-text">Reset Demo Fixtures</div>
            <p className="text-xs text-ws-secondary mt-0.5">
              Restore initial seed incidents and clear simulated playground incidents.
            </p>
          </div>
          <button
            onClick={onResetFixtures}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-ws-danger-bg border border-ws-danger-border text-ws-danger-text hover:opacity-90 text-xs font-semibold transition-opacity flex-shrink-0"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset Fixtures</span>
          </button>
        </div>
      </div>
    </div>
  );
};
