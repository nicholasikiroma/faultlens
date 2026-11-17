import React, { useState } from 'react';
import type { AgentSettingsSummary } from '../types';
import { Button, PageHeader, Panel } from '../components/ui';
import { Sun, Moon, RotateCcw, Server, RefreshCw } from 'lucide-react';

interface SettingsViewProps {
  theme: 'dark' | 'light';
  isLiveConnected?: boolean;
  latencyMs?: number | null;
  agentSettings?: AgentSettingsSummary | null;
  onToggleTheme: () => void;
  onResetFixtures: () => void;
  onTestConnection?: () => Promise<void>;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  theme,
  isLiveConnected = false,
  latencyMs = null,
  agentSettings = null,
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
      <PageHeader
        eyebrow="Workspace Preferences"
        title="Settings"
        description="Configure visual appearance, live backend connectivity, and workstation diagnostic defaults."
      />

      <Panel padding="none" className="divide-y divide-fl-border">
        <div className="p-5 flex items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Server className="w-4 h-4 text-fl-accent" aria-hidden="true" />
              <span className="text-fl-card text-fl-ink font-sans">Backend API Service</span>
              <span
                className={`text-[10px] font-mono font-medium px-2 py-0.5 rounded border uppercase ${
                  isLiveConnected
                    ? 'bg-fl-success-bg text-fl-success-text border-fl-success-border'
                    : 'bg-fl-warning-bg text-fl-warning-text border-fl-warning-border'
                }`}
              >
                {isLiveConnected ? `Connected (${latencyMs ?? 1}ms)` : 'Offline / Local Mode'}
              </span>
            </div>
            <p className="text-xs font-sans text-fl-secondary mt-1 leading-relaxed">
              Hono HTTP service on <code className="font-mono text-fl-ink">127.0.0.1:3000</code> providing
              live triage queries and deterministic classification.
            </p>
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={handleTest}
            disabled={testing}
            leadingIcon={
              <RefreshCw
                className={`w-3.5 h-3.5 ${testing ? 'animate-spin text-fl-accent' : 'text-fl-muted'}`}
              />
            }
          >
            {testing ? 'Testing...' : 'Test Connection'}
          </Button>
        </div>

        <div className="p-5 flex items-center justify-between gap-4">
          <div>
            <div className="text-fl-card text-fl-ink font-sans">Appearance</div>
            <p className="text-xs font-sans text-fl-secondary mt-1 leading-relaxed">
              Switch between Obsidian (Dark) and Crisp Slate (Light) color schemes.
            </p>
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={onToggleTheme}
            leadingIcon={
              theme === 'dark' ? (
                <Sun className="w-3.5 h-3.5 text-fl-accent-text" />
              ) : (
                <Moon className="w-3.5 h-3.5 text-fl-accent" />
              )
            }
          >
            {theme === 'dark' ? 'Switch to Light' : 'Switch to Dark'}
          </Button>
        </div>

        <div className="p-5 flex items-center justify-between gap-4">
          <div>
            <div className="text-fl-card text-fl-ink font-sans">Environment Mode</div>
            <p className="text-xs font-sans text-fl-secondary mt-1 leading-relaxed">
              Current workstation execution target and data isolation boundary.
            </p>
          </div>
          <span className="px-2.5 py-1 text-[11px] font-mono font-medium uppercase bg-fl-accent-subtle border border-fl-accent-border text-fl-accent-text rounded shrink-0">
            Local Workstation
          </span>
        </div>

        <div className="p-5 flex items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-fl-card text-fl-ink font-sans">Payload Capture Policy</span>
              <span className="text-[10px] font-mono font-medium uppercase text-fl-success-text bg-fl-success-bg border border-fl-success-border px-1.5 py-0.5 rounded">
                Safe Default
              </span>
            </div>
            <p className="text-xs font-sans text-fl-secondary mt-1 leading-relaxed">
              Stores cryptographic digests, timestamps, and redacted metadata. Secrets are masked before persistence.
            </p>
          </div>
          <span className="text-xs font-mono font-medium text-fl-secondary shrink-0 uppercase">
            Metadata Only
          </span>
        </div>

        <div className="p-5 flex items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-fl-card text-fl-ink font-sans">AI Investigation Agent</span>
              <span
                className={`text-[10px] font-mono font-medium px-2 py-0.5 rounded border uppercase ${
                  agentSettings?.enabled
                    ? 'bg-fl-success-bg text-fl-success-text border-fl-success-border'
                    : 'bg-fl-surface-subtle text-fl-muted border-fl-border'
                }`}
              >
                {agentSettings?.enabled ? 'Enabled' : 'Disabled (Deterministic)'}
              </span>
            </div>
            <p className="text-xs font-sans text-fl-secondary mt-1 leading-relaxed">
              {agentSettings?.enabled
                ? `Provider: ${agentSettings.provider} (${agentSettings.model}) • Max ${agentSettings.budgets.maxToolCalls} tool calls / ${Math.round(agentSettings.budgets.maxDurationMs / 1000)}s • Auto-escalation: ${agentSettings.autoInvestigate ? 'ON' : 'OFF'}.`
                : 'Optional read-only model assistance. Deterministic rule receipts run independently with no model key.'}
            </p>
          </div>
          <span className="text-[11px] font-mono font-medium uppercase text-fl-accent-text shrink-0">
            Read-Only (Bounded)
          </span>
        </div>

        <div className="p-5 flex items-center justify-between gap-4">
          <div>
            <div className="text-fl-card text-fl-danger-text font-sans">Reset Demo Fixtures</div>
            <p className="text-xs font-sans text-fl-secondary mt-1 leading-relaxed">
              Restore initial seed incidents and clear simulated playground incidents from local storage.
            </p>
          </div>
          <Button
            size="sm"
            variant="danger"
            onClick={onResetFixtures}
            leadingIcon={<RotateCcw className="w-3.5 h-3.5" />}
          >
            Reset Fixtures
          </Button>
        </div>
      </Panel>
    </div>
  );
};
