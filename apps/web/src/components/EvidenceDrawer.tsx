import React, { useEffect, useState } from 'react';
import type { EvidenceItem } from '../types';
import { Badge } from './Badge';
import { X, Copy, Check, ChevronLeft, ChevronRight, Terminal, ShieldAlert } from 'lucide-react';

interface EvidenceDrawerProps {
  evidence: EvidenceItem | null;
  allEvidence: EvidenceItem[];
  onClose: () => void;
  onSelectEvidence: (ev: EvidenceItem) => void;
}

export const EvidenceDrawer: React.FC<EvidenceDrawerProps> = ({
  evidence,
  allEvidence,
  onClose,
  onSelectEvidence,
}) => {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!evidence) return;
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'j' || e.key === 'ArrowDown') {
        const idx = allEvidence.findIndex((ev) => ev.id === evidence.id);
        if (idx !== -1 && idx < allEvidence.length - 1) {
          onSelectEvidence(allEvidence[idx + 1]);
        }
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        const idx = allEvidence.findIndex((ev) => ev.id === evidence.id);
        if (idx > 0) {
          onSelectEvidence(allEvidence[idx - 1]);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [evidence, allEvidence, onClose, onSelectEvidence]);

  if (!evidence) return null;

  const currentIndex = allEvidence.findIndex((ev) => ev.id === evidence.id);
  const jsonString = JSON.stringify(evidence.data, null, 2);

  const handleCopy = () => {
    navigator.clipboard.writeText(jsonString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className="fixed inset-0 z-50 overflow-hidden bg-ws-backdrop backdrop-blur-[2px] flex justify-end transition-opacity"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-ws-surface border-l border-ws-border h-full shadow-elevated flex flex-col transform transition-transform duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 border-b border-ws-border flex items-center justify-between bg-ws-surface-subtle">
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs font-semibold text-ws-accent bg-ws-accent-subtle border border-ws-accent-border px-2 py-0.5 rounded">
              {evidence.id}
            </span>
            <Badge epistemic={evidence.epistemic} />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => currentIndex > 0 && onSelectEvidence(allEvidence[currentIndex - 1])}
              disabled={currentIndex <= 0}
              className="p-1 rounded text-ws-muted hover:text-ws-ink hover:bg-ws-surface-elevated disabled:opacity-30"
              title="Previous evidence (K)"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-[11px] font-mono text-ws-muted">
              {currentIndex + 1} / {allEvidence.length}
            </span>
            <button
              onClick={() => currentIndex < allEvidence.length - 1 && onSelectEvidence(allEvidence[currentIndex + 1])}
              disabled={currentIndex >= allEvidence.length - 1}
              className="p-1 rounded text-ws-muted hover:text-ws-ink hover:bg-ws-surface-elevated disabled:opacity-30"
              title="Next evidence (J)"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <div className="w-px h-4 bg-ws-border mx-1" />
            <button
              onClick={onClose}
              className="p-1.5 rounded-md text-ws-muted hover:text-ws-ink hover:bg-ws-surface-elevated"
              title="Close drawer (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <div>
            <h2 className="text-base font-bold text-ws-ink">{evidence.title}</h2>
            <p className="text-xs text-ws-secondary mt-1 leading-relaxed">{evidence.description}</p>
          </div>

          <div className="grid grid-cols-2 gap-3 p-3 rounded-md bg-ws-surface-subtle border border-ws-border text-xs">
            <div>
              <span className="text-ws-muted block text-[10px] uppercase tracking-wider font-semibold font-mono">Source Probe</span>
              <span className="font-mono text-ws-accent font-semibold">{evidence.source}</span>
            </div>
            <div>
              <span className="text-ws-muted block text-[10px] uppercase tracking-wider font-semibold font-mono">Epistemic Level</span>
              <span className="font-semibold text-ws-ink">{evidence.epistemic}</span>
            </div>
          </div>

          {/* Masked Secret Alert if applicable */}
          {jsonString.includes('[REDACTED]') && (
            <div className="flex items-center gap-2 p-3 rounded-md border border-ws-warning-border bg-ws-warning-bg text-xs text-ws-warning-text">
              <ShieldAlert className="w-4 h-4 text-ws-warning-dot flex-shrink-0" />
              <span>Sensitive authorization credentials and signatures were redacted at ingress.</span>
            </div>
          )}

          {/* JSON Payload Inspector */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-semibold text-ws-ink">
                <Terminal className="w-3.5 h-3.5 text-ws-accent" />
                Raw Telemetry Payload
              </div>
              <button
                onClick={handleCopy}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium bg-ws-surface-subtle border border-ws-border hover:bg-ws-surface-elevated text-ws-secondary hover:text-ws-ink transition-colors"
              >
                {copied ? <Check className="w-3 h-3 text-ws-success-dot" /> : <Copy className="w-3 h-3" />}
                {copied ? 'Copied' : 'Copy JSON'}
              </button>
            </div>
            <div className="relative rounded-md border border-ws-border bg-ws-surface-subtle p-4 overflow-x-auto text-xs font-mono">
              <pre className="text-ws-ink leading-relaxed whitespace-pre-wrap">{jsonString}</pre>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-ws-border bg-ws-surface-subtle flex items-center justify-between text-[11px] text-ws-muted">
          <span className="font-mono">Use J / K to step • Esc to dismiss</span>
          <button
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-md bg-ws-surface-elevated hover:bg-ws-border text-ws-ink font-semibold border border-ws-border transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
