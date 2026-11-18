import type { ListAuditEventsResult } from "../audit/audit.ts";
import type {
  ListFindingFeedbackResult,
  RateFindingResult,
} from "../feedback/feedback.ts";
import type { TransitionIncidentResult } from "../incidents/lifecycle.ts";
import type { EpisodeIngestResult } from "../ingest/episode-ingest.ts";
import type { IngestResult } from "../ingest/ingest.ts";
import type {
  AgentSettingsResult,
  AskIncidentFollowUpResult,
  EvaluationsSummaryResult,
  ListIncidentQuestionsResult,
  ListInvestigationsResult,
  RateHypothesisResult,
  TriggerInvestigationResult,
} from "../investigations/investigate.ts";
import type { ListAttemptsResult, ListEventsResult } from "../read/events.ts";
import type { ExportIncidentResult } from "../read/export.ts";
import type { ListIncidentsResult } from "../read/incidents.ts";

export type HttpMethod = "GET" | "POST" | "PUT";

export type Access =
  | { readonly kind: "admin" }
  | {
      readonly kind: "ingest";
      readonly credential: "bearer";
      readonly traffic: "real";
    }
  | {
      readonly kind: "ingest";
      readonly credential: "path";
      readonly traffic: "simulated";
    };

export interface HttpRoute {
  readonly id: string;
  readonly method: HttpMethod;
  readonly path: string;
  readonly access: Access;
}

export const JSON_BODY_LIMIT = 16 * 1024;
export const MAX_EVENT_PAGE_SIZE = 100;

export const ADMIN_QUERY_KEYS = {
  listEvents: [
    "cursor",
    "limit",
    "integrationId",
    "from",
    "to",
    "externalEventId",
    "status",
    "errorClass",
    "failureClass",
    "traceId",
  ],
  listAttempts: [],
  listIncidents: ["failureClass"],
  exportIncident: [],
  transitionIncident: [],
  rateFinding: [],
  listFindingFeedback: [],
  listAuditEvents: ["objectType", "objectId"],
  triggerInvestigation: [],
  listIncidentInvestigations: [],
  rateHypothesis: [],
  getAgentSettings: [],
  askIncidentQuestion: [],
  listIncidentQuestions: [],
  getEvaluationsSummary: [],
} as const;

export const ROUTES = [
  {
    id: "ingest",
    method: "POST",
    path: "/v1/ingest",
    access: { kind: "ingest", credential: "bearer", traffic: "real" },
  },
  {
    id: "ingestEpisode",
    method: "POST",
    path: "/v1/ingest/episodes",
    access: { kind: "ingest", credential: "bearer", traffic: "real" },
  },
  {
    id: "simulateWebhook",
    method: "POST",
    path: "/hooks/:token",
    access: { kind: "ingest", credential: "path", traffic: "simulated" },
  },
  {
    id: "listEvents",
    method: "GET",
    path: "/v1/events",
    access: { kind: "admin" },
  },
  {
    id: "listAttempts",
    method: "GET",
    path: "/v1/events/:eventId/attempts",
    access: { kind: "admin" },
  },
  {
    id: "listIncidents",
    method: "GET",
    path: "/v1/incidents",
    access: { kind: "admin" },
  },
  {
    id: "exportIncident",
    method: "GET",
    path: "/v1/incidents/:incidentId/export",
    access: { kind: "admin" },
  },
  {
    id: "transitionIncident",
    method: "PUT",
    path: "/v1/incidents/:incidentId/status",
    access: { kind: "admin" },
  },
  {
    id: "rateFinding",
    method: "PUT",
    path: "/v1/findings/:findingId/feedback",
    access: { kind: "admin" },
  },
  {
    id: "listFindingFeedback",
    method: "GET",
    path: "/v1/findings/:findingId/feedback",
    access: { kind: "admin" },
  },
  {
    id: "listAuditEvents",
    method: "GET",
    path: "/v1/audit-events",
    access: { kind: "admin" },
  },
  {
    id: "triggerInvestigation",
    method: "POST",
    path: "/v1/incidents/:incidentId/investigate",
    access: { kind: "admin" },
  },
  {
    id: "listIncidentInvestigations",
    method: "GET",
    path: "/v1/incidents/:incidentId/investigations",
    access: { kind: "admin" },
  },
  {
    id: "rateHypothesis",
    method: "PUT",
    path: "/v1/hypotheses/:hypothesisId/feedback",
    access: { kind: "admin" },
  },
  {
    id: "getAgentSettings",
    method: "GET",
    path: "/v1/settings/agent",
    access: { kind: "admin" },
  },
  {
    id: "askIncidentQuestion",
    method: "POST",
    path: "/v1/incidents/:incidentId/ask",
    access: { kind: "admin" },
  },
  {
    id: "listIncidentQuestions",
    method: "GET",
    path: "/v1/incidents/:incidentId/questions",
    access: { kind: "admin" },
  },
  {
    id: "getEvaluationsSummary",
    method: "GET",
    path: "/v1/evaluations/summary",
    access: { kind: "admin" },
  },
] as const satisfies readonly HttpRoute[];

