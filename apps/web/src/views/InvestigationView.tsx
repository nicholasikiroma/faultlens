import React, { useState } from 'react';
import type { Incident, EvidenceItem } from '../types';
import { Badge } from '../components/Badge';
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
} from 'lucide-react';

interface InvestigationViewProps {
  incident: Incident;
  onBack: () => void;
  onOpenEvidence: (ev: EvidenceItem) => void;
  onShowToast: (msg: string) => void;
  onFeedback: (hypothesisId: string, feedback: 'helpful' | 'false_positive') => void;
}

export const InvestigationView: React.FC<InvestigationViewProps> = ({
  incident,
  onBack,
  onOpenEvidence,
  onShowToast,
  onFeedback,
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
      {/* Top Bar Navigation & Actions */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <button
            onClick={onBack}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-ws-accent hover:text-ws-accent-hover font-mono mb-2 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>BACK TO INCIDENTS</span>
          </button>
          <h1 className="text-2xl font-bold tracking-tight text-ws-ink">
            {incident.title}
          </h1>
          <p className="text-xs text-ws-muted mt-1 font-mono">
            {incident.key} • {incident.integration} • First seen {incident.firstSeen}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => {
              const exportBlob = new Blob([JSON.stringify(incident, null, 2)], {
                type: 'application/json',
              });
              const url = URL.createObjectURL(exportBlob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `${incident.key}_sanitized_bundle.json`;
              a.click();
              onShowToast(`Exported ${incident.key} sanitized bundle.`);
            }}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-md bg-ws-surface border border-ws-border hover:border-ws-border-strong text-ws-ink hover:bg-ws-surface-elevated text-xs font-semibold shadow-subtle transition-colors"
          >
            <Download className="w-3.5 h-3.5 text-ws-accent" />
            <span>Export Sanitized Bundle</span>
          </button>

          <button
            onClick={() =>
              onShowToast('Simulating bounded read-only investigation with deterministic rules...')
            }
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-md bg-ws-btn-primary hover:bg-ws-btn-primary-hover active:bg-ws-btn-primary-active text-ws-btn-primary-ink border border-ws-btn-primary-border text-xs font-semibold shadow-subtle transition-colors"
          >
            <Search className="w-3.5 h-3.5" />
            <span>Run Investigation</span>
          </button>
        </div>
      </div>

      {/* Incident Status Badges Bar */}
      <div className="flex flex-wrap items-center gap-3 py-2.5 border-y border-ws-border">
        <Badge status={incident.status} withPulse={incident.status === 'INVESTIGATING'} />
        <Badge severity={incident.severity} />
        <span className="text-[11px] font-mono text-ws-muted">
          Class: <strong className="text-ws-ink">{incident.cls}</strong>
        </span>
        <span className="text-[11px] font-mono text-ws-muted">
          Events: <strong className="text-ws-ink">{incident.events}</strong>
        </span>
      </div>

      {/* Tri-Column Summary Strip: Know / Suspect / Next Safe Check */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-ws-border rounded-lg overflow-hidden border border-ws-border shadow-subtle">
        <div className="p-4 bg-ws-surface space-y-1.5">
          <div className="text-[10px] font-mono font-semibold tracking-widest text-ws-accent uppercase">
            [1] WHAT WE KNOW
          </div>
          <p className="text-xs text-ws-ink leading-relaxed font-medium">
            {incident.known}
          </p>
        </div>
        <div className="p-4 bg-ws-surface space-y-1.5">
          <div className="text-[10px] font-mono font-semibold tracking-widest text-ws-warning-text uppercase">
            [2] WHAT WE SUSPECT
          </div>
          <p className="text-xs text-ws-ink leading-relaxed font-medium">
            {incident.suspect}
          </p>
        </div>
        <div className="p-4 bg-ws-surface space-y-1.5">
          <div className="text-[10px] font-mono font-semibold tracking-widest text-ws-success-text uppercase">
            [3] NEXT SAFE CHECK
          </div>
          <p className="text-xs text-ws-ink leading-relaxed font-medium">
            {incident.next}
          </p>
        </div>
      </div>

      {/* Dual Column Layout: Left Workbench + Right Inspector Rail */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column (2 Cols): Tabs for Timeline, Evidence, Attempts, Raw Payload */}
        <div className="lg:col-span-2 rounded-lg bg-ws-surface border border-ws-border shadow-subtle overflow-hidden flex flex-col">
          {/* Tabs Bar */}
          <div className="flex items-center gap-6 px-6 border-b border-ws-border bg-ws-surface-subtle">
            {(['timeline', 'evidence', 'attempts', 'raw'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`py-3.5 text-xs font-semibold capitalize border-b-2 transition-colors ${
                  activeTab === tab
                    ? 'border-ws-accent text-ws-ink'
                    : 'border-transparent text-ws-muted hover:text-ws-secondary'
                }`}
              >
                {tab === 'raw' ? 'Raw Payload' : tab}
              </button>
            ))}
          </div>

          {/* Tab 1: Timeline (Color-coded states) */}
          {activeTab === 'timeline' && (
            <div className="p-6 space-y-4">
              {incident.timeline.map((item, idx) => {
                const linkedEvidence = incident.evidence.find((e) => e.id === item.evidenceId);
                const isFailure = item.severity === 'danger';
                const isWarning = item.severity === 'warn';

                return (
                  <div key={item.id} className="relative flex items-start gap-3.5">
                    {/* Timestamp */}
                    <div className="w-16 font-mono text-[11px] text-ws-muted text-right flex-shrink-0 pt-2 tabular-nums">
                      {item.time.split('.')[0]}
                    </div>

                    {/* Circuit Node & Vertical Connecting Line Column */}
                    <div className="flex flex-col items-center flex-shrink-0 self-stretch">
                      {/* Node Checkpoint Icon */}
                      <div
                        className={`relative z-10 w-7 h-7 rounded-full flex items-center justify-center shadow-subtle transition-transform ${
                          isFailure
                            ? 'bg-ws-danger-bg text-ws-danger-dot border border-ws-danger-border ring-2 ring-ws-danger-dot/25'
                            : isWarning
                            ? 'bg-ws-warning-bg text-ws-warning-dot border border-ws-warning-border ring-2 ring-ws-warning-dot/25'
                            : 'bg-ws-success-bg text-ws-success-dot border border-ws-success-border'
                        }`}
                      >
                        {isFailure ? (
                          <AlertCircle className="w-4 h-4 stroke-[2.5]" />
                        ) : isWarning ? (
                          <AlertTriangle className="w-4 h-4 stroke-[2.5]" />
                        ) : (
                          <CheckCircle2 className="w-4 h-4 stroke-[2.5]" />
                        )}
                      </div>

                      {/* Connecting Line */}
                      {idx < incident.timeline.length - 1 && (
                        <div className="w-px flex-1 bg-ws-border my-1.5" />
                      )}
                    </div>

                    {/* Event Card with Distinct Color Coding */}
                    <div
                      className={`flex-1 mb-2 rounded-lg p-4 border border-l-4 transition-colors shadow-subtle ${
                        isFailure
                          ? 'bg-ws-danger-bg/25 border-ws-danger-border border-l-ws-danger-dot'
                          : isWarning
                          ? 'bg-ws-warning-bg/15 border-ws-warning-border border-l-ws-warning-dot'
                          : 'bg-ws-surface-subtle border-ws-border border-l-ws-success-dot'
                      }`}
                    >
                      {/* Card Header with State Pill */}
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-xs font-bold ${
                              isFailure ? 'text-ws-danger-text' : 'text-ws-ink'
                            }`}
                          >
                            {item.title}
                          </span>
                        </div>

                        {/* Distinct State Badges */}
                        {isFailure ? (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase tracking-wider bg-ws-danger-bg text-ws-danger-text border border-ws-danger-border">
                            <span className="w-1.5 h-1.5 rounded-full bg-ws-danger-dot animate-pulse" />
                            FAILURE CHECKPOINT
                          </span>
                        ) : isWarning ? (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono font-semibold uppercase tracking-wider bg-ws-warning-bg text-ws-warning-text border border-ws-warning-border">
                            <span className="w-1.5 h-1.5 rounded-full bg-ws-warning-dot" />
                            WARNING / RETRY
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono font-semibold uppercase tracking-wider bg-ws-success-bg text-ws-success-text border border-ws-success-border">
                            <span className="w-1.5 h-1.5 rounded-full bg-ws-success-dot" />
                            VERIFIED INGRESS
                          </span>
                        )}
                      </div>

                      {/* Description */}
                      <p className="text-xs text-ws-secondary mt-1.5 leading-relaxed">
                        {item.description}
                      </p>

                      {/* Evidence Link Footer */}
                      {linkedEvidence && (
                        <div className="mt-3 pt-2.5 border-t border-ws-border/50 flex items-center justify-between">
                          <button
                            onClick={() => onOpenEvidence(linkedEvidence)}
                            className="inline-flex items-center gap-1.5 text-[11px] font-mono font-semibold text-ws-accent hover:underline"
                          >
                            <span>Inspect evidence record • {linkedEvidence.id}</span>
                            <ExternalLink className="w-3 h-3" />
                          </button>
                          <span className="text-[10px] font-mono text-ws-muted uppercase">
                            Source: {linkedEvidence.source}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Tab 2: Evidence */}
          {activeTab === 'evidence' && (
            <div className="p-6 space-y-4">
              {incident.evidence.map((ev) => (
                <div
                  key={ev.id}
                  onClick={() => onOpenEvidence(ev)}
                  className="p-4 rounded-md bg-ws-surface-subtle border border-ws-border hover:border-ws-border-strong cursor-pointer transition-colors space-y-2 group"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-ws-accent group-hover:underline">
                        {ev.id}
                      </span>
                      <span className="text-xs font-bold text-ws-ink">{ev.title}</span>
                    </div>
                    <Badge epistemic={ev.epistemic} />
                  </div>
                  <p className="text-xs text-ws-secondary">{ev.description}</p>
                  <div className="flex items-center justify-between pt-2 border-t border-ws-border text-[10px] font-mono text-ws-muted">
                    <span>Source: {ev.source}</span>
                    <span className="text-ws-accent font-medium">Click to open drawer →</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Tab 3: Attempts */}
          {activeTab === 'attempts' && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-ws-surface-subtle border-b border-ws-border text-[10px] font-mono uppercase text-ws-muted">
                  <tr>
                    <th className="py-3 px-4 font-semibold">Attempt</th>
                    <th className="py-3 px-4 font-semibold">Timestamp</th>
                    <th className="py-3 px-4 font-semibold">HTTP Status</th>
                    <th className="py-3 px-4 font-semibold">Latency</th>
                    <th className="py-3 px-4 font-semibold">Evidence</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ws-border">
                  {incident.attempts.map((att) => {
                    const linked = incident.evidence.find((e) => e.id === att.evidenceId);
                    return (
                      <tr key={att.id} className="hover:bg-ws-surface-elevated/60 transition-colors">
                        <td className="py-3 px-4 font-mono font-semibold text-ws-ink">
                          attempt_0{att.attemptNumber}
                        </td>
                        <td className="py-3 px-4 font-mono text-ws-muted tabular-nums">{att.time}</td>
                        <td className="py-3 px-4">
                          <span
                            className={`px-2 py-0.5 rounded text-[11px] font-mono font-semibold ${
                              att.status >= 500
                                ? 'bg-ws-danger-bg text-ws-danger-text border border-ws-danger-border'
                                : att.status === 429
                                ? 'bg-ws-warning-bg text-ws-warning-text border border-ws-warning-border'
                                : 'bg-ws-surface-subtle text-ws-ink border border-ws-border'
                            }`}
                          >
                            {att.status}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-mono text-ws-secondary tabular-nums">{att.durationMs}ms</td>
                        <td className="py-3 px-4">
                          {linked && (
                            <button
                              onClick={() => onOpenEvidence(linked)}
                              className="font-mono text-ws-accent hover:underline font-semibold"
                            >
                              {linked.id}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Tab 4: Raw Payload */}
          {activeTab === 'raw' && (
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-semibold text-ws-ink">
                  <Terminal className="w-3.5 h-3.5 text-ws-accent" />
                  Redacted Ingress JSON Payload
                </div>
                <button
                  onClick={handleCopyRaw}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium bg-ws-surface-subtle border border-ws-border hover:bg-ws-surface-elevated text-ws-secondary hover:text-ws-ink transition-colors"
                >
                  {copiedRaw ? <Check className="w-3.5 h-3.5 text-ws-success-dot" /> : <Terminal className="w-3.5 h-3.5" />}
                  {copiedRaw ? 'Copied' : 'Copy Payload'}
                </button>
              </div>
              <div className="rounded-md border border-ws-border bg-ws-surface-subtle p-4 text-xs font-mono overflow-x-auto">
                <pre className="text-ws-ink whitespace-pre-wrap leading-relaxed">
                  {JSON.stringify(incident.rawPayload, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </div>

        {/* Right Rail: Rule Findings & AI Hypothesis Cards */}
        <div className="space-y-6">
          {/* Rule Findings (Deterministic) */}
          <div className="p-5 rounded-lg bg-ws-surface border border-ws-border shadow-subtle space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-ws-border">
              <div className="flex items-center gap-2">
                <Cpu className="w-4 h-4 text-ws-info-dot" />
                <h3 className="text-xs font-bold text-ws-ink uppercase font-mono tracking-wider">
                  Verified Rule Receipts
                </h3>
              </div>
              <span className="text-[10px] font-mono text-ws-info-text bg-ws-info-bg border border-ws-info-border px-2 py-0.5 rounded font-medium">
                DETERMINISTIC
              </span>
            </div>

            <div className="space-y-3">
              {incident.ruleFindings.map((rule) => (
                <div
                  key={rule.ruleId}
                  className="p-3 rounded-md bg-ws-surface-subtle border border-ws-border space-y-1.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-ws-ink">{rule.name}</span>
                    <span className="text-[10px] font-mono text-ws-accent bg-ws-accent-subtle border border-ws-accent-border px-1.5 py-0.5 rounded font-medium">
                      {rule.matchedEvents} matched
                    </span>
                  </div>
                  <p className="text-[11px] text-ws-secondary leading-relaxed">{rule.description}</p>
                  <div className="font-mono text-[10px] text-ws-info-text pt-1 font-medium">
                    Receipt: {rule.ruleId}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* AI Hypothesis Card (Bounded) */}
          <div className="p-5 rounded-lg bg-ws-surface border border-ws-border shadow-subtle space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-ws-border">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-ws-warning-dot" />
                <h3 className="text-xs font-bold text-ws-ink uppercase font-mono tracking-wider">
                  AI Investigation
                </h3>
              </div>
              <span className="text-[10px] font-mono text-ws-warning-text bg-ws-warning-bg border border-ws-warning-border px-2 py-0.5 rounded font-medium">
                [PROBABILISTIC]
              </span>
            </div>

            {incident.hypotheses.map((hyp) => (
              <div
                key={hyp.id}
                className="p-3.5 rounded-md bg-ws-surface-subtle border border-ws-border space-y-3"
              >
                <div>
                  <div className="text-xs font-bold text-ws-ink">{hyp.title}</div>
                  <p className="text-[11px] text-ws-secondary mt-1 leading-relaxed">{hyp.reasoning}</p>
                </div>

                <div className="p-2.5 rounded bg-ws-surface border border-ws-border text-[11px] text-ws-ink">
                  <span className="text-ws-warning-text font-semibold block text-[10px] font-mono uppercase mb-0.5">
                    Suggested Verification:
                  </span>
                  {hyp.suggestedCheck}
                </div>

                {/* User Feedback Buttons */}
                <div className="pt-2 border-t border-ws-border flex items-center justify-between">
                  <span className="text-[10px] font-mono text-ws-muted">Engineer Feedback:</span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onFeedback(hyp.id, 'helpful')}
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold transition-colors ${
                        hyp.feedback === 'helpful'
                          ? 'bg-ws-success-bg text-ws-success-text border border-ws-success-border'
                          : 'bg-ws-surface border border-ws-border text-ws-muted hover:text-ws-ink'
                      }`}
                    >
                      <ThumbsUp className="w-3 h-3" />
                      Helpful
                    </button>
                    <button
                      onClick={() => onFeedback(hyp.id, 'false_positive')}
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold transition-colors ${
                        hyp.feedback === 'false_positive'
                          ? 'bg-ws-danger-bg text-ws-danger-text border border-ws-danger-border'
                          : 'bg-ws-surface border border-ws-border text-ws-muted hover:text-ws-ink'
                      }`}
                    >
                      <ThumbsDown className="w-3 h-3" />
                      False Positive
                    </button>
                  </div>
                </div>
              </div>
            ))}

            <div className="pt-2 flex items-center gap-2 text-[10px] font-mono text-ws-muted">
              <ShieldCheck className="w-3.5 h-3.5 text-ws-success-dot" />
              <span>Read-only bounded diagnosis • No destructive action</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
