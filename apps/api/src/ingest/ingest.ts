export function ingest(_input: {
  token: string;
  rawBody: Buffer;
  headers: Readonly<Record<string, string>>;
}): Promise<{ eventId: string | null; attemptId: string }> {
  throw new Error('not implemented');
}
