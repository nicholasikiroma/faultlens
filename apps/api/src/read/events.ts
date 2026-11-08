import { db } from "#db";
import type {
  DeliveryAttempt,
  FailureClass,
  ProcessingState,
  WebhookEvent,
} from "#domain";
import { verifyAdminToken } from "./auth.ts";

export const DEFAULT_EVENT_PAGE_SIZE = 20;

export interface EventFilters {
  integrationId?: string | null;
  from?: Date | null;
  to?: Date | null;
  externalEventId?: string | null;
  status?: ProcessingState | null;
  errorClass?: FailureClass | null;
  failureClass?: FailureClass | null;
  traceId?: string | null;
}

export interface ListEventsInput {
  adminToken: string | null | undefined;
  workspaceId: string;
  cursor?: string | null;
  limit?: number;
  filters?: EventFilters;
}

export type ListEventsResult =
  | { kind: "unauthorized" }
  | {
      kind: "ok";
      items: WebhookEvent[];
      nextCursor: string | null;
    };

export interface ListAttemptsInput {
  adminToken: string | null | undefined;
  workspaceId: string;
  eventId: string;
}

export type ListAttemptsResult =
  | { kind: "unauthorized" }
  | {
      kind: "ok";
      items: DeliveryAttempt[];
    };

export async function listEvents(
  input: ListEventsInput,
): Promise<ListEventsResult> {
  if (
    !verifyAdminToken(input.adminToken) ||
    input.workspaceId.trim().length === 0
  ) {
    return { kind: "unauthorized" };
  }

  const limit = input.limit ?? DEFAULT_EVENT_PAGE_SIZE;
  if (limit <= 0) {
    return { kind: "ok", items: [], nextCursor: null };
  }

  const allWorkspaceEvents = (await db.orm.public.WebhookEvent.all()).filter(
    (row) => row.workspaceId === input.workspaceId,
  );

  const filters = input.filters;
  const wantedErrorClass = filters?.errorClass ?? filters?.failureClass ?? null;
  let matchingClassEventIds: Set<string> | null = null;

  if (wantedErrorClass !== null) {
    const findings = (await db.orm.public.Finding.all()).filter(
      (row) =>
        row.workspaceId === input.workspaceId &&
        row.failureClass === wantedErrorClass,
    );
    matchingClassEventIds = new Set(findings.map((row) => row.eventId));
  }

  const filtered = allWorkspaceEvents.filter((row) => {
    if (
      filters?.integrationId !== undefined &&
      filters.integrationId !== null &&
      row.integrationId !== filters.integrationId
    ) {
      return false;
    }
    if (
      filters?.from !== undefined &&
      filters.from !== null &&
      row.firstReceivedAt.getTime() < filters.from.getTime()
    ) {
      return false;
    }
    if (
      filters?.to !== undefined &&
      filters.to !== null &&
      row.firstReceivedAt.getTime() > filters.to.getTime()
    ) {
      return false;
    }
    if (
      filters?.externalEventId !== undefined &&
      filters.externalEventId !== null &&
      row.externalEventId !== filters.externalEventId
    ) {
      return false;
    }
    if (
      filters?.status !== undefined &&
      filters.status !== null &&
      row.processingState !== filters.status
    ) {
      return false;
    }
    if (
      filters?.traceId !== undefined &&
      filters.traceId !== null &&
      row.traceId !== filters.traceId
    ) {
      return false;
    }
    if (matchingClassEventIds !== null && !matchingClassEventIds.has(row.id)) {
      return false;
    }
    return true;
  });

  filtered.sort(compareEventOrder);

  let remaining = filtered;
  const cursor = input.cursor ?? null;
  if (cursor !== null) {
    const cursorRow = allWorkspaceEvents.find((row) => row.id === cursor);
    if (cursorRow === undefined) {
      return { kind: "ok", items: [], nextCursor: null };
    }
    remaining = filtered.filter((row) => compareEventOrder(row, cursorRow) > 0);
  }

  const pageRows = remaining.slice(0, limit);
  const hasMore = remaining.length > limit;
  const lastRow = pageRows[pageRows.length - 1];
  const nextCursor = hasMore && lastRow !== undefined ? lastRow.id : null;

  return {
    kind: "ok",
    items: pageRows.map(toWebhookEvent),
    nextCursor,
  };
}

export async function listAttempts(
  input: ListAttemptsInput,
): Promise<ListAttemptsResult> {
  if (
    !verifyAdminToken(input.adminToken) ||
    input.workspaceId.trim().length === 0
  ) {
    return { kind: "unauthorized" };
  }

  const rows = (await db.orm.public.DeliveryAttempt.all()).filter(
    (row) =>
      row.workspaceId === input.workspaceId && row.eventId === input.eventId,
  );

  rows.sort(
    (left, right) =>
      left.receivedAt.getTime() - right.receivedAt.getTime() ||
      left.id.localeCompare(right.id),
  );

  return {
    kind: "ok",
    items: rows.map(toDeliveryAttempt),
  };
}

export function compareEventOrder(
  left: { firstReceivedAt: Date; id: string },
  right: { firstReceivedAt: Date; id: string },
): number {
  const timeDiff =
    left.firstReceivedAt.getTime() - right.firstReceivedAt.getTime();
  if (timeDiff !== 0) return timeDiff;
  return left.id.localeCompare(right.id);
}

export function toWebhookEvent(row: {
  id: string;
  integrationId: string;
  externalEventId: string | null;
  eventType: string | null;
  occurredAt: Date | null;
  firstReceivedAt: Date;
  traceId: string | null;
  payloadDigest: string;
  redactedPayloadJson: unknown;
  processingState: WebhookEvent["processingState"];
}): WebhookEvent {
  return {
    id: row.id,
    integrationId: row.integrationId,
    externalEventId: row.externalEventId,
    eventType: row.eventType,
    occurredAt: row.occurredAt,
    firstReceivedAt: row.firstReceivedAt,
    traceId: row.traceId,
    payloadDigest: row.payloadDigest,
    redactedPayloadJson: row.redactedPayloadJson ?? null,
    processingState: row.processingState,
  };
}

export function toDeliveryAttempt(row: {
  id: string;
  eventId: string | null;
  integrationId: string;
  receivedAt: Date;
  httpStatus: number | null;
  durationMs: number | null;
  senderWaitMs: number | null;
  verificationState: DeliveryAttempt["verificationState"];
  handlerState: DeliveryAttempt["handlerState"];
  errorCode: string | null;
  correlationId: string;
}): DeliveryAttempt {
  return {
    id: row.id,
    eventId: row.eventId,
    integrationId: row.integrationId,
    receivedAt: row.receivedAt,
    httpStatus: row.httpStatus,
    durationMs: row.durationMs,
    senderWaitMs: row.senderWaitMs,
    verificationState: row.verificationState,
    handlerState: row.handlerState,
    errorCode: row.errorCode,
    correlationId: row.correlationId,
  };
}
