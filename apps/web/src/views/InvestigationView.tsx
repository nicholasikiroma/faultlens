import React, { useState } from 'react';
import type { Incident, EvidenceItem, IncidentStatus } from '../types';
import { Badge } from '../components/Badge';
import { Button, EmptyState, PageHeader, Panel } from '../components/ui';
import {
  ArrowLeft,
  Download,
  Search,
  Check,
  ThumbsUp,
  ThumbsDown,
  Terminal,
  Cpu,
  Sparkles,
  ShieldCheck,
  ExternalLink,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  CheckCircle,
} from 'lucide-react';

interface InvestigationViewProps {
  incident: Incident;
  isLoadingDetail?: boolean;
  onBack: () => void;
  onOpenEvidence: (ev: EvidenceItem) => void;
  onShowToast: (msg: string) => void;
  onFeedback: (hypothesisId: string, feedback: 'helpful' | 'false_positive') => void;
  onStatusChange?: (newStatus: IncidentStatus) => void;
}

export const InvestigationView: React.FC<InvestigationViewProps> = ({
  incident,
  isLoadingDetail = false,
  onBack,
  onOpenEvidence,
  onShowToast,
  onFeedback,
  onStatusChange,
}) => {
  const [activeTab, setActiveTab] = useState<'timeline' | 'evidence' | 'attempts' | 'raw'>('timeline');
  const [copiedRaw, setCopiedRaw] = useState(false);

  const handleCopyRaw = () => {
    navigator.clipboard.writeText(JSON.stringify(incident.rawPayload, null, 2));
    setCopiedRaw(true);
    setTimeout(() => setCopiedRaw(false), 2000);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        backAction={
          <button
            type="button"
            onClick={onBack}
            className="fl-tactile-btn inline-flex items-center gap-1.5 text-xs font-sans font-medium text-fl-accent-text hover:underline"
          >
            <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Back to Incidents</span>
          </button>
        }
        eyebrow="Incident Investigation"
        title={incident.title}
        badge={
          isLoadingDetail ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-sans font-medium bg-fl-accent-subtle text-fl-accent-text border border-fl-accent-border">
              <RefreshCw className="w-3 h-3 animate-spin" aria-hidden="true" />
              Syncing detail...
            </span>
          ) : undefined
        }
        description={
          <>
            <span className="font-mono text-fl-ink font-medium">{incident.key}</span> •{' '}
            {incident.integration} • First seen{' '}
            <span className="font-mono tabular-nums">{incident.firstSeen}</span>
          </>
        }
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                const exportBlob = new Blob([JSON.stringify(incident, null, 2)], {
                  type: 'application/json',
                });
                const url = URL.createObjectURL(exportBlob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${incident.key}_sanitized_bundle.json`;
                a.click();
                URL.revokeObjectURL(url);
                onShowToast(`Exported ${incident.key} sanitized bundle.`);
              }}
              leadingIcon={<Download className="w-3.5 h-3.5 text-fl-accent" />}
            >
              Export Bundle
            </Button>

            <Button
              variant="primary"
              onClick={() =>
                onShowToast('Running deterministic rule check across linked evidence...')
              }
              leadingIcon={<Search className="w-3.5 h-3.5" />}
            >
              Run Investigation
            </Button>
          </>
        }
      />

      {/* Status & Lifecycle Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 py-2.5 border-b border-fl-border">
        <div className="flex flex-wrap items-center gap-3">
          <Badge status={incident.status} withPulse={incident.status === 'INVESTIGATING'} />
          <Badge severity={incident.severity} />
          <span className="text-xs font-sans text-fl-muted">
            Class: <strong className="font-mono text-fl-ink font-medium">{incident.cls}</strong>
          </span>
          <span className="text-xs font-sans text-fl-muted">
            Events:{' '}
            <strong className="font-mono text-fl-ink font-medium tabular-nums">
              {incident.events}
            </strong>
          </span>
        </div>

        {onStatusChange && (
          <div className="flex items-center gap-2">
            <span className="text-xs font-sans text-fl-muted">Transition:</span>
            {incident.status !== 'INVESTIGATING' && (
              <Button size="sm" variant="secondary" onClick={() => onStatusChange('INVESTIGATING')}>
                Mark investigating
              </Button>
            )}
            {incident.status !== 'RESOLVED' && (
              <button
                type="button"
                onClick={() => onStatusChange('RESOLVED')}
                className="fl-tactile-btn inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-sans font-medium bg-fl-success-bg border border-fl-success-border text-fl-success-text hover:brightness-110"
              >
                <CheckCircle className="w-3.5 h-3.5" aria-hidden="true" />
                Resolve
              </button>
            )}
            {incident.status === 'RESOLVED' && (
              <Button size="sm" variant="secondary" onClick={() => onStatusChange('OPEN')}>
                Reopen
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Tri-Column Epistemic Strip: Know / Suspect / Next Safe Check */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-fl-border rounded-xl overflow-hidden border border-fl-border shadow-subtle">
        <div className="p-4 bg-fl-surface space-y-1.5">
          <div className="text-[10px] font-mono font-semibold tracking-wider text-fl-accent-text uppercase flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-fl-accent" aria-hidden="true" />
            What We Know
          </div>
          <p className="text-[13px] text-fl-ink leading-relaxed font-sans">{incident.known}</p>
        </div>
        <div className="p-4 bg-fl-surface space-y-1.5">
          <div className="text-[10px] font-mono font-semibold tracking-wider text-fl-warning-text uppercase flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-fl-warning-dot" aria-hidden="true" />
            What We Suspect
          </div>
          <p className="text-[13px] text-fl-ink leading-relaxed font-sans">{incident.suspect}</p>
        </div>
        <div className="p-4 bg-fl-surface space-y-1.5">
          <div className="text-[10px] font-mono font-semibold tracking-wider text-fl-violet-text uppercase flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-fl-violet-dot" aria-hidden="true" />
            Next Safe Check
          </div>
          <p className="text-[13px] text-fl-ink leading-relaxed font-sans">{incident.next}</p>
        </div>
      </div>

      {/* Investigation Workbench & Findings Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Panel padding="none" className="lg:col-span-2 overflow-hidden flex flex-col">
          <div className="flex items-center gap-6 px-6 border-b border-fl-border bg-fl-surface-subtle">
            {(['timeline', 'evidence', 'attempts', 'raw'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`py-3.5 text-[13px] font-sans font-medium capitalize border-b-2 transition-colors ${
                  activeTab === tab
                    ? 'border-fl-accent text-fl-ink font-semibold'
                    : 'border-transparent text-fl-muted hover:text-fl-secondary'
                }`}
              >
                {tab === 'raw' ? 'Raw Payload' : tab}
              </button>
            ))}
          </div>

          {activeTab === 'timeline' && (
            <div className="p-6 space-y-4">
              {incident.timeline.length === 0 ? (
                <EmptyState
                  title="No timeline checkpoints recorded"
                  description="Events linked to this incident will appear chronologically here."
                />
              ) : (
                incident.timeline.map((item, idx) => {
                  const linkedEvidence = incident.evidence.find((e) => e.id === item.evidenceId);
                  const isFailure = item.severity === 'danger';
                  const isWarning = item.severity === 'warn';

                  return (
                    <div key={item.id} className="relative flex items-start gap-3.5">
                      <div className="w-16 font-mono text-[11px] text-fl-muted text-right flex-shrink-0 pt-2 tabular-nums">
                        {item.time.split('.')[0]}
                      </div>

                      <div className="flex flex-col items-center flex-shrink-0 self-stretch">
                        <div
                          className={`relative z-10 w-7 h-7 rounded-full flex items-center justify-center shadow-subtle ${
                            isFailure
                              ? 'bg-fl-danger-bg text-fl-danger-dot border border-fl-danger-border'
                              : isWarning
                              ? 'bg-fl-warning-bg text-fl-warning-dot border border-fl-warning-border'
                              : 'bg-fl-success-bg text-fl-success-dot border border-fl-success-border'
                          }`}
                        >
                          {isFailure ? (
                            <AlertCircle className="w-4 h-4" aria-hidden="true" />
                          ) : isWarning ? (
                            <AlertTriangle className="w-4 h-4" aria-hidden="true" />
                          ) : (
                            <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                          )}
                        </div>

                        {idx < incident.timeline.length - 1 && (
                          <div className="w-px flex-1 bg-fl-border my-1.5" aria-hidden="true" />
                        )}
                      </div>

                      <div
                        className={`flex-1 mb-2 rounded-lg p-4 border border-l-4 shadow-subtle ${
                          isFailure
                            ? 'bg-fl-danger-bg/40 border-fl-danger-border border-l-fl-danger-dot'
                            : isWarning
                            ? 'bg-fl-warning-bg/30 border-fl-warning-border border-l-fl-warning-dot'
                            : 'bg-fl-surface-subtle border-fl-border border-l-fl-success-dot'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span
                            className={`text-[13px] font-sans font-semibold ${
                              isFailure ? 'text-fl-danger-text' : 'text-fl-ink'
                            }`}
                          >
                            {item.title}
                          </span>

                          {isFailure ? (
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono font-medium uppercase tracking-wider bg-fl-danger-bg text-fl-danger-text border border-fl-danger-border">
                              Failure
                            </span>
                          ) : isWarning ? (
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono font-medium uppercase tracking-wider bg-fl-warning-bg text-fl-warning-text border border-fl-warning-border">
                              Retry / Warn
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono font-medium uppercase tracking-wider bg-fl-success-bg text-fl-success-text border border-fl-success-border">
                              Verified
                            </span>
                          )}
                        </div>

                        <p className="text-[13px] font-sans text-fl-secondary mt-1.5 leading-relaxed">
                          {item.description}
                        </p>

                        {linkedEvidence && (
                          <div className="mt-3 pt-2.5 border-t border-fl-border/60 flex items-center justify-between">
                            <button
                              type="button"
                              onClick={() => onOpenEvidence(linkedEvidence)}
                              className="inline-flex items-center gap-1.5 text-xs font-sans font-medium text-fl-accent-text hover:underline"
                            >
                              <span>
                                Inspect evidence • <span className="font-mono">{linkedEvidence.id}</span>
                              </span>
                              <ExternalLink className="w-3 h-3" aria-hidden="true" />
                            </button>
                            <span className="text-[10px] font-mono text-fl-muted uppercase">
                              Source: {linkedEvidence.source}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {activeTab === 'evidence' && (
            <div className="p-6 space-y-3">
              {incident.evidence.length === 0 ? (
                <EmptyState
                  title="No evidence records linked"
                  description="Supporting observations for this incident will appear here."
                />
              ) : (
                incident.evidence.map((ev) => (
                  <button
                    key={ev.id}
                    type="button"
                    onClick={() => onOpenEvidence(ev)}
                    className="w-full text-left p-4 rounded-lg bg-fl-surface-subtle border border-fl-border hover:border-fl-border-strong transition-colors space-y-2 group"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-mono text-xs font-medium text-fl-accent-text group-hover:underline">
                          {ev.id}
                        </span>
                        <span className="text-[13px] font-sans font-semibold text-fl-ink truncate">
                          {ev.title}
                        </span>
                      </div>
                      <Badge epistemic={ev.epistemic} />
                    </div>
                    <p className="text-[13px] font-sans text-fl-secondary leading-relaxed">
                      {ev.description}
                    </p>
                    <div className="flex items-center justify-between pt-2 border-t border-fl-border text-xs text-fl-muted">
                      <span className="font-mono text-[10px]">Source: {ev.source}</span>
                      <span className="text-fl-accent-text font-sans font-medium text-xs">
                        Open inspector →
                      </span>
                    </div>
                  </button>
                ))
              )}
            </div>
          )}

          {activeTab === 'attempts' && (
            <div tabIndex={0} role="region" aria-label="Delivery attempts table" className="overflow-x-auto">
              <table className="w-full text-left text-fl-table font-sans border-collapse">
                <thead className="bg-fl-surface-subtle border-b border-fl-border text-xs font-sans font-medium text-fl-muted">
                  <tr>
                    <th className="py-3 px-4">Attempt</th>
                    <th className="py-3 px-4">Timestamp</th>
                    <th className="py-3 px-4">HTTP Status</th>
                    <th className="py-3 px-4">Latency</th>
                    <th className="py-3 px-4">Evidence</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-fl-border-subtle">
                  {incident.attempts.length === 0 ? (
                    <tr>
                      <td colSpan={5}>
                        <EmptyState title="No delivery attempts recorded" />
                      </td>
                    </tr>
                  ) : (
                    incident.attempts.map((att) => {
                      const linked = incident.evidence.find((e) => e.id === att.evidenceId);
                      return (
                        <tr key={att.id} className="hover:bg-fl-surface-subtle transition-colors">
                          <td className="py-3 px-4 font-mono font-medium text-fl-ink text-xs">
                            attempt_0{att.attemptNumber}
                          </td>
                          <td className="py-3 px-4 font-mono text-[11px] text-fl-muted tabular-nums">
                            {att.time}
                          </td>
                          <td className="py-3 px-4">
                            <span
                              className={`px-2 py-0.5 rounded text-[11px] font-mono font-medium tabular-nums ${
                                att.status >= 500
                                  ? 'bg-fl-danger-bg text-fl-danger-text border border-fl-danger-border'
                                  : att.status === 429
                                  ? 'bg-fl-warning-bg text-fl-warning-text border border-fl-warning-border'
                                  : 'bg-fl-surface-subtle text-fl-ink border border-fl-border'
                              }`}
                            >
                              {att.status || 'OK'}
                            </span>
                          </td>
                          <td className="py-3 px-4 font-mono text-xs text-fl-secondary tabular-nums">
                            {att.durationMs}ms
                          </td>
                          <td className="py-3 px-4">
                            {linked ? (
                              <button
                                type="button"
                                onClick={() => onOpenEvidence(linked)}
                                className="font-mono text-xs text-fl-accent-text hover:underline font-medium"
                              >
                                {linked.id}
                              </button>
                            ) : (
                              <span className="font-mono text-fl-muted text-[10px]">None</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === 'raw' && (
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-[13px] font-semibold text-fl-ink font-sans">
                  <Terminal className="w-3.5 h-3.5 text-fl-accent" aria-hidden="true" />
                  Redacted Ingress JSON Payload
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={handleCopyRaw}
                  leadingIcon={
                    copiedRaw ? (
                      <Check className="w-3.5 h-3.5 text-fl-success-dot" />
                    ) : (
                      <Terminal className="w-3.5 h-3.5" />
                    )
                  }
                >
                  {copiedRaw ? 'Copied' : 'Copy Payload'}
                </Button>
              </div>
              <div className="rounded-lg border border-fl-border bg-fl-surface-subtle p-4 text-xs font-mono overflow-x-auto">
                <pre className="text-fl-ink whitespace-pre-wrap leading-relaxed">
                  {JSON.stringify(incident.rawPayload, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </Panel>

        {/* Right Rail: Rule Receipts & Bounded AI Hypotheses */}
        <div className="space-y-5">
          <Panel padding="md" className="space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-fl-border">
              <div className="flex items-center gap-2">
                <Cpu className="w-4 h-4 text-fl-violet-dot" aria-hidden="true" />
                <h3 className="text-fl-card text-fl-ink font-sans">Verified Rule Receipts</h3>
              </div>
              <span className="text-[10px] font-mono text-fl-violet-text bg-fl-violet-bg border border-fl-violet-border px-2 py-0.5 rounded font-medium uppercase tracking-wide">
                Deterministic
              </span>
            </div>

            <div className="space-y-3">
              {incident.ruleFindings.length === 0 ? (
                <div className="p-4 text-center text-xs font-sans text-fl-muted">
                  No rule findings registered yet.
                </div>
              ) : (
                incident.ruleFindings.map((rule) => (
                  <div
                    key={rule.ruleId}
                    className="p-3 rounded-lg bg-fl-surface-subtle border border-fl-border space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[13px] font-sans font-semibold text-fl-ink">
                        {rule.name}
                      </span>
                      <span className="text-[10px] font-mono text-fl-accent-text bg-fl-accent-subtle border border-fl-accent-border px-1.5 py-0.5 rounded font-medium tabular-nums shrink-0">
                        {rule.matchedEvents} matched
                      </span>
                    </div>
                    <p className="text-xs font-sans text-fl-secondary leading-relaxed">
                      {rule.description}
                    </p>
                    <div className="font-mono text-[10px] text-fl-violet-text pt-1 font-medium">
                      Receipt: {rule.ruleId}
                    </div>
                  </div>
                ))
              )}
            </div>
          </Panel>

          <Panel padding="md" className="space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-fl-border">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-fl-warning-dot" aria-hidden="true" />
                <h3 className="text-fl-card text-fl-ink font-sans">Hypotheses</h3>
              </div>
              <span className="text-[10px] font-mono text-fl-warning-text bg-fl-warning-bg border border-dashed border-fl-warning-border px-2 py-0.5 rounded font-medium uppercase">
                Unverified
              </span>
            </div>

            {incident.hypotheses.map((hyp) => (
              <div
                key={hyp.id}
                className="p-3.5 rounded-lg bg-fl-surface-subtle border border-fl-border space-y-3"
              >
                <div>
                  <div className="text-[13px] font-sans font-semibold text-fl-ink">{hyp.title}</div>
                  <p className="text-xs font-sans text-fl-secondary mt-1 leading-relaxed">
                    {hyp.reasoning}
                  </p>
                </div>

                <div className="p-2.5 rounded-md bg-fl-surface border border-fl-border text-xs font-sans text-fl-ink">
                  <span className="text-fl-warning-text font-medium block text-[10px] font-mono uppercase mb-0.5">
                    Suggested Check:
                  </span>
                  {hyp.suggestedCheck}
                </div>

                <div className="pt-2 border-t border-fl-border flex items-center justify-between">
                  <span className="text-xs font-sans text-fl-muted">Feedback:</span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onFeedback(hyp.id, 'helpful')}
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-sans font-medium transition-colors ${
                        hyp.feedback === 'helpful'
                          ? 'bg-fl-success-bg text-fl-success-text border border-fl-success-border'
                          : 'bg-fl-surface border border-fl-border text-fl-muted hover:text-fl-ink'
                      }`}
                    >
                      <ThumbsUp className="w-3 h-3" aria-hidden="true" />
                      Helpful
                    </button>
                    <button
                      type="button"
                      onClick={() => onFeedback(hyp.id, 'false_positive')}
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-sans font-medium transition-colors ${
                        hyp.feedback === 'false_positive'
                          ? 'bg-fl-danger-bg text-fl-danger-text border border-fl-danger-border'
                          : 'bg-fl-surface border border-fl-border text-fl-muted hover:text-fl-ink'
                      }`}
                    >
                      <ThumbsDown className="w-3 h-3" aria-hidden="true" />
                      False Positive
                    </button>
                  </div>
                </div>
              </div>
            ))}

            <div className="pt-1 flex items-center gap-2 text-xs font-sans text-fl-muted">
              <ShieldCheck className="w-3.5 h-3.5 text-fl-success-dot" aria-hidden="true" />
              <span>Read-only diagnosis • No destructive actions</span>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
};
