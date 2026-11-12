import type { Incident, IntegrationItem, PlaygroundScenario } from '../types';

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
        reasoning: 'Batch renewals at 10:00 UTC concentrated 45 outbound webhooks in 2 seconds, exceeding Stripe burst capacity.',
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
          currency: 'usd',
          customer: 'cus_masked_77a',
          subscription: 'sub_masked_99b',
          api_key: '[REDACTED]',
        },
      },
    },
  },
  {
    id: 'inc_demo_schema',
    key: 'INC-1041',
    title: 'Required field missing in webhook payload',
    integration: 'Demo CRM Sync',
    cls: 'SCHEMA_MISMATCH',
    events: 19,
    severity: 'HIGH',
    status: 'OPEN',
    seen: '10:18 AM',
    firstSeen: '05 Nov 2026, 09:30 UTC',
    known: 'Inbound payload lacks required schema field `contact.workspace_id`.',
    suspect: 'CRM provider deployed v2 webhook format without backwards compatibility.',
    next: 'Check CRM webhook version settings and update inbound parser schema.',
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
        ruleId: 'RULE-SCHEMA-DRIFT',
        name: 'Zod Parse Failure',
        description: 'Payload failed strict schema validation against v1 schema.',
        matchedEvents: 19,
      },
    ],
    hypotheses: [
      {
        id: 'hyp_s1',
        title: 'Provider API Migration Drift',
        reasoning: 'The provider has migrated workspace identifiers to account_id in recent webhook releases.',
        confidence: 'HIGH',
        suggestedCheck: 'Allow alias `contact.account_id ?? contact.workspace_id` in ingestion adapter.',
        feedback: 'none',
      },
    ],
    rawPayload: {
      event_id: 'evt_crm_sync_04',
      type: 'contact.updated',
      contact: {
        id: 'cnt_882',
        email: 'lead@enterprise.com',
        auth_token: '[REDACTED]',
      },
    },
  },
  {
    id: 'inc_demo_timeout',
    key: 'INC-1040',
    title: 'Worker timed out during processing',
    integration: 'Demo Queue Processor',
    cls: 'NETWORK_TIMEOUT',
    events: 11,
    severity: 'MEDIUM',
    status: 'INVESTIGATING',
    seen: '09:36 AM',
    firstSeen: '05 Nov 2026, 08:50 UTC',
    known: 'Downstream HTTP connection exceeded 5000ms socket timeout.',
    suspect: 'Downstream warehouse reporting endpoint degraded.',
    next: 'Check warehouse queue status and verify connection pooling limits.',
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
        name: 'Socket Inactivity Timeout',
        description: 'Connection timed out prior to HTTP response headers.',
        matchedEvents: 11,
      },
    ],
    hypotheses: [
      {
        id: 'hyp_t1',
        title: 'Downstream Ingress Congestion',
        reasoning: 'Analytics service gateway latency increased 400% during morning ingest cycle.',
        confidence: 'MEDIUM',
        suggestedCheck: 'Increase worker socket timeout from 5s to 15s with exponential retry.',
        feedback: 'none',
      },
    ],
    rawPayload: {
      event_id: 'evt_queue_task_90',
      type: 'warehouse.sync',
      attempt: 1,
    },
  },
  {
    id: 'inc_demo_sig',
    key: 'INC-1039',
    title: 'Webhook signature verification failed',
    integration: 'Demo Billing Webhook',
    cls: 'INVALID_SIGNATURE',
    events: 5,
    severity: 'HIGH',
    status: 'OPEN',
    seen: '08:04 AM',
    firstSeen: '05 Nov 2026, 08:00 UTC',
    known: 'Inbound signature header does not match computed HMAC-SHA256 digest.',
    suspect: 'Inbound secret was rotated in billing dashboard without updating WireSleuth environment config.',
    next: 'Verify current webhook signing secret in provider settings.',
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
        ruleId: 'RULE-SIGNATURE-MISMATCH',
        name: 'Tamper / Secret Desync',
        description: 'Inbound request failed cryptographic signature check.',
        matchedEvents: 5,
      },
    ],
    hypotheses: [
      {
        id: 'hyp_sg1',
        title: 'Secret Rotation Inconsistency',
        reasoning: 'Provider webhook endpoint was edited in Stripe dashboard 2 hours prior.',
        confidence: 'HIGH',
        suggestedCheck: 'Update `WEBHOOK_SIGNING_SECRET` environment variable.',
        feedback: 'none',
      },
    ],
    rawPayload: {
      event_id: 'evt_stripe_unverified',
      type: 'charge.failed',
      raw_signature: '[REDACTED]',
    },
  },
];

export const INITIAL_INTEGRATIONS: IntegrationItem[] = [
  {
    id: 'int_billing',
    name: 'Demo Billing Webhook',
    type: 'Stripe Webhook',
    status: 'DEGRADED',
    failedAttempts: 84,
    lastSeen: '11:42 AM',
  },
  {
    id: 'int_crm',
    name: 'Demo CRM Sync',
    type: 'HubSpot Webhook',
    status: 'VALIDATION_ERRORS',
    failedAttempts: 32,
    lastSeen: '10:18 AM',
  },
  {
    id: 'int_queue',
    name: 'Demo Queue Processor',
    type: 'BullMQ Async Worker',
    status: 'HEALTHY',
    failedAttempts: 12,
    lastSeen: '09:36 AM',
  },
];

export const PLAYGROUND_SCENARIOS: PlaygroundScenario[] = [
  {
    id: 'scen_429',
    title: 'HTTP 429 · Rate Limit Burst',
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

// In-memory state store with localStorage persistence
class ApiStore {
  private incidents: Incident[];
  private integrations: IntegrationItem[];

  constructor() {
    const cached = localStorage.getItem('ws_incidents');
    this.incidents = cached ? JSON.parse(cached) : INITIAL_INCIDENTS;
    this.integrations = INITIAL_INTEGRATIONS;
  }

  getIncidents(): Incident[] {
    return [...this.incidents];
  }

  getIncidentById(id: string): Incident | undefined {
    return this.incidents.find((i) => i.id === id);
  }

  getIntegrations(): IntegrationItem[] {
    return [...this.integrations];
  }

  updateIncidentStatus(id: string, status: Incident['status']): Incident | undefined {
    const incident = this.incidents.find((i) => i.id === id);
    if (incident) {
      incident.status = status;
      this.save();
    }
    return incident;
  }

  updateHypothesisFeedback(
    incidentId: string,
    hypothesisId: string,
    feedback: 'helpful' | 'false_positive'
  ): void {
    const incident = this.incidents.find((i) => i.id === incidentId);
    if (incident) {
      const hyp = incident.hypotheses.find((h) => h.id === hypothesisId);
      if (hyp) {
        hyp.feedback = feedback;
        this.save();
      }
    }
  }

  runScenario(scenario: PlaygroundScenario): Incident {
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
      suspect: `Simulated test scenario executed from WireSleuth Playground.`,
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
          description: 'Synthetic delivery injected via WireSleuth Playground.',
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

  private save() {
    try {
      localStorage.setItem('ws_incidents', JSON.stringify(this.incidents));
    } catch {
      // Storage full or unavailable
    }
  }
}

export const apiStore = new ApiStore();
