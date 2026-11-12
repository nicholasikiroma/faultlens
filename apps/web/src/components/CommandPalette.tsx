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
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setQuery('');
      setSelectedIndex(0);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (isOpen) onClose();
      } else if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

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
    type: 'incident' | 'integration' | 'scenario' | 'nav';
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
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : flatItems.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (flatItems[selectedIndex]) {
        flatItems[selectedIndex].action();
      }
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-ws-backdrop backdrop-blur-[2px] p-4 sm:p-6 md:p-20 flex justify-center items-start"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl bg-ws-surface border border-ws-border rounded-lg shadow-elevated overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Input Bar */}
        <div className="relative flex items-center border-b border-ws-border px-4 py-3 bg-ws-surface-subtle">
          <Search className="w-4 h-4 text-ws-accent mr-3 flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            className="w-full bg-transparent text-sm text-ws-ink placeholder:text-ws-muted outline-none font-sans"
            placeholder="Search incidents, trace IDs, integrations, or run a scenario..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
          />
          <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-mono font-medium bg-ws-surface border border-ws-border rounded text-ws-muted">
            ESC
          </kbd>
        </div>

        {/* Results List */}
        <div className="max-h-96 overflow-y-auto p-2 divide-y divide-ws-border-subtle">
          {flatItems.length === 0 ? (
            <div className="p-8 text-center text-xs text-ws-muted font-mono">
              No matching records found for "{query}".
            </div>
          ) : (
            flatItems.map((item, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <div
                  key={`${item.type}-${item.id}`}
                  onClick={item.action}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`flex items-center justify-between px-3 py-2.5 rounded-md cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-ws-surface-elevated text-ws-ink border border-ws-accent-border'
                      : 'hover:bg-ws-surface-elevated/60 text-ws-secondary border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="p-1.5 rounded bg-ws-surface-subtle border border-ws-border flex-shrink-0">
                      {item.type === 'incident' && <AlertCircle className="w-4 h-4 text-ws-danger-dot" />}
                      {item.type === 'scenario' && <Play className="w-4 h-4 text-ws-accent" />}
                      {item.type === 'integration' && <Plug className="w-4 h-4 text-ws-warning-dot" />}
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-ws-ink truncate">{item.title}</div>
                      <div className="text-[11px] text-ws-muted truncate">{item.subtitle}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                    {isSelected && (
                      <span className="flex items-center gap-1 text-[10px] font-mono text-ws-accent font-semibold">
                        Select <CornerDownLeft className="w-3 h-3" />
                      </span>
                    )}
                    <ArrowRight className="w-3.5 h-3.5 text-ws-muted" />
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer shortcuts */}
        <div className="px-4 py-2 border-t border-ws-border bg-ws-surface-subtle flex items-center justify-between text-[10px] font-mono text-ws-muted">
          <span>Navigate: ↑ ↓ • Select: Enter</span>
          <span>WireSleuth Telemetry Console</span>
        </div>
      </div>
    </div>
  );
};
