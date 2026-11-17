import type {
  AgentSettingsSummary,
  Incident,
  IntegrationItem,
  PlaygroundScenario,
} from '../types';
import {
  toFrontendIncidentSummary,
  toFrontendIncidentDetail,
  type BackendIncidentSummary,
  type BackendExportIncidentResult,
} from './adapters';

export const INITIAL_INCIDENTS: Incident[] = [
  {
    id: 'inc_demo_429',
    key: 'INC-1042',
    title: 'Upstream rate-limit responses',
    integration: 'Demo Billing Webhook',
    cls: 'RATE_LIMIT',
    events: 3,
    severity: 'MEDIUM',
    status: 'INVESTIGATING',
    seen: '11:42 AM',
    firstSeen: '05 Nov 2026, 10:00 UTC',
    known: 'Three attempts received HTTP 429 from the upstream billing provider endpoint.',
    suspect: 'The integration is exceeding its assigned 100 req/min rate limit during subscription renewal bursts.',
    next: 'Inspect upstream headers (Retry-After, X-RateLimit-Reset) and adjust worker exponential backoff.',
    timeline: [
      {
        id: 'tl_1',
        time: '10:00:00.120',
        title: 'Webhook received & authenticated',
        description: 'A signed Stripe billing event entered the ingress pipeline. Signature verified via HMAC-SHA256.',
        severity: 'normal',
        evidenceId: 'evd_100',
      },
      {
        id: 'tl_2',
        time: '10:00:01.345',
        title: 'Upstream attempt_01 returned HTTP 429',
        description: 'First delivery attempt received status 429 (Too Many Requests). Header: Retry-After: 60.',
        severity: 'warn',
        evidenceId: 'evd_101',
      },
      {
        id: 'tl_3',
        time: '10:02:01.890',
        title: 'Retry attempt_02 returned HTTP 429 again',
        description: 'Second retry did not recover; provider quota was still saturated.',
        severity: 'danger',
        evidenceId: 'evd_102',
      },
      {
        id: 'tl_4',
        time: '10:05:03.412',
        title: 'Deterministic rule RATE_LIMIT_V1 triggered',
        description: 'Classified incident as RATE_LIMIT. Incident INC-1042 opened and routed to triage.',
        severity: 'warn',
        evidenceId: 'evd_103',
      },
    ],
    evidence: [
      {
        id: 'evd_100',
        title: 'Ingress Webhook Receipt',
        description: 'Verified inbound webhook signature from billing provider.',
        source: 'ingress_verifier',
        epistemic: 'OBSERVED',
        data: {
          traceId: 'trc_994821a8f',
          eventId: 'evt_stripe_inv_92',
          headers: {
            'stripe-signature': 't=1730800800,v1=9f83...[REDACTED]',
            'content-type': 'application/json',
          },
          payload: {
            id: 'evt_1Qxyz9',
            object: 'event',
            type: 'invoice.payment_succeeded',
            customer_email: 'user_***@company.io',
          },
        },
      },
      {
        id: 'evd_101',
        title: 'Attempt 01: HTTP 429 Response',
        description: 'Upstream response headers captured by socket observer.',
        source: 'attempt_01',
        epistemic: 'OBSERVED',
        data: {
          attempt: 1,
          status: 429,
          durationMs: 225,
          headers: {
            'retry-after': '60',
            'x-ratelimit-limit': '100',
            'x-ratelimit-remaining': '0',
          },
          body: { error: 'Rate limit exceeded', code: 'rate_limited' },
        },
      },
      {
        id: 'evd_102',
        title: 'Attempt 02: HTTP 429 Response',
        description: 'Second retry attempt also rejected with 429.',
        source: 'attempt_02',
        epistemic: 'OBSERVED',
        data: {
          attempt: 2,
          status: 429,
          durationMs: 211,
          headers: {
            'retry-after': '120',
            'x-ratelimit-limit': '100',
            'x-ratelimit-remaining': '0',
          },
          body: { error: 'Rate limit exceeded', code: 'rate_limited' },
        },
      },
      {
        id: 'evd_103',
        title: 'Rule Classification Receipt',
        description: 'Deterministic match on 3 consecutive 429 status codes.',
        source: 'rules_engine',
        epistemic: 'RULE',
        data: {
          ruleId: 'RATE_LIMIT_V1',
          threshold: 3,
          windowSeconds: 300,
          matchedAttempts: ['attempt_01', 'attempt_02'],
        },
      },
    ],
    attempts: [
      { id: 'att_1', attemptNumber: 1, time: '10:00:01', status: 429, durationMs: 225, evidenceId: 'evd_101' },
      { id: 'att_2', attemptNumber: 2, time: '10:02:01', status: 429, durationMs: 211, evidenceId: 'evd_102' },
      { id: 'att_3', attemptNumber: 3, time: '10:05:01', status: 429, durationMs: 240, evidenceId: 'evd_102' },
    ],
    ruleFindings: [
      {
        ruleId: 'RULE-429-BURST',
        name: 'Repeated Rate Limit Threshold Exceeded',
        description: '3 requests rejected with HTTP 429 within 300s window.',
        matchedEvents: 3,
      },
      {
        ruleId: 'RULE-BACKOFF-INSUFFICIENT',
        name: 'Insufficient Retry Jitter',
        description: 'Retried at 120s which collided with provider quota window boundary.',
        matchedEvents: 2,
      },
    ],
    hypotheses: [
      {
        id: 'hyp_1',
        title: 'Scheduled Subscription Cron Spike',
        reasoning: 'Batch renewals at 10:00 UTC concentrated 45 outbound webhooks in 2 seconds, exceeding burst capacity.',
        confidence: 'HIGH',
        suggestedCheck: 'Inspect billing cron schedule in scheduler configuration and introduce 500ms staggered dispatch.',
        feedback: 'none',
      },
    ],
    rawPayload: {
      event_id: 'evt_stripe_inv_92',
      type: 'invoice.payment_succeeded',
      created: 1730800800,
      data: {
        object: {
          id: 'in_1298402',
          amount_paid: 4900,
          customer: 'cus_99341',
          status: 'paid',
        },
      },
    },
  },
  {
    id: 'inc_demo_schema',
    key: 'INC-1043',
    title: 'Missing required workspace_id in payload',
    integration: 'HubSpot Contact Sync',
    cls: 'SCHEMA_MISMATCH',
    events: 1,
    severity: 'MEDIUM',
    status: 'OPEN',
    seen: '09:30 AM',
    firstSeen: '05 Nov 2026, 09:30 UTC',
    known: 'Incoming webhook failed Zod validation against ContactSyncSchema.',
    suspect: 'Upstream CRM update deprecated legacy workspace format without version bump.',
    next: 'Review schema version in ingress validator and apply fallback default workspace mapping.',
    timeline: [
      {
        id: 'tl_s1',
        time: '09:30:12.000',
        title: 'Inbound payload validation failed',
        description: 'Zod parse error: missing required key `workspace_id`.',
        severity: 'danger',
        evidenceId: 'evd_s1',
      },
    ],
    evidence: [
      {
        id: 'evd_s1',
        title: 'Schema Validation Error',
        description: 'Missing required field at path /contact/workspace_id.',
        source: 'zod_validator',
        epistemic: 'OBSERVED',
        data: {
          missingField: 'contact.workspace_id',
          providedFields: ['contact.id', 'contact.email', 'contact.name'],
        },
      },
    ],
    attempts: [
      { id: 'att_s1', attemptNumber: 1, time: '09:30:12', status: 400, durationMs: 14, evidenceId: 'evd_s1' },
    ],
    ruleFindings: [
      {
        ruleId: 'RULE-ZOD-MISSING-KEY',
        name: 'Strict Schema Violation',
        description: 'Payload lacked essential partition identifier.',
        matchedEvents: 1,
      },
    ],
    hypotheses: [
      {
        id: 'hyp_2',
        title: 'CRM App v2 Webhook Payload Migration',
        reasoning: 'Provider webhook payload documentation shows workspace_id was moved under account.organization_id in v2.',
        confidence: 'HIGH',
        suggestedCheck: 'Inspect payload JSON in evidence drawer and verify contact.workspace_id vs account.org_id.',
        feedback: 'none',
      },
    ],
    rawPayload: {
      action: 'contact.updated',
      contact: { id: 104, email: 'lead@enterprise.com', name: 'Dev Lead' },
    },
  },
  {
    id: 'inc_demo_timeout',
    key: 'INC-1044',
    title: 'Upstream connection reset during TLS handshake',
    integration: 'Segment Telemetry Egress',
    cls: 'NETWORK_TIMEOUT',
    events: 2,
    severity: 'MEDIUM',
    status: 'OPEN',
    seen: '08:50 AM',
    firstSeen: '05 Nov 2026, 08:48 UTC',
    known: 'Socket timed out after 5000ms while waiting for upstream response headers.',
    suspect: 'Upstream gateway degradation or routing table flap on segment transit provider.',
    next: 'Check segment status page and verify socket timeout threshold in telemetry config.',
    timeline: [
      {
        id: 'tl_t1',
        time: '08:50:00.000',
        title: 'Socket timeout after 5000ms',
        description: 'Connection hung during TLS handshake to analytics endpoint.',
        severity: 'danger',
        evidenceId: 'evd_t1',
      },
    ],
    evidence: [
      {
        id: 'evd_t1',
        title: 'Socket Observer Timeout Log',
        description: 'ETIMEDOUT recorded after 5002ms elapsed time.',
        source: 'socket_observer',
        epistemic: 'OBSERVED',
        data: {
          code: 'ETIMEDOUT',
          timeoutMs: 5000,
          remoteAddress: '198.51.100.42:443',
        },
      },
    ],
    attempts: [
      { id: 'att_t1', attemptNumber: 1, time: '08:50:05', status: 504, durationMs: 5002, evidenceId: 'evd_t1' },
    ],
    ruleFindings: [
      {
        ruleId: 'RULE-NET-TIMEOUT',
        name: '5000ms Socket Hang Detected',
        description: 'Exceeded worker egress timeout quota.',
        matchedEvents: 2,
      },
    ],
    hypotheses: [
      {
        id: 'hyp_3',
        title: 'Upstream Ingress Gateway Outage',
        reasoning: 'TLS handshake stalled with zero packet replies from remote IP.',
        confidence: 'MEDIUM',
        suggestedCheck: 'Ping remote endpoint with net-probe or wait for segment incident resolution.',
        feedback: 'none',
      },
    ],
    rawPayload: {
      type: 'track',
      event: 'User Signed Up',
      properties: { plan: 'Enterprise' },
    },
  },
  {
    id: 'inc_demo_sig',
    key: 'INC-1045',
    title: 'Tampered webhook HMAC digest rejected',
    integration: 'Shopify Fulfillment Webhook',
    cls: 'INVALID_SIGNATURE',
    events: 1,
    severity: 'HIGH',
    status: 'OPEN',
    seen: '08:00 AM',
    firstSeen: '05 Nov 2026, 08:00 UTC',
    known: 'Calculated HMAC-SHA256 signature did not match the provided X-Shopify-Hmac-Sha256 header.',
    suspect: 'Potential payload tampering or misconfigured shared signing secret.',
    next: 'Verify shared secret in keyvault and inspect raw cryptographic digest in evidence drawer.',
    timeline: [
      {
        id: 'tl_sg1',
        time: '08:00:00.000',
        title: 'HMAC signature verification failed',
        description: 'Computed digest sha256=a1b2... does not match header sha256=c3d4...',
        severity: 'danger',
        evidenceId: 'evd_sg1',
      },
    ],
    evidence: [
      {
        id: 'evd_sg1',
        title: 'Crypto Ingress Verification Receipt',
        description: 'Mismatched digest between expected and computed signature.',
        source: 'crypto_verifier',
        epistemic: 'OBSERVED',
        data: {
          computedHash: 'sha256=a1b2c3d4...[REDACTED]',
          providedHeader: 'sha256=99887766...[REDACTED]',
        },
      },
    ],
    attempts: [
      { id: 'att_sg1', attemptNumber: 1, time: '08:00:01', status: 401, durationMs: 2, evidenceId: 'evd_sg1' },
    ],
    ruleFindings: [
      {
        ruleId: 'RULE-CRYPTO-TAMPER',
        name: 'Signature Mismatch At Ingress',
        description: 'Rejected immediately without processing request body.',
        matchedEvents: 1,
      },
    ],
    hypotheses: [
      {
        id: 'hyp_4',
        title: 'Secret Key Rotation In Progress',
        reasoning: 'Shopify dashboard rotated production webhook signing secret at 07:55 UTC.',
        confidence: 'HIGH',
        suggestedCheck: 'Update FAULTLENS_SIGNING_SECRET with new Shopify secret key.',
        feedback: 'none',
      },
    ],
    rawPayload: {
      topic: 'orders/fulfilled',
      id: 994821,
      status: 'fulfilled',
    },
  },
];

