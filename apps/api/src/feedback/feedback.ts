import { randomUUID } from "node:crypto";
import { db } from "#db";
import type { Feedback, FeedbackRating } from "#domain";
import { recordAudit } from "../audit/audit.ts";
import { verifyAdminToken } from "../read/auth.ts";

export interface RateFindingInput {
  workspaceId: string;
  findingId: string;
  actor: string;
  rating: FeedbackRating;
  note?: string | null;
}

export type RateFindingResult =
  | { outcome: "rated"; previousRating: null; feedback: Feedback }
  | {
      outcome: "replaced";
      previousRating: FeedbackRating;
      feedback: Feedback;
    }
  | { outcome: "missing" };

export interface ListFindingFeedbackInput {
  adminToken: string | null | undefined;
  workspaceId: string;
  findingId: string;
}

export type ListFindingFeedbackResult =
  | { kind: "unauthorized" }
  | { kind: "ok"; items: readonly Feedback[] };

export async function rateFinding(
  input: RateFindingInput,
): Promise<RateFindingResult> {
  return db.transaction(async (tx) => {
    const finding = await tx.orm.public.Finding.where({
      id: input.findingId,
      workspaceId: input.workspaceId,
    })
      .forUpdate()
      .first();

    if (finding === null) {
      return { outcome: "missing" };
    }

    const now = new Date();
    const note = input.note ?? null;
    const previous = await tx.orm.public.Feedback.where({
      findingId: input.findingId,
      actor: input.actor,
    }).first();

    const feedback: Feedback =
      previous === null
        ? {
            id: randomUUID(),
            workspaceId: input.workspaceId,
            findingId: input.findingId,
            actor: input.actor,
            rating: input.rating,
            note,
            createdAt: now,
          }
        : {
            id: previous.id,
            workspaceId: previous.workspaceId,
            findingId: previous.findingId,
            actor: previous.actor,
            rating: input.rating,
            note,
            createdAt: now,
          };

    if (previous === null) {
      await tx.orm.public.Feedback.create(feedback);
    } else {
      await tx.orm.public.Feedback.where({ id: previous.id }).update({
        rating: input.rating,
        note,
        createdAt: now,
      });
    }

    await recordAudit(
      tx,
      {
        action: "FINDING_RATED",
        workspaceId: input.workspaceId,
        actor: input.actor,
        objectId: input.findingId,
        oldState: previous?.rating ?? null,
        newState: input.rating,
      },
      now,
    );

    if (previous === null) {
      return { outcome: "rated", previousRating: null, feedback };
    }
    return {
      outcome: "replaced",
      previousRating: previous.rating,
      feedback,
    };
  });
}

export async function listFindingFeedback(
  input: ListFindingFeedbackInput,
): Promise<ListFindingFeedbackResult> {
  if (
    !verifyAdminToken(input.adminToken) ||
    input.workspaceId.trim().length === 0
  ) {
    return { kind: "unauthorized" };
  }

  const rows = (await db.orm.public.Feedback.all()).filter(
    (row) =>
      row.workspaceId === input.workspaceId &&
      row.findingId === input.findingId,
  );

  rows.sort(
    (left, right) =>
      left.createdAt.getTime() - right.createdAt.getTime() ||
      left.id.localeCompare(right.id),
  );

  return {
    kind: "ok",
    items: rows.map((row) => ({
      id: row.id,
      workspaceId: row.workspaceId,
      findingId: row.findingId,
      actor: row.actor,
      rating: row.rating,
      note: row.note,
      createdAt: row.createdAt,
    })),
  };
}
