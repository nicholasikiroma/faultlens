import { FEEDBACK_RATINGS, type FeedbackRating } from "#domain";
import { listFindingFeedback, rateFinding } from "../../feedback/feedback.ts";
import {
  headerPairs,
  invalidRequest,
  readCommand,
  requiredParam,
  unauthorized,
  type AdminSession,
  type ApiContext,
  type Parsed,
} from "../request.ts";
import { LIST_FEEDBACK_STATUS, RATE_FINDING_STATUS } from "../routes.ts";

export async function handleRateFinding(c: ApiContext, session: AdminSession): Promise<Response> {
  const body = await readCommand(c, headerPairs(c));
  if (!body.ok) return body.response;
  const parsed = parseRatingBody(body.value);
  if (!parsed.ok) return invalidRequest(c, parsed.field);
  const result = await rateFinding({
    workspaceId: session.workspaceId,
    findingId: requiredParam(c.req.param(), "findingId"),
    actor: session.actor,
    rating: parsed.value.rating,
    note: parsed.value.note,
  });
  return c.json(result, RATE_FINDING_STATUS[result.outcome]);
}

export async function handleListFindingFeedback(
  c: ApiContext,
  session: AdminSession,
): Promise<Response> {
  const result = await listFindingFeedback({
    adminToken: session.token,
    workspaceId: session.workspaceId,
    findingId: requiredParam(c.req.param(), "findingId"),
  });
  if (result.kind === "unauthorized") return unauthorized(c, LIST_FEEDBACK_STATUS.unauthorized);
  return c.json(result, LIST_FEEDBACK_STATUS[result.kind]);
}

function parseRatingBody(
  body: Record<string, unknown>,
): Parsed<{ rating: FeedbackRating; note: string | null }> {
  for (const key of Object.keys(body)) {
    if (key !== "rating" && key !== "note") return { ok: false, field: key };
  }
  const raw = body["rating"];
  if (!Object.hasOwn(body, "rating") || typeof raw !== "string") {
    return { ok: false, field: "rating" };
  }
  const rating = FEEDBACK_RATINGS.find((item) => item === raw);
  if (rating === undefined) return { ok: false, field: "rating" };
  let note: string | null = null;
  if (Object.hasOwn(body, "note")) {
    const rawNote = body["note"];
    if (rawNote !== null && typeof rawNote !== "string") return { ok: false, field: "note" };
    note = rawNote;
  }
  return { ok: true, value: { rating, note } };
}
