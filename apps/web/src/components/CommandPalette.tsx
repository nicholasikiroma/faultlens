import React, { useState, useEffect, useRef } from 'react';
import type { Incident, IntegrationItem, PlaygroundScenario } from '../types';
import { Search, AlertCircle, Plug, Play, ArrowRight, CornerDownLeft } from 'lucide-react';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  incidents: Incident[];
  integrations: IntegrationItem[];
  scenarios: PlaygroundScenario[];
  onSelectIncident: (id: string) => void;
  onSelectPage: (page: string) => void;
  onRunScenario: (scenario: PlaygroundScenario) => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  incidents,
  integrations,
  scenarios,
  onSelectIncident,
  onSelectPage,
  onRunScenario,
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pressedOutsideRef = useRef(false);

  // Sync open state with native <dialog>.showModal() / close()
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen && !dialog.open) {
      setQuery('');
      setSelectedIndex(0);
      dialog.showModal();
      inputRef.current?.focus();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  // Global Cmd+K / Ctrl+K shortcut
  useEffect(() => {
    const handleGlobalKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (isOpen) {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleGlobalKey);
    return () => window.removeEventListener('keydown', handleGlobalKey);
  }, [isOpen, onClose]);

  const q = query.toLowerCase().trim();

  const matchingIncidents = incidents.filter(
    (i) => !q || [i.title, i.key, i.integration, i.cls].join(' ').toLowerCase().includes(q)
  );
  const matchingIntegrations = integrations.filter(
    (int) => !q || [int.name, int.type].join(' ').toLowerCase().includes(q)
  );
  const matchingScenarios = scenarios.filter(
    (sc) => !q || [sc.title, sc.cls, sc.description].join(' ').toLowerCase().includes(q)
  );

  const flatItems: Array<{
    type: 'incident' | 'integration' | 'scenario';
    id: string;
    title: string;
    subtitle: string;
    action: () => void;
  }> = [
    ...matchingIncidents.slice(0, 5).map((i) => ({
      type: 'incident' as const,
      id: i.id,
      title: `${i.key} · ${i.title}`,
      subtitle: `${i.integration} • ${i.cls} • ${i.status}`,
      action: () => {
        onSelectIncident(i.id);
        onClose();
      },
    })),
    ...matchingScenarios.slice(0, 4).map((sc) => ({
      type: 'scenario' as const,
      id: sc.id,
      title: `Run Simulation: ${sc.title}`,
      subtitle: sc.description,
      action: () => {
        onRunScenario(sc);
        onClose();
      },
    })),
    ...matchingIntegrations.slice(0, 3).map((int) => ({
      type: 'integration' as const,
      id: int.id,
      title: `Integration: ${int.name}`,
      subtitle: `${int.type} • Status: ${int.status}`,
      action: () => {
        onSelectPage('integrations');
        onClose();
      },
    })),
  ];

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev < flatItems.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : Math.max(0, flatItems.length - 1)));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (flatItems[selectedIndex]) {
        flatItems[selectedIndex].action();
      }
    }
  };

  // Fallback light-dismiss check using pointer coordinates (covers browsers lacking closedby="any")
  const isOutsideDialog = (e: React.PointerEvent<HTMLDialogElement>) => {
    const dialog = dialogRef.current;
    if (!dialog) return false;
    const rect = dialog.getBoundingClientRect();
    return (
      e.clientX < rect.left ||
      e.clientX > rect.right ||
      e.clientY < rect.top ||
      e.clientY > rect.bottom
    );
  };

  return (
    <dialog
      ref={dialogRef}
      aria-label="FaultLens Command Palette"
      {...({ closedby: 'any' } as Record<string, string>)}
      onClose={onClose}
      onPointerDown={(e) => {
        pressedOutsideRef.current = isOutsideDialog(e);
      }}
      onPointerUp={(e) => {
        if (pressedOutsideRef.current && isOutsideDialog(e)) {
          onClose();
        }
        pressedOutsideRef.current = false;
      }}
      className="m-auto mt-16 sm:mt-20 w-[calc(100%-2rem)] max-w-2xl p-0 bg-fl-surface border border-fl-border rounded-xl shadow-overlay overflow-hidden text-fl-ink"
    >
      {/* Search Input Bar */}
      <div className="flex items-center border-b border-fl-border px-4 py-3 bg-fl-surface-subtle">
        <Search className="w-4 h-4 text-fl-accent mr-3 flex-shrink-0" aria-hidden="true" />
        <input
          ref={inputRef}
          type="text"
          autoFocus
          aria-label="Search incidents, integrations, or simulation scenarios"
          className="w-full bg-transparent text-[13px] text-fl-ink placeholder:text-fl-muted outline-none font-sans"
          placeholder="Search incidents, trace IDs, integrations, or run a scenario..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelectedIndex(0);
          }}
          onKeyDown={handleKeyDown}
        />
        <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-mono font-medium bg-fl-surface border border-fl-border rounded text-fl-muted">
          ESC
        </kbd>
      </div>

      {/* Results List */}
      <div className="max-h-96 overflow-y-auto p-2 space-y-1">
        {flatItems.length === 0 ? (
          <div className="p-8 text-center text-xs text-fl-muted font-sans">
            No matching records found for &ldquo;{query}&rdquo;.
          </div>
        ) : (
          flatItems.map((item, idx) => {
            const isSelected = idx === selectedIndex;
            return (
              <button
                key={`${item.type}-${item.id}`}
                type="button"
                onClick={item.action}
                onMouseEnter={() => setSelectedIndex(idx)}
                className={`w-full text-left flex items-center justify-between px-3 py-2.5 rounded-lg transition-colors ${
                  isSelected
                    ? 'bg-fl-surface-elevated text-fl-ink border border-fl-accent-border'
                    : 'hover:bg-fl-surface-elevated/60 text-fl-secondary border border-transparent'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="p-1.5 rounded-md bg-fl-surface-subtle border border-fl-border flex-shrink-0">
                    {item.type === 'incident' && (
                      <AlertCircle className="w-4 h-4 text-fl-danger-dot" aria-hidden="true" />
                    )}
                    {item.type === 'scenario' && (
                      <Play className="w-4 h-4 text-fl-accent" aria-hidden="true" />
                    )}
                    {item.type === 'integration' && (
                      <Plug className="w-4 h-4 text-fl-warning-dot" aria-hidden="true" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-fl-ink truncate font-sans">
                      {item.title}
                    </div>
                    <div className="text-xs text-fl-muted truncate font-sans">
                      {item.subtitle}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                  {isSelected && (
                    <span className="flex items-center gap-1 text-[10px] font-mono text-fl-accent-text font-medium">
                      Select <CornerDownLeft className="w-3 h-3" aria-hidden="true" />
                    </span>
                  )}
                  <ArrowRight className="w-3.5 h-3.5 text-fl-muted" aria-hidden="true" />
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* Footer shortcuts */}
      <div className="px-4 py-2 border-t border-fl-border bg-fl-surface-subtle flex items-center justify-between text-xs font-sans text-fl-muted">
        <span>
          Navigate:{' '}
          <kbd className="font-mono text-[10px] px-1 bg-fl-surface border border-fl-border rounded">↑</kbd>{' '}
          <kbd className="font-mono text-[10px] px-1 bg-fl-surface border border-fl-border rounded">↓</kbd> • Select:{' '}
          <kbd className="font-mono text-[10px] px-1 bg-fl-surface border border-fl-border rounded">Enter</kbd>
        </span>
        <span className="text-[11px]">FaultLens Incident Console</span>
      </div>
    </dialog>
  );
};
