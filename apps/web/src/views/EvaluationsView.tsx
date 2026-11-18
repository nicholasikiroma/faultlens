import React, { useEffect, useState } from 'react';
import { RefreshCw, Sparkles, CheckCircle2, AlertTriangle, Coins } from 'lucide-react';
import type { EvaluationsSummaryData } from '../types';
import { Button, EmptyState, PageHeader, Panel, StatCard } from '../components/ui';
import { apiStore } from '../api/client';

export const EvaluationsView: React.FC = () => {
  const [summary, setSummary] = useState<EvaluationsSummaryData | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await apiStore.fetchEvaluationsSummary();
      setSummary(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const totals = summary?.totals;
  const precisionPct =
    totals?.precisionRate !== null && totals?.precisionRate !== undefined
      ? `${Math.round(totals.precisionRate * 100)}%`
      : 'n/a';

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Agent Quality & Spend"
        title="Evaluations"
        description="Track AI investigation completion, evidence grounding, operator feedback precision, and estimated spend across models."
        actions={
          <Button
            variant="secondary"
            size="sm"
            disabled={loading}
            onClick={() => void load()}
            leadingIcon={<RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />}
          >
            Refresh
          </Button>
        }
      />

      {!summary ? (
        <Panel padding="md">
          <EmptyState
            title={loading ? 'Loading evaluation metrics...' : 'Backend evaluation metrics unavailable'}
            description="Connect to the live API server to inspect AI run outcomes, operator feedback precision, and token spend."
          />
        </Panel>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label="Total AI Runs"
              value={String(totals?.totalRuns ?? 0)}
              meta={`${totals?.completedRuns ?? 0} completed • ${totals?.needsReviewRuns ?? 0} needs review`}
              icon={<Sparkles className="w-4 h-4 text-fl-accent" />}
            />
            <StatCard
              label="Operator Precision"
              value={precisionPct}
              meta={`${totals?.usefulHypotheses ?? 0} useful / ${totals?.incorrectHypotheses ?? 0} incorrect`}
              icon={<CheckCircle2 className="w-4 h-4 text-fl-success-dot" />}
            />
            <StatCard
              label="Total Tokens"
              value={(totals?.totalTokens ?? 0).toLocaleString()}
              meta={`${totals?.unverifiedHypotheses ?? 0} unverified hypotheses`}
              icon={<AlertTriangle className="w-4 h-4 text-fl-warning-dot" />}
            />
            <StatCard
              label="Estimated Cost"
              value={`$${(totals?.totalEstimatedCostUsd ?? 0).toFixed(4)}`}
              meta="Across recorded AI runs"
              icon={<Coins className="w-4 h-4 text-fl-accent" />}
            />
          </div>

          <Panel padding="none" className="overflow-hidden">
            <div className="px-5 py-3.5 border-b border-fl-border bg-fl-surface-subtle flex items-center justify-between">
              <h3 className="text-fl-card text-fl-ink font-sans">Breakdown by Model &amp; Prompt Version</h3>
              <span className="text-[10px] font-mono text-fl-muted uppercase">
                Live Workspace Metrics
              </span>
            </div>

            {summary.byModel.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  title="No AI investigation runs recorded yet"
                  description="Run an AI investigation on an incident or run `npm run eval:live` to benchmark models."
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-fl-table font-sans border-collapse">
                  <thead className="bg-fl-surface-subtle border-b border-fl-border text-xs font-medium text-fl-muted">
                    <tr>
                      <th className="py-3 px-4">Model</th>
                      <th className="py-3 px-4">Prompt</th>
                      <th className="py-3 px-4">Runs</th>
                      <th className="py-3 px-4">Completed</th>
                      <th className="py-3 px-4">Precision</th>
                      <th className="py-3 px-4">Tokens</th>
                      <th className="py-3 px-4">Est. Cost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-fl-border-subtle">
                    {summary.byModel.map((row) => (
                      <tr key={`${row.modelId}-${row.promptVersion}`} className="hover:bg-fl-surface-subtle">
                        <td className="py-3 px-4 font-mono text-xs text-fl-ink font-medium">
                          {row.modelId}
                        </td>
                        <td className="py-3 px-4 font-mono text-xs text-fl-muted">
                          v{row.promptVersion}
                        </td>
                        <td className="py-3 px-4 font-mono text-xs tabular-nums">{row.runCount}</td>
                        <td className="py-3 px-4 font-mono text-xs tabular-nums text-fl-success-text">
                          {row.completedCount}
                        </td>
                        <td className="py-3 px-4 font-mono text-xs tabular-nums">
                          {row.precisionRate !== null
                            ? `${Math.round(row.precisionRate * 100)}% (${row.usefulCount}/${row.usefulCount + row.incorrectCount})`
                            : 'Unrated'}
                        </td>
                        <td className="py-3 px-4 font-mono text-xs tabular-nums">
                          {row.totalTokens.toLocaleString()}
                        </td>
                        <td className="py-3 px-4 font-mono text-xs tabular-nums text-fl-accent-text font-medium">
                          ${row.totalEstimatedCostUsd.toFixed(4)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      )}
    </div>
  );
};
