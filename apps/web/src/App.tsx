import React, { useState, useEffect } from 'react';
import { apiStore, PLAYGROUND_SCENARIOS, INITIAL_INCIDENTS } from './api/client';
import type { Incident, EvidenceItem, PlaygroundScenario } from './types';
import { Sidebar } from './components/Sidebar';
import { Topbar } from './components/Topbar';
import { CommandPalette } from './components/CommandPalette';
import { EvidenceDrawer } from './components/EvidenceDrawer';
import { OverviewView } from './views/OverviewView';
import { IncidentsView } from './views/IncidentsView';
import { InvestigationView } from './views/InvestigationView';
import { IntegrationsView } from './views/IntegrationsView';
import { PlaygroundView } from './views/PlaygroundView';
import { SettingsView } from './views/SettingsView';

function getInitialTheme(): 'dark' | 'light' {
  try {
    const saved = localStorage.getItem('ws_theme');
    if (saved === 'dark' || saved === 'light') {
      return saved;
    }
    const attr = document.documentElement.getAttribute('data-theme');
    if (attr === 'dark' || attr === 'light') {
      return attr;
    }
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
      return 'light';
    }
  } catch {
    // Fallback to dark if localStorage is unavailable
  }
  return 'dark';
}

export const App: React.FC = () => {
  const [incidents, setIncidents] = useState<Incident[]>(() => apiStore.getIncidents());
  const [integrations] = useState(() => apiStore.getIntegrations());
  const [scenarios] = useState<PlaygroundScenario[]>(PLAYGROUND_SCENARIOS);

  const [currentPage, setCurrentPage] = useState<string>('overview');
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [selectedEvidence, setSelectedEvidence] = useState<EvidenceItem | null>(null);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);

  const [theme, setTheme] = useState<'dark' | 'light'>(getInitialTheme);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.classList.toggle('dark', theme === 'dark');
    try {
      localStorage.setItem('ws_theme', theme);
    } catch {
      // Ignore storage write errors
    }
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  };

  const handleSelectIncident = (id: string) => {
    setSelectedIncidentId(id);
    setCurrentPage('investigation');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleRunScenario = (scen: PlaygroundScenario): Incident => {
    const newInc = apiStore.runScenario(scen);
    setIncidents(apiStore.getIncidents());
    showToast(`Simulation launched: ${scen.title} -> Created ${newInc.key}`);
    return newInc;
  };

  const handleFeedback = (hypothesisId: string, feedback: 'helpful' | 'false_positive') => {
    if (selectedIncidentId) {
      apiStore.updateHypothesisFeedback(selectedIncidentId, hypothesisId, feedback);
      setIncidents(apiStore.getIncidents());
      showToast(feedback === 'helpful' ? 'Marked hypothesis as helpful.' : 'Marked hypothesis as false positive.');
    }
  };

  const handleResetFixtures = () => {
    localStorage.removeItem('ws_incidents');
    setIncidents(INITIAL_INCIDENTS);
    showToast('Reset incident fixtures to initial clean state.');
  };

  const openIncidentsCount = incidents.filter((i) => i.status === 'OPEN' || i.status === 'INVESTIGATING').length;
  const currentIncident = selectedIncidentId
    ? incidents.find((i) => i.id === selectedIncidentId) || incidents[0]
    : incidents[0];

  const getBreadcrumbs = () => {
    if (currentPage === 'overview') return ['Overview'];
    if (currentPage === 'incidents') return ['Incidents Triage'];
    if (currentPage === 'investigation') return ['Incidents', currentIncident.key];
    if (currentPage === 'integrations') return ['Integrations'];
    if (currentPage === 'playground') return ['Playground'];
    if (currentPage === 'settings') return ['Settings'];
    return ['Console'];
  };

  return (
    <div className="flex min-h-screen bg-ws-canvas text-ws-ink font-sans transition-colors duration-150">
      {/* Fixed Sticky Sidebar */}
      <Sidebar
        currentPage={currentPage}
        onNavigate={(page) => {
          setCurrentPage(page);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        openIncidentsCount={openIncidentsCount}
        onShowToast={showToast}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar
          breadcrumbs={getBreadcrumbs()}
          theme={theme}
          onToggleTheme={toggleTheme}
          onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
        />

        <main className="flex-1 p-6 md:p-8 max-w-7xl w-full mx-auto">
          {currentPage === 'overview' && (
            <OverviewView
              incidents={incidents}
              onSelectIncident={handleSelectIncident}
              onNavigate={(page) => setCurrentPage(page)}
            />
          )}

          {currentPage === 'incidents' && (
            <IncidentsView
              incidents={incidents}
              onSelectIncident={handleSelectIncident}
              onShowToast={showToast}
            />
          )}

          {currentPage === 'investigation' && (
            <InvestigationView
              incident={currentIncident}
              onBack={() => setCurrentPage('incidents')}
              onOpenEvidence={(ev) => setSelectedEvidence(ev)}
              onShowToast={showToast}
              onFeedback={handleFeedback}
            />
          )}

          {currentPage === 'integrations' && (
            <IntegrationsView
              integrations={integrations}
              onInspectIntegration={(name) => {
                showToast(`Filtering incidents for ${name}`);
                setCurrentPage('incidents');
              }}
              onShowToast={showToast}
            />
          )}

          {currentPage === 'playground' && (
            <PlaygroundView
              scenarios={scenarios}
              onRunScenario={handleRunScenario}
              onOpenIncident={handleSelectIncident}
            />
          )}

          {currentPage === 'settings' && (
            <SettingsView
              theme={theme}
              onToggleTheme={toggleTheme}
              onResetFixtures={handleResetFixtures}
            />
          )}
        </main>
      </div>

      {/* Command Palette Modal (Cmd+K) */}
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        incidents={incidents}
        integrations={integrations}
        scenarios={scenarios}
        onSelectIncident={handleSelectIncident}
        onSelectPage={(page) => setCurrentPage(page)}
        onRunScenario={handleRunScenario}
      />

      {/* Split Slide-Over Evidence Drawer */}
      <EvidenceDrawer
        evidence={selectedEvidence}
        allEvidence={currentIncident.evidence}
        onClose={() => setSelectedEvidence(null)}
        onSelectEvidence={(ev) => setSelectedEvidence(ev)}
      />

      {/* Global Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-ws-surface text-ws-ink border border-ws-border text-xs px-4 py-3 rounded-md shadow-elevated flex items-center gap-2.5 font-mono">
          <span className="w-2 h-2 rounded-full bg-ws-accent shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
};
