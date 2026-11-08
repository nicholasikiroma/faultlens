export interface ValidEventFields {
  externalEventId: string;
  eventType: string;
  occurredAt: Date | null;
}

export type SchemaValidationResult =
  | { ok: true; fields: ValidEventFields }
  | { ok: false; fieldPath: string; message: string };

/**
 * Validates that rawBody contains a valid JSON webhook event object
 * with required `event_id` and `type` fields, and an optional valid `occurred_at`.
 */
export function validateEventSchema(rawBody: Buffer): SchemaValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return {
      ok: false,
      fieldPath: '$',
      message: 'Payload must be valid JSON',
    };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {
      ok: false,
      fieldPath: '$',
      message: 'Payload must be a JSON object',
    };
  }

  const record = parsed as Record<string, unknown>;

  if (typeof record.event_id !== 'string' || record.event_id.trim().length === 0) {
    return {
      ok: false,
      fieldPath: 'event_id',
      message: 'Field "event_id" is required and must be a non-empty string',
    };
  }

  if (typeof record.type !== 'string' || record.type.trim().length === 0) {
    return {
      ok: false,
      fieldPath: 'type',
      message: 'Field "type" is required and must be a non-empty string',
    };
  }

  let occurredAt: Date | null = null;
  if (record.occurred_at !== undefined && record.occurred_at !== null) {
    if (typeof record.occurred_at !== 'string' || Number.isNaN(Date.parse(record.occurred_at))) {
      return {
        ok: false,
        fieldPath: 'occurred_at',
        message: 'Field "occurred_at" must be a valid date string',
      };
    }
    occurredAt = new Date(record.occurred_at);
  }

  return {
    ok: true,
    fields: {
      externalEventId: record.event_id.trim(),
      eventType: record.type.trim(),
      occurredAt,
    },
  };
}