export const INITIAL_INTEGRATIONS: IntegrationItem[] = [
  {
    id: 'int_stripe',
    name: 'Stripe Billing Webhook',
    type: 'Inbound Webhook',
    status: 'DEGRADED',
    failedAttempts: 3,
    lastSeen: '11:42 AM',
  },
  {
    id: 'int_hubspot',
    name: 'HubSpot Contact Sync',
    type: 'Bi-directional Sync',
    status: 'VALIDATION_ERRORS',
    failedAttempts: 1,
    lastSeen: '09:30 AM',
  },
  {
    id: 'int_segment',
    name: 'Segment Telemetry Egress',
    type: 'Event Stream',
    status: 'DEGRADED',
    failedAttempts: 2,
    lastSeen: '08:50 AM',
  },
  {
    id: 'int_shopify',
    name: 'Shopify Fulfillment',
    type: 'Inbound Webhook',
    status: 'HEALTHY',
    failedAttempts: 0,
    lastSeen: '08:00 AM',
  },
  {
    id: 'int_slack',
    name: 'Incident Alert Dispatcher',
    type: 'Notification Hook',
    status: 'HEALTHY',
    failedAttempts: 0,
    lastSeen: 'Yesterday',
  },
];

export const PLAYGROUND_SCENARIOS: PlaygroundScenario[] = [
  {
    id: 'scen_429',
    title: 'Burst Rate Limit · Upstream 429 Retry-After',
    cls: 'RATE_LIMIT',
    description: 'Simulates 3 consecutive requests to upstream API returning 429 with Retry-After header.',
    samplePayload: {
      event_id: 'scen_evt_429',
      type: 'payment.charge',
      customer_id: 'cus_sim_429',
      amount: 1500,
    },
  },
  {
    id: 'scen_schema',
    title: 'Schema Drift · Missing Required Field',
    cls: 'SCHEMA_MISMATCH',
    description: 'Delivers a webhook missing the mandatory `workspace_id` key, triggering schema validation rules.',
    samplePayload: {
      event_id: 'scen_evt_schema',
      type: 'user.created',
      user: { id: 'usr_812', email: 'alice@domain.com' },
    },
  },
  {
    id: 'scen_timeout',
    title: 'Socket Timeout · 5000ms Hanging TCP',
    cls: 'NETWORK_TIMEOUT',
    description: 'Simulates a connection socket hang exceeding worker timeout, triggering ETIMEDOUT classification.',
    samplePayload: {
      event_id: 'scen_evt_timeout',
      type: 'export.generate',
      format: 'csv',
    },
  },
  {
    id: 'scen_sig',
    title: 'Invalid Signature · Forged Webhook',
    cls: 'INVALID_SIGNATURE',
    description: 'Injects a webhook with a tampered cryptographic digest to test tamper-evident rejection.',
    samplePayload: {
      event_id: 'scen_evt_forged',
      type: 'account.compromise',
      forged: true,
    },
  },
  {
    id: 'scen_503',
    title: 'HTTP 503 · Upstream Service Unavailable',
    cls: 'HTTP_5XX',
    description: 'External API gateway returns 503 with maintenance window payload.',
    samplePayload: {
      event_id: 'scen_evt_503',
      type: 'sync.nightly',
    },
  },
  {
    id: 'scen_dup',
    title: 'Duplicate Delivery · Idempotency Conflict',
    cls: 'DUPLICATE_DELIVERY',
    description: 'Delivers the exact same event ID twice within 5 seconds to test deduplication idempotency.',
    samplePayload: {
      event_id: 'scen_evt_dup_99',
      type: 'order.placed',
      order_id: 'ord_duplicate_1',
    },
  },
];

