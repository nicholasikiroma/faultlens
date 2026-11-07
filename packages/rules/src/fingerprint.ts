import type { FailureClass } from '../../domain/src/index.ts';

export function fingerprint(_input: {
  integrationId: string;
  environment: string;
  failureClass: FailureClass;
  endpoint: string;
}): string {
  throw new Error('not implemented');
}
