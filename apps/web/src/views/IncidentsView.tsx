import React, { useState, useEffect, useRef } from 'react';
import type { Incident } from '../types';
import { Badge } from '../components/Badge';
import { Search, Filter, X, Download } from 'lucide-react';

interface IncidentsViewProps {
  incidents: Incident[];
  onSelectIncident: (id: string) => void;
  onShowToast: (msg: string) => void;
}

export const IncidentsView: React.FC<IncidentsViewProps> = ({
  incidents,
  onSelectIncident,
  onShowToast,
}) => {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const filteredIncidents = incidents.filter((i) => {
    const q = query.toLowerCase();
    const matchQ =
      !q || [i.title, i.key, i.integration, i.cls].join(' ').toLowerCase().includes(q);
    const matchStatus = !statusFilter || i.status === statusFilter;
    const matchClass = !classFilter || i.cls === classFilter;
    return matchQ && matchStatus && matchClass;
  });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement === searchInputRef.current) {
        if (e.key === 'Escape') {
          searchInputRef.current?.blur();
        }
        return;
      }

      if (e.key === '/') {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev < filteredIncidents.length - 1 ? prev + 1 : prev));
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filteredIncidents[selectedIndex]) {
          onSelectIncident(filteredIncidents[selectedIndex].id);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [filteredIncidents, selectedIndex, onSelectIncident]);

  const clearFilters = () => {
    setQuery('');
    setStatusFilter('');
    setClassFilter('');
    setSelectedIndex(0);
  };

  const hasActiveFilters = Boolean(query || statusFilter || classFilter);

  return (
    <div className="space-y-6">
      {/* Page Head */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="text-[10px] font-mono font-semibold tracking-widest text-ws-accent uppercase">
            TRIAGE QUEUE
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-ws-ink mt-0.5">Incidents</h1>
          <p className="text-xs text-ws-secondary mt-1">
            Grouped integration failures and anomaly signatures. Select a case to inspect evidence.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => onShowToast('Exporting sanitized JSON bundle of all filtered incidents...')}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-md bg-ws-surface border border-ws-border hover:border-ws-border-strong text-ws-ink hover:bg-ws-surface-elevated text-xs font-semibold shadow-subtle transition-colors"
          >
            <Download className="w-3.5 h-3.5 text-ws-accent" />
            <span>Export Triage Report</span>
          </button>
        </div>
      </div>

      {/* Filter Console */}
      <div className="p-4 rounded-lg bg-ws-surface border border-ws-border shadow-subtle space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          {/* Search Input */}
          <div className="relative flex-1 min-w-[240px]">
            <Search className="w-4 h-4 text-ws-muted absolute left-3 top-2.5" />
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search incidents, keys, error classes (Press '/' to focus)..."
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelectedIndex(0);
              }}
              className="w-full pl-9 pr-4 py-2 bg-ws-surface-subtle border border-ws-border rounded-md text-xs text-ws-ink placeholder:text-ws-muted focus:outline-none focus:border-ws-accent font-sans transition-colors"
            />
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-2">
            <Filter className="w-3.5 h-3.5 text-ws-muted" />
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setSelectedIndex(0);
              }}
              className="px-3 py-2 bg-ws-surface-subtle border border-ws-border rounded-md text-xs text-ws-ink focus:outline-none focus:border-ws-accent transition-colors"
            >
              <option value="">All Statuses</option>
              <option value="INVESTIGATING">INVESTIGATING</option>
              <option value="OPEN">OPEN</option>
              <option value="RESOLVED">RESOLVED</option>
            </select>
          </div>

          {/* Class Filter */}
          <div>
            <select
              value={classFilter}
              onChange={(e) => {
                setClassFilter(e.target.value);
                setSelectedIndex(0);
              }}
              className="px-3 py-2 bg-ws-surface-subtle border border-ws-border rounded-md text-xs text-ws-ink focus:outline-none focus:border-ws-accent font-mono transition-colors"
            >
              <option value="">All Failure Classes</option>
              <option value="RATE_LIMIT">RATE_LIMIT</option>
              <option value="SCHEMA_MISMATCH">SCHEMA_MISMATCH</option>
              <option value="NETWORK_TIMEOUT">NETWORK_TIMEOUT</option>
              <option value="INVALID_SIGNATURE">INVALID_SIGNATURE</option>
            </select>
          </div>

          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs text-ws-secondary hover:text-ws-ink bg-ws-surface-subtle hover:bg-ws-surface-elevated border border-ws-border transition-colors"
            >
              <X className="w-3.5 h-3.5" />
              <span>Clear filters</span>
            </button>
          )}
        </div>

        {/* Keyboard Triage Instructions Hint */}
        <div className="flex items-center justify-between text-[11px] font-mono text-ws-muted pt-2 border-t border-ws-border">
          <span>
            Keyboard navigation: <kbd className="px-1.5 py-0.5 bg-ws-surface-subtle border border-ws-border rounded">J</kbd> down •{' '}
            <kbd className="px-1.5 py-0.5 bg-ws-surface-subtle border border-ws-border rounded">K</kbd> up •{' '}
            <kbd className="px-1.5 py-0.5 bg-ws-surface-subtle border border-ws-border rounded">Enter</kbd> open case
          </span>
          <span className="font-medium text-ws-secondary">{filteredIncidents.length} matching incident records</span>
        </div>
      </div>

      {/* Incidents Data Table */}
      <div className="rounded-lg bg-ws-surface border border-ws-border shadow-subtle overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-ws-surface-subtle border-b border-ws-border text-[10px] font-mono uppercase text-ws-muted">
              <tr>
                <th className="py-3 px-4 font-semibold">Incident Case</th>
                <th className="py-3 px-4 font-semibold">Integration Source</th>
                <th className="py-3 px-4 font-semibold">Failure Class</th>
                <th className="py-3 px-4 font-semibold text-center">Events</th>
                <th className="py-3 px-4 font-semibold">Severity</th>
                <th className="py-3 px-4 font-semibold">Status</th>
                <th className="py-3 px-4 font-semibold">Last Seen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ws-border">
              {filteredIncidents.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-xs text-ws-muted">
                    No incident cases match the selected filters.
                  </td>
                </tr>
              ) : (
                filteredIncidents.map((incident, idx) => {
                  const isSelected = idx === selectedIndex;
                  return (
                    <tr
                      key={incident.id}
                      onClick={() => onSelectIncident(incident.id)}
                      onMouseEnter={() => setSelectedIndex(idx)}
                      className={`cursor-pointer transition-colors group ${
                        isSelected
                          ? 'bg-ws-surface-elevated border-l-2 border-ws-accent font-medium'
                          : 'hover:bg-ws-surface-elevated/60'
                      }`}
                    >
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-ws-ink group-hover:text-ws-accent transition-colors">
                          {incident.title}
                        </div>
                        <div className="text-[10px] font-mono text-ws-muted mt-0.5">
                          {incident.key}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-ws-secondary font-medium">
                        {incident.integration}
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="font-mono text-[11px] text-ws-ink bg-ws-surface-subtle px-2 py-0.5 rounded border border-ws-border">
                          {incident.cls}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 font-mono text-center font-semibold text-ws-ink tabular-nums">
                        {incident.events}
                      </td>
                      <td className="py-3.5 px-4">
                        <Badge severity={incident.severity} />
                      </td>
                      <td className="py-3.5 px-4">
                        <Badge
                          status={incident.status}
                          withPulse={incident.status === 'INVESTIGATING'}
                        />
                      </td>
                      <td className="py-3.5 px-4 font-mono text-[11px] text-ws-muted">
                        {incident.seen}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
