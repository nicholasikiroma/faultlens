import React, { useEffect, useState } from 'react';
import type { EvidenceItem } from '../types';
import { Badge } from './Badge';
import { Button } from './ui';
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
      className="fixed inset-0 z-50 overflow-hidden bg-fl-backdrop backdrop-blur-[2px] flex justify-end transition-opacity"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-fl-surface border-l border-fl-border h-full shadow-overlay flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-fl-border flex items-center justify-between bg-fl-surface-subtle">
          <div className="flex items-center gap-2.5">
            <span className="font-mono text-xs font-medium text-fl-accent-text bg-fl-accent-subtle border border-fl-accent-border px-2 py-0.5 rounded">
              {evidence.id}
            </span>
            <Badge epistemic={evidence.epistemic} />
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => currentIndex > 0 && onSelectEvidence(allEvidence[currentIndex - 1])}
              disabled={currentIndex <= 0}
              className="p-1.5 rounded-md text-fl-muted hover:text-fl-ink hover:bg-fl-surface-elevated disabled:opacity-30"
              title="Previous evidence (K)"
              aria-label="Previous evidence"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs font-mono text-fl-muted tabular-nums px-1">
              {currentIndex + 1} / {allEvidence.length}
            </span>
            <button
              type="button"
              onClick={() => currentIndex < allEvidence.length - 1 && onSelectEvidence(allEvidence[currentIndex + 1])}
              disabled={currentIndex >= allEvidence.length - 1}
              className="p-1.5 rounded-md text-fl-muted hover:text-fl-ink hover:bg-fl-surface-elevated disabled:opacity-30"
              title="Next evidence (J)"
              aria-label="Next evidence"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <div className="w-px h-4 bg-fl-border mx-1" aria-hidden="true" />
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-md text-fl-muted hover:text-fl-ink hover:bg-fl-surface-elevated"
              title="Close drawer (Esc)"
              aria-label="Close evidence drawer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          <div>
            <h2 className="text-base font-semibold text-fl-ink font-sans">{evidence.title}</h2>
            <p className="text-[13px] font-sans text-fl-secondary mt-1 leading-relaxed">
              {evidence.description}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 p-3.5 rounded-lg bg-fl-surface-subtle border border-fl-border text-xs">
            <div>
              <span className="text-fl-muted block text-[10px] uppercase tracking-wider font-medium font-mono">
                Source Probe
              </span>
              <span className="font-mono text-fl-accent-text font-medium text-xs">
                {evidence.source}
              </span>
            </div>
            <div>
              <span className="text-fl-muted block text-[10px] uppercase tracking-wider font-medium font-mono">
                Epistemic Level
              </span>
              <span className="font-medium font-sans text-fl-ink text-xs">
                {evidence.epistemic}
              </span>
            </div>
          </div>

          {jsonString.includes('[REDACTED]') && (
            <div className="flex items-center gap-2.5 p-3 rounded-lg border border-fl-warning-border bg-fl-warning-bg text-xs font-sans text-fl-warning-text leading-relaxed">
              <ShieldAlert className="w-4 h-4 text-fl-warning-dot flex-shrink-0" aria-hidden="true" />
              <span>Sensitive authorization credentials and signatures were redacted at ingress.</span>
            </div>
          )}

          {/* JSON Payload Inspector */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-fl-ink font-sans">
                <Terminal className="w-3.5 h-3.5 text-fl-accent" aria-hidden="true" />
                Observed Evidence Payload
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={handleCopy}
                leadingIcon={copied ? <Check className="w-3 h-3 text-fl-success-dot" /> : <Copy className="w-3 h-3" />}
              >
                {copied ? 'Copied' : 'Copy JSON'}
              </Button>
            </div>
            <div className="rounded-lg border border-fl-border bg-fl-surface-subtle p-4 overflow-x-auto text-xs font-mono">
              <pre className="text-fl-ink leading-relaxed whitespace-pre-wrap">{jsonString}</pre>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-fl-border bg-fl-surface-subtle flex items-center justify-between text-xs text-fl-muted font-sans">
          <span>
            <kbd className="font-mono text-[10px] px-1 py-0.5 bg-fl-surface border border-fl-border rounded">J</kbd> /{' '}
            <kbd className="font-mono text-[10px] px-1 py-0.5 bg-fl-surface border border-fl-border rounded">K</kbd> step •{' '}
            <kbd className="font-mono text-[10px] px-1 py-0.5 bg-fl-surface border border-fl-border rounded">Esc</kbd> dismiss
          </span>
          <Button size="sm" variant="secondary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
};
