import type { FailureClass } from '#domain';

export function fingerprint(input: {
  integrationId: string;
  environment: string;
  failureClass: FailureClass;
  endpoint: string;
}): string {
  return [input.integrationId, input.environment, input.failureClass, normalizeEndpoint(input.endpoint)].join(
    '\n',
  );
}

function normalizeEndpoint(endpoint: string): string {
  const trimmed = endpoint.trim().toLowerCase();
  if (trimmed.length === 0) return '/';
  const withLead = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  const collapsed = withLead.replace(/\/{2,}/g, '/');
  if (collapsed.length > 1 && collapsed.endsWith('/')) return collapsed.slice(0, -1);
  return collapsed;
}