export const HTTP_ROUTES = ROUTES;

export type Route = (typeof ROUTES)[number];
export type RouteId = Route["id"];
export type AdminRouteId = Extract<Route, { access: { kind: "admin" } }>["id"];

true satisfies Exclude<
  AdminRouteId,
  keyof typeof ADMIN_QUERY_KEYS
> extends never
  ? true
  : never;
true satisfies Exclude<
  keyof typeof ADMIN_QUERY_KEYS,
  AdminRouteId
> extends never
  ? true
  : never;

export const INGEST_STATUS = {
  stored: 200,
  duplicate: 200,
  conflict: 409,
  rejected: 401,
  "schema-error": 400,
  oversized: 413,
  "unknown-token": 401,
} as const satisfies Record<IngestResult["outcome"], number>;

export const EPISODE_INGEST_STATUS = {
  stored: 200,
  duplicate: 200,
  conflict: 409,
  "schema-error": 400,
  oversized: 413,
  "unknown-token": 401,
} as const satisfies Record<EpisodeIngestResult["outcome"], number>;

export const LIST_EVENTS_STATUS = {
  unauthorized: 401,
  ok: 200,
} as const satisfies Record<ListEventsResult["kind"], number>;

export const LIST_ATTEMPTS_STATUS = {
  unauthorized: 401,
  ok: 200,
} as const satisfies Record<ListAttemptsResult["kind"], number>;

export const LIST_INCIDENTS_STATUS = {
  unauthorized: 401,
  ok: 200,
} as const satisfies Record<ListIncidentsResult["kind"], number>;

export const EXPORT_INCIDENT_STATUS = {
  unauthorized: 401,
  missing: 404,
  ok: 200,
} as const satisfies Record<ExportIncidentResult["kind"], number>;

export const TRANSITION_STATUS = {
  transitioned: 200,
  unchanged: 200,
  illegal: 409,
  missing: 404,
} as const satisfies Record<TransitionIncidentResult["outcome"], number>;

export const RATE_FINDING_STATUS = {
  rated: 201,
  replaced: 200,
  missing: 404,
} as const satisfies Record<RateFindingResult["outcome"], number>;

export const LIST_FEEDBACK_STATUS = {
  unauthorized: 401,
  ok: 200,
} as const satisfies Record<ListFindingFeedbackResult["kind"], number>;

export const LIST_AUDIT_STATUS = {
  unauthorized: 401,
  ok: 200,
} as const satisfies Record<ListAuditEventsResult["kind"], number>;

export const TRIGGER_INVESTIGATION_STATUS = {
  queued: 202,
  "already-running": 409,
  missing: 404,
  "ai-disabled": 503,
  "queue-unavailable": 503,
} as const satisfies Record<TriggerInvestigationResult["outcome"], number>;

export const LIST_INVESTIGATIONS_STATUS = {
  unauthorized: 401,
  missing: 404,
  ok: 200,
} as const satisfies Record<ListInvestigationsResult["kind"], number>;

export const RATE_HYPOTHESIS_STATUS = {
  rated: 200,
  unchanged: 200,
  missing: 404,
} as const satisfies Record<RateHypothesisResult["outcome"], number>;

export const AGENT_SETTINGS_STATUS = {
  unauthorized: 401,
  ok: 200,
} as const satisfies Record<AgentSettingsResult["kind"], number>;

export const ASK_QUESTION_STATUS = {
  answered: 200,
  missing: 404,
  "ai-disabled": 503,
  "provider-error": 502,
} as const satisfies Record<AskIncidentFollowUpResult["outcome"], number>;

export const LIST_QUESTIONS_STATUS = {
  unauthorized: 401,
  missing: 404,
  ok: 200,
} as const satisfies Record<ListIncidentQuestionsResult["kind"], number>;

export const EVALUATIONS_SUMMARY_STATUS = {
  unauthorized: 401,
  ok: 200,
} as const satisfies Record<EvaluationsSummaryResult["kind"], number>;

export const UNAUTHORIZED_BODY = {
  kind: "unauthorized",
  error: "unauthorized",
} as const;
