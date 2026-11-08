import type { FailureClass } from '#domain';
import {
  canTransitionIncident,
  transitionIncident,
  type TransitionIncidentInput,
  type TransitionIncidentResult,
} from '../incidents/lifecycle.ts';

export {
  canTransitionIncident,
  transitionIncident,
  type TransitionIncidentInput,
  type TransitionIncidentResult,
};

export function listIncidents(
  _failureClass: FailureClass | null,
): Promise<readonly { id: string; failureClass: FailureClass }[]> {
  throw new Error('not implemented');
}
