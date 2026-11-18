import { HYPOTHESIS_FEEDBACK_RATINGS, type HypothesisFeedbackRating } from "#domain";
import {
  askIncidentFollowUp,
  getAgentSettings,
  getEvaluationsSummary,
  listIncidentInvestigations,
  listIncidentQuestions,
  rateHypothesis,
  triggerInvestigation,
} from "../../investigations/investigate.ts";
import {
  firstHeader,
  headerPairs,
  invalidRequest,
  readCapped,
  readCommand,
  requiredParam,
  unauthorized,
  type AdminSession,
  type ApiContext,
  type Parsed,
} from "../request.ts";
import {
  AGENT_SETTINGS_STATUS,
  ASK_QUESTION_STATUS,
  EVALUATIONS_SUMMARY_STATUS,
  JSON_BODY_LIMIT,
  LIST_INVESTIGATIONS_STATUS,
  LIST_QUESTIONS_STATUS,
  RATE_HYPOTHESIS_STATUS,
  TRIGGER_INVESTIGATION_STATUS,
} from "../routes.ts";

export async function handleTriggerInvestigation(
  c: ApiContext,
  session: AdminSession,
): Promise<Response> {
  const reasonResult = await parseOptionalReason(c);
  if (!reasonResult.ok) return reasonResult.response;

  const result = await triggerInvestigation({
    workspaceId: session.workspaceId,
    incidentId: requiredParam(c.req.param(), "incidentId"),
    actor: session.actor,
    reason: reasonResult.reason,
  });

  return c.json(result, TRIGGER_INVESTIGATION_STATUS[result.outcome]);
}

export async function handleListIncidentInvestigations(
  c: ApiContext,
  session: AdminSession,
): Promise<Response> {
  const result = await listIncidentInvestigations({
    adminToken: session.token,
    workspaceId: session.workspaceId,
    incidentId: requiredParam(c.req.param(), "incidentId"),
  });
  if (result.kind === "unauthorized") {
    return unauthorized(c, LIST_INVESTIGATIONS_STATUS.unauthorized);
  }
  return c.json(result, LIST_INVESTIGATIONS_STATUS[result.kind]);
}

export async function handleRateHypothesis(
  c: ApiContext,
  session: AdminSession,
): Promise<Response> {
  const body = await readCommand(c, headerPairs(c));
  if (!body.ok) return body.response;

  const parsed = parseRateHypothesisBody(body.value);
  if (!parsed.ok) return invalidRequest(c, parsed.field);

  const result = await rateHypothesis({
    workspaceId: session.workspaceId,
    hypothesisId: requiredParam(c.req.param(), "hypothesisId"),
    actor: session.actor,
    rating: parsed.value,
  });

  return c.json(result, RATE_HYPOTHESIS_STATUS[result.outcome]);
}

export async function handleGetAgentSettings(
  c: ApiContext,
  session: AdminSession,
): Promise<Response> {
  const result = await getAgentSettings({
    adminToken: session.token,
    workspaceId: session.workspaceId,
  });
  if (result.kind === "unauthorized") {
    return unauthorized(c, AGENT_SETTINGS_STATUS.unauthorized);
  }
  return c.json(result, AGENT_SETTINGS_STATUS[result.kind]);
}

export async function handleAskIncidentQuestion(
  c: ApiContext,
  session: AdminSession,
): Promise<Response> {
  const body = await readCommand(c, headerPairs(c));
  if (!body.ok) return body.response;

  const parsed = parseQuestionBody(body.value);
  if (!parsed.ok) return invalidRequest(c, parsed.field);

  const result = await askIncidentFollowUp({
    workspaceId: session.workspaceId,
    incidentId: requiredParam(c.req.param(), "incidentId"),
    actor: session.actor,
    question: parsed.value,
  });
  return c.json(result, ASK_QUESTION_STATUS[result.outcome]);
}

export async function handleListIncidentQuestions(
  c: ApiContext,
  session: AdminSession,
): Promise<Response> {
  const result = await listIncidentQuestions({
    adminToken: session.token,
    workspaceId: session.workspaceId,
    incidentId: requiredParam(c.req.param(), "incidentId"),
  });
  if (result.kind === "unauthorized") {
    return unauthorized(c, LIST_QUESTIONS_STATUS.unauthorized);
  }
  return c.json(result, LIST_QUESTIONS_STATUS[result.kind]);
}

export async function handleGetEvaluationsSummary(
  c: ApiContext,
  session: AdminSession,
): Promise<Response> {
  const result = await getEvaluationsSummary({
    adminToken: session.token,
    workspaceId: session.workspaceId,
  });
  if (result.kind === "unauthorized") {
    return unauthorized(c, EVALUATIONS_SUMMARY_STATUS.unauthorized);
  }
  return c.json(result, EVALUATIONS_SUMMARY_STATUS[result.kind]);
}

function parseQuestionBody(body: Record<string, unknown>): Parsed<string> {
  for (const key of Object.keys(body)) {
    if (key !== "question") return { ok: false, field: key };
  }
  const raw = body["question"];
  if (!Object.hasOwn(body, "question") || typeof raw !== "string" || raw.trim().length === 0) {
    return { ok: false, field: "question" };
  }
  return { ok: true, value: raw.trim().slice(0, 1000) };
}

async function parseOptionalReason(
  c: ApiContext,
): Promise<{ ok: true; reason?: string } | { ok: false; response: Response }> {
  const pairs = headerPairs(c);
  const contentLength = firstHeader(pairs, "content-length");
  const contentType = firstHeader(pairs, "content-type");
  if ((contentLength === undefined || contentLength === "0") && contentType === undefined) {
    return { ok: true, reason: undefined };
  }
  if (!contentType?.toLowerCase().includes("application/json")) {
    const bytes = await readCapped(c.req.raw, JSON_BODY_LIMIT + 1);
    if (bytes.length === 0) return { ok: true, reason: undefined };
    return { ok: false, response: c.json({ error: "unsupported_media_type" }, 415) };
  }
  const body = await readCommand(c, pairs);
  if (!body.ok) return body;
  for (const key of Object.keys(body.value)) {
    if (key !== "reason") {
      return { ok: false, response: invalidRequest(c, key) };
    }
  }
  const rawReason = body.value["reason"];
  if (rawReason !== undefined && typeof rawReason !== "string") {
    return { ok: false, response: invalidRequest(c, "reason") };
  }
  return { ok: true, reason: rawReason };
}

function parseRateHypothesisBody(
  body: Record<string, unknown>,
): Parsed<HypothesisFeedbackRating> {
  for (const key of Object.keys(body)) {
    if (key !== "rating") return { ok: false, field: key };
  }
  const raw = body["rating"];
  if (!Object.hasOwn(body, "rating") || typeof raw !== "string") {
    return { ok: false, field: "rating" };
  }
  const rating = HYPOTHESIS_FEEDBACK_RATINGS.find((item) => item === raw);
  if (rating === undefined) return { ok: false, field: "rating" };
  return { ok: true, value: rating };
}
