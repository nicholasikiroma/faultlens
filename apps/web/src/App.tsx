import React, { useState, useEffect, useRef } from 'react';
import { apiStore, PLAYGROUND_SCENARIOS, INITIAL_INCIDENTS } from './api/client';
import type { Incident, EvidenceItem, PlaygroundScenario, IncidentStatus } from './types';
import { Sidebar } from './components/Sidebar';
import { Topbar } from './components/Topbar';
import { CommandPalette } from './components/CommandPalette';
import { EvidenceDrawer } from './components/EvidenceDrawer';
import { IncidentToast } from './components/IncidentToast';
import { OverviewView } from './views/OverviewView';
import { IncidentsView } from './views/IncidentsView';
import { InvestigationView } from './views/InvestigationView';
import { IntegrationsView } from './views/IntegrationsView';
import { PlaygroundView } from './views/PlaygroundView';
import { SettingsView } from './views/SettingsView';

function getInitialTheme(): 'dark' | 'light' {
  try {
    const saved = localStorage.getItem('fl_theme');
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
  const integrations = apiStore.getIntegrations();
  const [scenarios] = useState<PlaygroundScenario[]>(PLAYGROUND_SCENARIOS);

  const [currentPage, setCurrentPage] = useState<string>('overview');
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [selectedEvidence, setSelectedEvidence] = useState<EvidenceItem | null>(null);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);

  const [isLiveConnected, setIsLiveConnected] = useState<boolean>(false);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState<boolean>(false);

  const [isRecording, setIsRecording] = useState<boolean>(true);
  const [sessionUptime, setSessionUptime] = useState<number>(0);

  const [theme, setTheme] = useState<'dark' | 'light'>(getInitialTheme);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [streamToastIncident, setStreamToastIncident] = useState<Incident | null>(null);

  // Track real session elapsed uptime when recorder is active
  useEffect(() => {
    if (!isRecording) return;
    const timer = setInterval(() => {
      setSessionUptime((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [isRecording]);

  // Track observed incidents and their latest event counts for real-time ingress alerts
  const prevIncidentStatsRef = useRef<Map<string, { events: number; lastSeenAt: number }>>(
    new Map()
  );

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const meta = document.querySelector('meta[name="color-scheme"]');
    if (meta) meta.setAttribute('content', theme);
    try {
      localStorage.setItem('fl_theme', theme);
    } catch {
      // Ignore storage write errors
    }
  }, [theme]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'fl_theme' && (e.newValue === 'dark' || e.newValue === 'light')) {
        setTheme(e.newValue);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Live Backend Polling & Connection Health Monitor (3-second real-time streaming)
  useEffect(() => {
    let isMounted = true;

    const pollBackend = async () => {
      if (!isRecording) return; // Suspends polling when placed in Standby mode

      const health = await apiStore.checkHealth();
      if (!isMounted) return;

      setIsLiveConnected(health.connected);
      setLatencyMs(health.latencyMs);

      if (health.connected) {
        const liveIncidents = await apiStore.fetchIncidents();
        if (isMounted && liveIncidents.length > 0) {
          const prevStats = prevIncidentStatsRef.current;
          let activeStreamHit: Incident | null = null;

          if (prevStats.size > 0) {
            // Check for brand new incidents OR existing incidents with new failure events
            for (const inc of liveIncidents) {
              const prev = prevStats.get(inc.id);
              if (!prev) {
                activeStreamHit = inc;
                break;
              } else if (inc.events > prev.events) {
                activeStreamHit = inc;
                break;
              }
            }
          }

          // Update known stats
          for (const inc of liveIncidents) {
            prevStats.set(inc.id, {
              events: inc.events,
              lastSeenAt: inc.lastSeenTimestamp ?? Date.now(),
            });
          }

          if (activeStreamHit) {
            setStreamToastIncident({ ...activeStreamHit });
          }

          setIncidents(liveIncidents);
        }
      }
    };

    void pollBackend();
    const interval = setInterval(pollBackend, 3000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [isRecording]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  };

  const handleRetryConnection = async () => {
    showToast('Probing backend API at 127.0.0.1:3000...');
    const health = await apiStore.checkHealth();
    setIsLiveConnected(health.connected);
    setLatencyMs(health.latencyMs);

    if (health.connected) {
      const live = await apiStore.fetchIncidents();
      setIncidents(live);
      showToast(`Connected to Live Backend API (Ping: ${health.latencyMs ?? 1}ms).`);
    } else {
      showToast('Backend API is offline. Operating in Local Simulator Mode.');
    }
  };

  const handleSelectIncident = async (id: string) => {
    setSelectedIncidentId(id);
    setCurrentPage('investigation');
    window.scrollTo({ top: 0, behavior: 'smooth' });

    // On-demand detail fetching from GET /v1/incidents/:id/export
    setIsLoadingDetail(true);
    try {
      await apiStore.fetchIncidentDetail(id);
      setIncidents(apiStore.getIncidents());
    } finally {
      setIsLoadingDetail(false);
    }
  };

  const handleRunScenario = async (scen: PlaygroundScenario): Promise<Incident> => {
    const newInc = await apiStore.runScenario(scen);
    setIncidents(apiStore.getIncidents());
    showToast(`Simulation launched: ${scen.title} -> Created ${newInc.key}`);
    return newInc;
  };

  const handleFeedback = async (hypothesisId: string, feedback: 'helpful' | 'false_positive') => {
    if (selectedIncidentId) {
      await apiStore.updateHypothesisFeedback(selectedIncidentId, hypothesisId, feedback);
      setIncidents(apiStore.getIncidents());
      showToast(feedback === 'helpful' ? 'Marked hypothesis as helpful.' : 'Marked hypothesis as false positive.');
    }
  };

  const handleStatusChange = async (newStatus: IncidentStatus) => {
    if (selectedIncidentId) {
      await apiStore.updateIncidentStatus(selectedIncidentId, newStatus);
      setIncidents(apiStore.getIncidents());
      showToast(`Incident status transitioned to ${newStatus}.`);
    }
  };

  const handleResetFixtures = () => {
    apiStore.resetFixtures();
    setIncidents(INITIAL_INCIDENTS);
    showToast('Reset incident fixtures to initial clean state.');
  };

  const openIncidentsCount = incidents.filter((i) => i.status === 'OPEN' || i.status === 'INVESTIGATING').length;
  const currentIncident: Incident =
    (selectedIncidentId
      ? incidents.find((i) => i.id === selectedIncidentId) || incidents[0]
      : incidents[0]) || INITIAL_INCIDENTS[0];

  const getBreadcrumbs = () => {
    if (currentPage === 'overview') return ['Overview'];
    if (currentPage === 'incidents') return ['Incidents Triage'];
    if (currentPage === 'investigation') return ['Incidents', currentIncident?.key ?? 'INC'];
    if (currentPage === 'integrations') return ['Integrations'];
    if (currentPage === 'playground') return ['Playground'];
    if (currentPage === 'settings') return ['Settings'];
    return ['Console'];
  };

  // Dynamic telemetry buffer calculation based on active in-memory incident records
  const bufferKb = Math.min(
    64,
    Number((JSON.stringify(incidents).length / 1024).toFixed(1))
  );

  return (
    <div className="flex min-h-screen bg-fl-canvas text-fl-ink font-sans transition-colors duration-150">
      {/* Fixed Sticky Sidebar */}
      <Sidebar
        currentPage={currentPage}
        onNavigate={(page) => {
          setCurrentPage(page);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        openIncidentsCount={openIncidentsCount}
        isLiveConnected={isLiveConnected}
        isRecording={isRecording}
        uptimeSeconds={sessionUptime}
        bufferKb={bufferKb}
        onToggleRecording={() => {
          setIsRecording((prev) => {
            const next = !prev;
            showToast(
              next
                ? 'Live stream polling resumed.'
                : 'Live stream paused (standby mode).'
            );
            return next;
          });
        }}
        onFlushBuffer={() => {
          showToast('Refreshing incident stream...');
          void apiStore.fetchIncidents().then((incs) => setIncidents(incs));
        }}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar
          breadcrumbs={getBreadcrumbs()}
          theme={theme}
          isLiveConnected={isLiveConnected}
          isRecording={isRecording}
          latencyMs={latencyMs}
          onToggleTheme={toggleTheme}
          onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
          onRetryConnection={handleRetryConnection}
        />

        <main className="flex-1 p-6 md:p-8 max-w-[1440px] w-full mx-auto">
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
              isLoadingDetail={isLoadingDetail}
              onBack={() => setCurrentPage('incidents')}
              onOpenEvidence={(ev) => setSelectedEvidence(ev)}
              onShowToast={showToast}
              onFeedback={handleFeedback}
              onStatusChange={handleStatusChange}
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
              isLiveConnected={isLiveConnected}
              latencyMs={latencyMs}
              onToggleTheme={toggleTheme}
              onResetFixtures={handleResetFixtures}
              onTestConnection={handleRetryConnection}
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
        allEvidence={currentIncident?.evidence ?? []}
        onClose={() => setSelectedEvidence(null)}
        onSelectEvidence={(ev) => setSelectedEvidence(ev)}
      />

      {/* Real-Time Ingress Stream Toast */}
      {streamToastIncident && (
        <IncidentToast
          key={`${streamToastIncident.id}-${streamToastIncident.events}`}
          incident={streamToastIncident}
          onDismiss={() => setStreamToastIncident(null)}
          onInvestigate={(id) => {
            handleSelectIncident(id);
            setStreamToastIncident(null);
          }}
        />
      )}

      {/* Global Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-fl-surface text-fl-ink border border-fl-border text-[13px] font-sans font-medium px-4 py-3 rounded-lg shadow-elevated flex items-center gap-2.5">
          <span className="w-2 h-2 rounded-full bg-fl-accent shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
};
