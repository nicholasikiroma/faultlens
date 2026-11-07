import type { DeliveryAttempt, WebhookEvent } from '#domain';

export function listEvents(
  _cursor: string | null,
): Promise<{ items: WebhookEvent[]; nextCursor: string | null }> {
  throw new Error('not implemented');
}

export function listAttempts(_eventId: string): Promise<DeliveryAttempt[]> {
  throw new Error('not implemented');
}
