import { db } from "#db";
import { INCIDENT_TRANSITIONS, type IncidentStatus } from "#domain";

export interface TransitionIncidentInput {
  workspaceId: string;
  incidentId: string;
  status: IncidentStatus;
}

export type TransitionIncidentResult =
  | {
      outcome: "transitioned" | "unchanged" | "illegal";
      previousStatus: IncidentStatus;
      status: IncidentStatus;
    }
  | {
      outcome: "missing";
      status: null;
    };

export function canTransitionIncident(
  from: IncidentStatus,
  to: IncidentStatus,
): boolean {
  return INCIDENT_TRANSITIONS[from].includes(to);
}

export async function transitionIncident(
  input: TransitionIncidentInput,
): Promise<TransitionIncidentResult> {
  return db.transaction(async (tx) => {
    const incident = await tx.orm.public.Incident.where({
      id: input.incidentId,
      workspaceId: input.workspaceId,
    })
      .forUpdate()
      .first();

    if (incident === null) {
      return { outcome: "missing", status: null };
    }

    if (incident.status === input.status) {
      return {
        outcome: "unchanged",
        previousStatus: incident.status,
        status: incident.status,
      };
    }

    if (!canTransitionIncident(incident.status, input.status)) {
      return {
        outcome: "illegal",
        previousStatus: incident.status,
        status: incident.status,
      };
    }

    await tx.orm.public.Incident.where({
      id: incident.id,
      workspaceId: input.workspaceId,
    }).update({
      status: input.status,
    });

    return {
      outcome: "transitioned",
      previousStatus: incident.status,
      status: input.status,
    };
  });
}
