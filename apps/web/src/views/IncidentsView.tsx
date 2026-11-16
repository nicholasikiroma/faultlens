import React, { useState, useEffect, useRef } from 'react';
import type { Incident } from '../types';
import { Badge } from '../components/Badge';
import { Button, EmptyState, Input, PageHeader, Panel, Select, StatCard } from '../components/ui';
import { Search, Filter, X, Download, ArrowRight } from 'lucide-react';

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
      <PageHeader
        eyebrow="Triage Queue"
        title="Incidents"
        description={
          <>
            Fingerprinted integration failures grouped by signature. Navigate with{' '}
            <kbd className="font-mono text-xs px-1.5 py-0.5 rounded bg-fl-surface-subtle border border-fl-border">J</kbd>{' '}
            /{' '}
            <kbd className="font-mono text-xs px-1.5 py-0.5 rounded bg-fl-surface-subtle border border-fl-border">K</kbd>{' '}
            and{' '}
            <kbd className="font-mono text-xs px-1.5 py-0.5 rounded bg-fl-surface-subtle border border-fl-border">Enter</kbd>.
          </>
        }
        actions={
          <Button
            variant="secondary"
            onClick={() => onShowToast('Exporting sanitized JSON bundle of filtered incidents...')}
            leadingIcon={<Download className="w-3.5 h-3.5 text-fl-accent" />}
          >
            Export Report
          </Button>
        }
      />

      {/* Status Summary Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Total Cases" value={incidents.length} />
        <StatCard label="High / Critical" value={criticalCount} tone="danger" />
        <StatCard label="Investigating" value={investigatingCount} tone="violet" />
        <StatCard label="Resolved" value={resolvedCount} tone="success" />
      </div>

      {/* Filter Bar */}
      <Panel padding="sm" className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[240px]">
            <Input
              ref={searchInputRef}
              type="search"
              aria-label="Search incidents"
              leadingIcon={<Search className="w-4 h-4" />}
              placeholder="Search incidents, keys, error classes (press '/' to focus)..."
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelectedIndex(0);
              }}
            />
          </div>

          <div className="flex items-center gap-2">
            <Filter className="w-3.5 h-3.5 text-fl-muted" aria-hidden="true" />
            <Select
              aria-label="Filter by status"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setSelectedIndex(0);
              }}
            >
              <option value="">All Statuses</option>
              <option value="INVESTIGATING">INVESTIGATING</option>
              <option value="OPEN">OPEN</option>
              <option value="RESOLVED">RESOLVED</option>
            </Select>
          </div>

          <Select
            aria-label="Filter by failure class"
            value={classFilter}
            onChange={(e) => {
              setClassFilter(e.target.value);
              setSelectedIndex(0);
            }}
          >
            <option value="">All Failure Classes</option>
            <option value="RATE_LIMIT">RATE_LIMIT</option>
            <option value="SCHEMA_MISMATCH">SCHEMA_MISMATCH</option>
            <option value="NETWORK_TIMEOUT">NETWORK_TIMEOUT</option>
            <option value="INVALID_SIGNATURE">INVALID_SIGNATURE</option>
          </Select>

          {hasActiveFilters && (
            <Button
              size="sm"
              variant="secondary"
              onClick={clearFilters}
              leadingIcon={<X className="w-3.5 h-3.5" />}
            >
              Clear filters
            </Button>
          )}
        </div>

        <div className="flex items-center justify-between text-xs font-sans text-fl-muted pt-2 border-t border-fl-border-subtle">
          <span>
            Press <kbd className="font-mono text-[10px] px-1.5 py-0.5 bg-fl-surface-subtle border border-fl-border rounded">/</kbd> to search
          </span>
          <span className="text-fl-secondary font-medium">
            <span className="font-mono tabular-nums">{filteredIncidents.length}</span> matching cases
          </span>
        </div>
      </Panel>

      {/* Incidents Table */}
      <Panel padding="none" className="overflow-hidden">
        <div
          tabIndex={0}
          role="region"
          aria-label="Incidents queue table"
          className="overflow-x-auto focus:outline-none"
        >
          <table className="w-full text-left text-fl-table font-sans border-collapse">
            <thead className="bg-fl-surface-subtle border-b border-fl-border text-xs font-sans font-medium text-fl-muted sticky top-0 z-10">
              <tr>
                <th className="py-3 pl-3 pr-0 w-3" aria-label="Priority indicator" />
                <th className="py-3 px-4">Incident Case</th>
                <th className="py-3 px-4">Source</th>
                <th className="py-3 px-4">Failure Class</th>
                <th className="py-3 px-4 text-center">Events</th>
                <th className="py-3 px-4">Severity</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Last Seen</th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-fl-border-subtle">
              {filteredIncidents.length === 0 ? (
                <tr>
                  <td colSpan={9}>
                    <EmptyState
                      title="No incidents match these filters"
                      description="Try clearing your search or selecting another failure class."
                      action={
                        hasActiveFilters ? (
                          <Button size="sm" variant="secondary" onClick={clearFilters}>
                            Reset filters
                          </Button>
                        ) : undefined
                      }
                    />
                  </td>
                </tr>
              ) : (
                filteredIncidents.map((incident, idx) => {
                  const isSelected = idx === selectedIndex;
                  const isUrgent = incident.severity === 'CRITICAL' || incident.severity === 'HIGH';
                  const isResolved = incident.status === 'RESOLVED';

                  return (
                    <tr
                      key={incident.id}
                      onClick={() => onSelectIncident(incident.id)}
                      onMouseEnter={() => setSelectedIndex(idx)}
                      className={`cursor-pointer transition-colors group ${
                        isSelected ? 'bg-fl-surface-elevated' : 'hover:bg-fl-surface-subtle'
                      }`}
                    >
                      <td className="py-3.5 pl-3 pr-0 w-3">
                        <div
                          className={`w-1 h-7 rounded-full ${
                            isResolved
                              ? 'bg-fl-success-dot'
                              : isUrgent
                              ? 'bg-fl-danger-dot'
                              : 'bg-fl-warning-dot'
                          }`}
                        />
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-fl-ink group-hover:text-fl-accent-text transition-colors">
                          {incident.title}
                        </div>
                        <div className="text-[11px] font-mono text-fl-muted mt-0.5">
                          {incident.key}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-fl-secondary font-medium">
                        {incident.integration}
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="font-mono text-[11px] text-fl-ink bg-fl-surface-subtle px-2 py-0.5 rounded border border-fl-border">
                          {incident.cls}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 font-mono text-center font-medium text-fl-ink tabular-nums text-xs">
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
                      <td className="py-3.5 px-4 font-mono text-[11px] text-fl-muted whitespace-nowrap tabular-nums">
                        {incident.seen}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <span
                          className={`inline-flex items-center gap-1 text-xs font-sans font-medium text-fl-accent-text transition-opacity ${
                            isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                          }`}
                        >
                          <span>Inspect</span>
                          <ArrowRight className="w-3 h-3" aria-hidden="true" />
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
};
