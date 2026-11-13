import React, { useState, useEffect, useRef } from 'react';
import type { Incident } from '../types';
import { Badge } from '../components/Badge';
import { Search, Filter, X, Download, ArrowRight, CornerDownLeft, Activity } from 'lucide-react';

interface IncidentsViewProps {
  incidents: Incident[];
  onSelectIncident: (id: string) => void;
  onShowToast: (msg: string) => void;
}

export const IncidentsView: React.FC<IncidentsViewProps> = ({
  incidents = [],
  onSelectIncident,
  onShowToast,
}) => {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const filteredIncidents = [...incidents]
    .sort((a, b) => (b.lastSeenTimestamp ?? 0) - (a.lastSeenTimestamp ?? 0))
    .filter((i) => {
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

  const criticalCount = incidents.filter((i) => i.severity === 'CRITICAL' || i.severity === 'HIGH').length;
  const investigatingCount = incidents.filter((i) => i.status === 'INVESTIGATING').length;
  const resolvedCount = incidents.filter((i) => i.status === 'RESOLVED').length;

  return (
    <div className="space-y-6">
      {/* 1. Confident Editorial Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 pb-2 border-b border-ws-border">
        <div>
          <div className="ws-eyebrow text-ws-accent mb-1 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-ws-accent animate-ping" />
            INCIDENT TRIAGE & ANOMALY ROUTING
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-ws-ink font-sans leading-tight">
            Triage Queue
          </h1>
          <p className="text-[14px] text-ws-secondary mt-1 font-sans leading-relaxed">
            Fingerprinted integration anomalies grouped by error signature. Navigate via <kbd className="font-mono text-xs px-1.5 py-0.2 rounded bg-ws-surface-subtle border border-ws-border">J</kbd> / <kbd className="font-mono text-xs px-1.5 py-0.2 rounded bg-ws-surface-subtle border border-ws-border">K</kbd> and <kbd className="font-mono text-xs px-1.5 py-0.2 rounded bg-ws-surface-subtle border border-ws-border">Enter</kbd>.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => onShowToast('Exporting sanitized JSON bundle of all filtered incidents...')}
            className="ws-tactile-btn inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-ws-surface border border-ws-border hover:border-ws-border-strong text-ws-ink hover:bg-ws-surface-elevated text-[13px] font-medium font-sans shadow-subtle"
          >
            <Download className="w-3.5 h-3.5 text-ws-accent" />
            <span>Export Triage Report</span>
          </button>
        </div>
      </div>

      {/* 2. High-Density Status Strip (Linear-Style Refined Metadata) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3.5 rounded-lg bg-ws-surface border border-ws-border shadow-subtle space-y-1">
          <span className="text-[10px] font-mono text-ws-muted uppercase block">Total Incident Cases</span>
          <span className="text-2xl font-mono font-medium text-ws-ink tabular-nums">{incidents.length}</span>
        </div>
        <div className="p-3.5 rounded-lg bg-ws-surface border border-ws-border shadow-subtle space-y-1">
          <span className="text-[10px] font-mono text-ws-danger-text uppercase block">Critical Priority</span>
          <span className="text-2xl font-mono font-medium text-ws-danger-text tabular-nums">{criticalCount}</span>
        </div>
        <div className="p-3.5 rounded-lg bg-ws-surface border border-ws-border shadow-subtle space-y-1">
          <span className="text-[10px] font-mono text-ws-lavender-text uppercase block">Investigating</span>
          <span className="text-2xl font-mono font-medium text-ws-lavender-text tabular-nums">{investigatingCount}</span>
        </div>
        <div className="p-3.5 rounded-lg bg-ws-surface border border-ws-border shadow-subtle space-y-1">
          <span className="text-[10px] font-mono text-ws-success-text uppercase block">Resolved</span>
          <span className="text-2xl font-mono font-medium text-ws-success-text tabular-nums">{resolvedCount}</span>
        </div>
      </div>

      {/* 3. Filter Console */}
      <div className="p-4 rounded-xl bg-ws-surface border border-ws-border shadow-subtle space-y-3">
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
              className="w-full pl-9 pr-4 py-2 bg-ws-surface-subtle border border-ws-border rounded-lg text-[13px] text-ws-ink placeholder:text-ws-muted focus:outline-none focus:border-ws-accent font-sans transition-colors"
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
              className="px-3 py-2 bg-ws-surface-subtle border border-ws-border rounded-lg text-[13px] font-sans text-ws-ink focus:outline-none focus:border-ws-accent transition-colors"
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
              className="px-3 py-2 bg-ws-surface-subtle border border-ws-border rounded-lg text-[13px] font-sans text-ws-ink focus:outline-none focus:border-ws-accent transition-colors"
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
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-sans font-medium text-ws-secondary hover:text-ws-ink bg-ws-surface-subtle hover:bg-ws-surface-elevated border border-ws-border transition-colors ws-tactile-btn"
            >
              <X className="w-3.5 h-3.5" />
              <span>Clear filters</span>
            </button>
          )}
        </div>

        {/* Keyboard Triage Instructions Hint */}
        <div className="flex items-center justify-between text-[11px] font-sans text-ws-muted pt-2 border-t border-ws-border">
          <span>
            Keyboard navigation: <kbd className="font-mono text-[10px] px-1.5 py-0.5 bg-ws-surface-subtle border border-ws-border rounded">J</kbd> down •{' '}
            <kbd className="font-mono text-[10px] px-1.5 py-0.5 bg-ws-surface-subtle border border-ws-border rounded">K</kbd> up •{' '}
            <kbd className="font-mono text-[10px] px-1.5 py-0.5 bg-ws-surface-subtle border border-ws-border rounded">Enter</kbd> open case
          </span>
          <span className="font-sans text-ws-secondary font-medium"><span className="font-mono tabular-nums">{filteredIncidents.length}</span> matching cases</span>
        </div>
      </div>

      {/* 4. Linear-Style Refined Incidents Table */}
      <div className="rounded-xl bg-ws-surface border border-ws-border shadow-subtle overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px] font-sans">
            <thead className="bg-ws-surface-subtle border-b border-ws-border text-xs font-sans font-medium text-ws-muted">
              <tr>
                <th className="py-3 px-4 w-6"></th>
                <th className="py-3 px-4">Incident Case</th>
                <th className="py-3 px-4">Integration Source</th>
                <th className="py-3 px-4">Failure Class</th>
                <th className="py-3 px-4 text-center">Events</th>
                <th className="py-3 px-4">Severity</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Last Seen</th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ws-border-subtle">
              {filteredIncidents.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-xs font-sans text-ws-muted">
                    No incident cases match the selected filters.
                  </td>
                </tr>
              ) : (
                filteredIncidents.map((incident, idx) => {
                  const isSelected = idx === selectedIndex;
                  const isUrgent = incident.severity === 'CRITICAL' || incident.severity === 'HIGH';
                  const isResolved = incident.status === 'RESOLVED';
                  const activeRecent = incident.lastSeenTimestamp && Date.now() - incident.lastSeenTimestamp < 60_000;

                  return (
                    <tr
                      key={incident.id}
                      onClick={() => onSelectIncident(incident.id)}
                      onMouseEnter={() => setSelectedIndex(idx)}
                      className={`cursor-pointer transition-colors group relative ${
                        isSelected
                          ? 'bg-ws-surface-elevated'
                          : 'hover:bg-ws-surface-subtle/70'
                      }`}
                    >
                      {/* Left Subtle State Ribbon */}
                      <td className="py-3.5 pl-3 pr-0 w-2">
                        <div
                          className={`w-1 h-8 rounded-full transition-colors ${
                            isResolved
                              ? 'bg-ws-success-dot'
                              : isUrgent
                              ? 'bg-ws-danger-dot'
                              : 'bg-ws-warning-dot'
                          }`}
                        />
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-ws-ink group-hover:text-ws-accent transition-colors flex items-center gap-2">
                          <span>{incident.title}</span>
                          {activeRecent && (
                            <span className="w-1.5 h-1.5 rounded-full bg-ws-success-dot animate-pulse" title="Active ingress event within 60s" />
                          )}
                        </div>
                        <div className="text-[11px] font-mono text-ws-muted mt-0.5">
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
                      <td className="py-3.5 px-4 font-mono text-center font-medium text-ws-ink tabular-nums text-xs">
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
                      <td className="py-3.5 px-4 font-mono text-[11px] text-ws-muted whitespace-nowrap tabular-nums">
                        {incident.seen}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <span className={`inline-flex items-center gap-1 text-xs font-sans font-medium text-ws-accent transition-opacity ${
                          isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                        }`}>
                          <span>Inspect</span>
                          <ArrowRight className="w-3 h-3" />
                        </span>
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