export interface HealthStatus {
  connected: boolean;
  latencyMs: number | null;
  mode: 'live' | 'offline';
  apiUrl: string;
}

export class ApiStore {
  private incidents: Incident[];
  private integrations: IntegrationItem[];
  private isLiveConnected = false;
  private lastLatencyMs: number | null = null;

  private adminToken = 'local-dev-admin-token';
  private baseUrl = '';

  constructor() {
    const cached = localStorage.getItem('fl_incidents');
    let parsed: Incident[] | null = null;
    try {
      parsed = cached ? JSON.parse(cached) : null;
    } catch {
      parsed = null;
    }
    // Discard static mock fixtures (inc_demo_*) in favor of real live backend data
    const isMock = Array.isArray(parsed) && parsed.some((p: any) => typeof p.id === 'string' && p.id.startsWith('inc_demo_'));
    this.incidents = parsed && !isMock && parsed.length > 0 ? parsed : INITIAL_INCIDENTS;
    this.integrations = INITIAL_INTEGRATIONS;

    // In browser/Vite dev, requests to /v1 are proxied to localhost:3000
    this.baseUrl = window.location.origin;
  }

  getIsLiveConnected(): boolean {
    return this.isLiveConnected;
  }

  getLastLatencyMs(): number | null {
    return this.lastLatencyMs;
  }

