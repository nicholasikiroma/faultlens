import type { FailureClass } from '#domain';

export function listIncidents(
  _failureClass: FailureClass | null,
): Promise<readonly { id: string; failureClass: FailureClass }[]> {
  throw new Error('not implemented');
}
