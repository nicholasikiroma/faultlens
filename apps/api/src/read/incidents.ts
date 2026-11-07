import type { FailureClass } from '../../../../packages/domain/src/index.ts';

export function listIncidents(
  _failureClass: FailureClass | null,
): Promise<readonly { id: string; failureClass: FailureClass }[]> {
  throw new Error('not implemented');
}