  async checkHealth(): Promise<HealthStatus> {
    const startTime = Date.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2000);

      const res = await fetch(`${this.baseUrl}/v1/incidents`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.adminToken}`,
        },
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.ok) {
        this.isLiveConnected = true;
        this.lastLatencyMs = Date.now() - startTime;
        return {
          connected: true,
          latencyMs: this.lastLatencyMs,
          mode: 'live',
          apiUrl: this.baseUrl,
        };
      }
    } catch {
      // Server offline or proxy unreachable
    }

    this.isLiveConnected = false;
    this.lastLatencyMs = null;
    return {
      connected: false,
      latencyMs: null,
      mode: 'offline',
      apiUrl: this.baseUrl,
    };
  }

  async fetchIncidents(failureClass?: string): Promise<Incident[]> {
    try {
      const url = new URL(`${this.baseUrl}/v1/incidents`);
      if (failureClass) {
        url.searchParams.set('failureClass', failureClass);
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);

      const res = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${this.adminToken}`,
        },
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.ok) {
        const body = (await res.json()) as { kind: string; items: BackendIncidentSummary[] };
        if (body.kind === 'ok' && Array.isArray(body.items)) {
          this.isLiveConnected = true;

          // Merge live summaries with existing loaded details without clobbering AI/detail state
          const liveIncidents: Incident[] = body.items.map((summary) => {
            const existing = this.incidents.find((i) => i.id === summary.id);
            const liveSummary = toFrontendIncidentSummary(summary);
            if (
              existing &&
              (existing.timeline.length > 0 ||
                (existing.agentRuns?.length ?? 0) > 0 ||
                existing.aiSummary !== null)
            ) {
              return {
                ...liveSummary,
                aiSummary: existing.aiSummary ?? null,
                agentRuns: existing.agentRuns ?? [],
                toolCalls: existing.toolCalls ?? [],
                timeline: existing.timeline,
                evidence: existing.evidence,
                attempts: existing.attempts,
                ruleFindings: existing.ruleFindings,
                hypotheses: existing.hypotheses,
                rawPayload: existing.rawPayload,
              };
            }
            return liveSummary;
          });

          // Sort by latest activity (last seen) first
          liveIncidents.sort((a, b) => (b.lastSeenTimestamp ?? 0) - (a.lastSeenTimestamp ?? 0));

          this.incidents = liveIncidents;
          this.save();
          return [...this.incidents];
        }
      }
    } catch {
      this.isLiveConnected = false;
    }

    // Offline fallback: return current cached incidents
    return [...this.incidents];
  }

  async fetchIncidentDetail(incidentId: string): Promise<Incident> {
    const existing = this.incidents.find((i) => i.id === incidentId);

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3500);

      const res = await fetch(`${this.baseUrl}/v1/incidents/${incidentId}/export`, {
        headers: {
          Authorization: `Bearer ${this.adminToken}`,
        },
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.ok) {
        const body = (await res.json()) as BackendExportIncidentResult;
        if (body.kind === 'ok') {
          this.isLiveConnected = true;
          const fullDetail = toFrontendIncidentDetail(body);

          const idx = this.incidents.findIndex((i) => i.id === incidentId);
          if (idx !== -1) {
            this.incidents[idx] = fullDetail;
          } else {
            this.incidents.unshift(fullDetail);
          }
          this.save();
          return fullDetail;
        }
      }
    } catch {
      this.isLiveConnected = false;
    }

    return existing || this.incidents[0];
  }

  async updateIncidentStatus(id: string, status: Incident['status']): Promise<Incident | undefined> {
    const incident = this.incidents.find((i) => i.id === id);
    if (incident) {
      incident.status = status;
      this.save();
    }

    // Asynchronously sync with backend if online
    try {
      await fetch(`${this.baseUrl}/v1/incidents/${id}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.adminToken}`,
        },
        body: JSON.stringify({ status }),
      });
    } catch {
      // Ignored for offline tolerance
    }

    return incident;
  }

  async updateHypothesisFeedback(
    incidentId: string,
    hypothesisId: string,
    feedback: 'helpful' | 'false_positive' | 'unverified'
  ): Promise<void> {
    const incident = this.incidents.find((i) => i.id === incidentId);
    const targetHyp = incident?.hypotheses.find((h) => h.id === hypothesisId);
    if (targetHyp) {
      targetHyp.feedback = feedback;
      this.save();
    }

    // Attempt backend sync only for persisted hypotheses
    if (!targetHyp?.isPersisted) {
      return;
    }

    try {
      const rating =
        feedback === 'helpful'
          ? 'USEFUL'
          : feedback === 'false_positive'
          ? 'INCORRECT'
          : 'UNVERIFIED';
      await fetch(`${this.baseUrl}/v1/hypotheses/${hypothesisId}/feedback`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.adminToken}`,
        },
        body: JSON.stringify({ rating }),
      });
    } catch {
      // Offline fallback
    }
  }

  async triggerInvestigation(incidentId: string): Promise<{
    outcome: 'queued' | 'already-running' | 'ai-disabled' | 'missing' | 'queue-unavailable' | 'offline';
    runId?: string;
  }> {
    try {
      const res = await fetch(`${this.baseUrl}/v1/incidents/${incidentId}/investigate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.adminToken}`,
        },
        body: JSON.stringify({ reason: 'manual_workbench_trigger' }),
      });
      const body = (await res.json()) as { outcome?: string; runId?: string };
      if (
        body.outcome === 'queued' ||
        body.outcome === 'already-running' ||
        body.outcome === 'ai-disabled' ||
        body.outcome === 'missing' ||
        body.outcome === 'queue-unavailable'
      ) {
        return { outcome: body.outcome, runId: body.runId };
      }
      return { outcome: 'offline' };
    } catch {
      return { outcome: 'offline' };
    }
  }

  async fetchAgentSettings(): Promise<AgentSettingsSummary | null> {
    try {
      const res = await fetch(`${this.baseUrl}/v1/settings/agent`, {
        headers: {
          Authorization: `Bearer ${this.adminToken}`,
        },
      });
      if (!res.ok) return null;
      const body = (await res.json()) as AgentSettingsSummary & { kind?: string };
      if (body.kind !== 'ok') return null;
      return {
        enabled: body.enabled,
        autoInvestigate: body.autoInvestigate,
        provider: body.provider,
        model: body.model,
        baseUrlConfigured: body.baseUrlConfigured,
        budgets: body.budgets,
      };
    } catch {
      return null;
    }
  }

  async runScenario(scenario: PlaygroundScenario): Promise<Incident> {
    // If live, dispatch real synthetic delivery to /v1/ingest
    if (this.isLiveConnected) {
      try {
        const ingestKey = 'flk_seed_billing_local_ingest_key_00000001';
        const res = await fetch(`${this.baseUrl}/v1/ingest`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${ingestKey}`,
            'x-faultlens-signature': `sim_sig_${Date.now()}`,
          },
          body: JSON.stringify(scenario.samplePayload),
        });

        if (res.ok) {
          // Re-fetch live incidents to reflect the newly classified item
          await new Promise((r) => setTimeout(r, 800));
          await this.fetchIncidents();
          return this.incidents[0];
        }
      } catch {
        // Fall back to client simulation
      }
    }

    // Local simulation fallback
    const newId = `inc_sim_${Date.now()}`;
    const keyNum = 1050 + this.incidents.length;
    const newIncident: Incident = {
      id: newId,
      key: `INC-${keyNum}`,
      title: `Simulated: ${scenario.title}`,
      integration: 'Flight Simulator Lab',
      cls: scenario.cls,
      events: 3,
      severity: scenario.cls === 'INVALID_SIGNATURE' || scenario.cls === 'SCHEMA_MISMATCH' ? 'HIGH' : 'MEDIUM',
      status: 'OPEN',
      seen: 'Just now',
      firstSeen: new Date().toLocaleTimeString(),
      known: `Telemetry captured simulated failure signature for ${scenario.cls}.`,
      suspect: `Simulated test scenario executed from FaultLens Playground.`,
      next: `Inspect flight timeline, attempts, and classified rule receipt.`,
      timeline: [
        {
          id: `tl_${Date.now()}_1`,
          time: new Date().toLocaleTimeString(),
          title: `Simulator injected test event`,
          description: `Dispatched test payload with classification ${scenario.cls}.`,
          severity: 'normal',
          evidenceId: `evd_${newId}_1`,
        },
        {
          id: `tl_${Date.now()}_2`,
          time: new Date().toLocaleTimeString(),
          title: `Failure signature observed`,
          description: `Ingestion verified failure response corresponding to ${scenario.title}.`,
          severity: 'danger',
          evidenceId: `evd_${newId}_2`,
        },
      ],
      evidence: [
        {
          id: `evd_${newId}_1`,
          title: 'Simulator Egress Receipt',
          description: 'Synthetic delivery injected via FaultLens Playground.',
          source: 'flight_simulator',
          epistemic: 'OBSERVED',
          data: scenario.samplePayload,
        },
        {
          id: `evd_${newId}_2`,
          title: 'Rule Match Receipt',
          description: `Triggered deterministic classifier for ${scenario.cls}.`,
          source: 'rules_engine',
          epistemic: 'RULE',
          data: {
            scenarioId: scenario.id,
            matchedClass: scenario.cls,
            timestamp: new Date().toISOString(),
          },
        },
      ],
      attempts: [
        {
          id: `att_${newId}_1`,
          attemptNumber: 1,
          time: new Date().toLocaleTimeString(),
          status: scenario.cls === 'RATE_LIMIT' ? 429 : scenario.cls === 'INVALID_SIGNATURE' ? 401 : 500,
          durationMs: 145,
          evidenceId: `evd_${newId}_2`,
        },
      ],
      ruleFindings: [
        {
          ruleId: `RULE-${scenario.cls}`,
          name: `Simulated ${scenario.cls} Signature`,
          description: scenario.description,
          matchedEvents: 1,
        },
      ],
      hypotheses: [
        {
          id: `hyp_${newId}`,
          title: `Automated Pipeline Classification`,
          reasoning: `Rule classifier matched 100% of telemetry criteria for ${scenario.cls}.`,
          confidence: 'HIGH',
          suggestedCheck: 'Review evidence drawer and confirm resolution path.',
          feedback: 'none',
        },
      ],
      rawPayload: scenario.samplePayload,
    };

    this.incidents.unshift(newIncident);
    this.save();
    return newIncident;
  }

  getIncidents(): Incident[] {
    return [...this.incidents];
  }

  getIncidentById(id: string): Incident | undefined {
    return this.incidents.find((i) => i.id === id);
  }

  getIntegrations(): IntegrationItem[] {
    if (this.incidents.length === 0) {
      return [...this.integrations];
    }

    const groups = new Map<string, Incident[]>();
    for (const inc of this.incidents) {
      const channel = inc.integration || 'Default Webhook';
      const grp = groups.get(channel) ?? [];
      grp.push(inc);
      groups.set(channel, grp);
    }

    return Array.from(groups.entries()).map(([channel, incs], idx) => {
      const totalEvents = incs.reduce((sum, i) => sum + (i.events || 1), 0);
      const openCount = incs.filter((i) => i.status === 'OPEN' || i.status === 'INVESTIGATING').length;
      const status: IntegrationItem['status'] =
        openCount > 2 ? 'CRITICAL' : openCount > 0 ? 'DEGRADED' : 'HEALTHY';
      return {
        id: `int_live_${idx}_${channel.toLowerCase().replace(/\W+/g, '_')}`,
        name: channel,
        type: 'Live Ingress Channel',
        status,
        failedAttempts: totalEvents,
        lastSeen: incs[0]?.seen ?? 'Just now',
      };
    });
  }

  resetFixtures(): void {
    localStorage.removeItem('fl_incidents');
    this.incidents = INITIAL_INCIDENTS;
  }

  private save(): void {
    try {
      localStorage.setItem('fl_incidents', JSON.stringify(this.incidents));
    } catch {
      // Storage full or unavailable
    }
  }
}

export const apiStore = new ApiStore();
